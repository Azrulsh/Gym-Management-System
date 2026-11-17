import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session={login_id:2,login_type:1,csrf_token:'number-test'};
const profile={id:'',version:'1',member_id:'',firstname:'Test',lastname:'Member',middlename:'',email:'test@example.test',contact:'0123456789',gender:'Male',address:'Demo',csrf_token:'number-test'};
function isolated(code){return JSON.parse(run(session,`require 'tests/helpers/membership-read-db.php';
  with_membership_read_database(function($db,$schema){
    $db->query('ALTER TABLE members MODIFY id INT NOT NULL AUTO_INCREMENT');
    $db->query(file_get_contents('database/migrations/005_unique_member_numbers.sql'));
    ${code}
  });`).body);}
test('migration 005 is repeatable and preserves profiles, internal IDs and membership/payment history',()=>{
  const data=isolated(`$before=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);$historyBefore=membership_snapshot($db);
    $db->query(file_get_contents('database/migrations/005_unique_member_numbers.sql'));
    $after=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);$historyAfter=membership_snapshot($db);
    $indexes=$db->query("SHOW INDEX FROM members WHERE Key_name='members_number_unique'")->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('before','after','historyBefore','historyAfter','indexes'));`);
  assert.deepEqual(data.before,data.after);assert.deepEqual(data.historyBefore,data.historyAfter);
  assert.equal(data.indexes.length,1);assert.equal(Number(data.indexes[0].Non_unique),0);
});
test('existing duplicate numbers block the migration without renumbering or deleting profiles',()=>{
  const data=isolated(`$db->query('ALTER TABLE members DROP INDEX members_number_unique');$db->query('UPDATE members SET member_id=77889901');
    $before=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);$code=0;
    try{$db->query(file_get_contents('database/migrations/005_unique_member_numbers.sql'));}catch(mysqli_sql_exception $e){$code=$e->getCode();}
    $after=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);echo json_encode(compact('before','after','code'));`);
  assert.equal(data.code,1062);assert.deepEqual(data.before,data.after);
});
const proxy=`
  $proxy=new class($db) {
    public $db;public $remaining=0;public $attempts=0;public $closed=0;
    public function __construct($db){$this->db=$db;}
    public function prepare($sql){
      $statement=$this->db->prepare($sql);
      if(strpos($sql,'INSERT INTO members')!==0 && strpos($sql,'UPDATE members')!==0)return $statement;
      return new class($statement,$this){
        private $statement;private $owner;public $affected_rows=0;
        public function __construct($statement,$owner){$this->statement=$statement;$this->owner=$owner;}
        public function bind_param($types,&...$values){$this->statement->bind_param($types,...$values);}
        public function execute(){
          $this->owner->attempts++;
          if($this->owner->remaining-->0)throw new mysqli_sql_exception('Simulated competing number claim',1062);
          $result=$this->statement->execute();$this->affected_rows=$this->statement->affected_rows;return $result;
        }
        public function close(){$this->owner->closed++;$this->statement->close();}
      };
    }
  };
`;
for(const collisions of [1,10]) {
  test(`automatic numbers handle ${collisions} INSERT collisions with bounded retries`,()=>{
    const data=isolated(`${proxy}$proxy->remaining=${collisions};$before=membership_snapshot($db);
      $result=new_membership_for_test($proxy,json_decode(${literal(JSON.stringify(profile))},true),'save_member');
      $rows=$db->query('SELECT * FROM members WHERE id>11')->fetch_all(MYSQLI_ASSOC);
      $attempts=$proxy->attempts;$closed=$proxy->closed;$after=membership_snapshot($db);
      echo json_encode(compact('result','rows','attempts','closed','before','after'));`);
    assert.equal(data.result.status,collisions===1?200:503);
    assert.equal(data.attempts,collisions===1?2:10);assert.equal(data.closed,data.attempts);
    assert.equal(data.rows.length,collisions===1?1:0);assert.deepEqual(data.before,data.after);
    if(data.rows.length)assert.match(String(data.rows[0].member_id),/^\d{8}$/);
  });
}
for(const id of ['', '9']) {
  test(`${id?'Edit':'Add'} explicit ID conflict during write returns 409 without retry or data changes`,()=>{
    const data=isolated(`${proxy}$proxy->remaining=1;
      $before=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $result=new_membership_for_test($proxy,json_decode(${literal(JSON.stringify({...profile,id,member_id:'77889901'}))},true),'save_member');
      $after=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);$attempts=$proxy->attempts;
      echo json_encode(compact('result','before','after','attempts'));`);
    assert.equal(data.result.status,409);assert.match(JSON.parse(data.result.result).error,/ID No\. already exists/);
    assert.equal(data.attempts,1);assert.deepEqual(data.before,data.after);
  });
}
test('concurrent edits cannot assign one ID number to two members',()=>{
  const data=isolated(`$before=membership_snapshot($db);
    $db->begin_transaction();$db->query('SELECT id FROM members WHERE id IN (9,10) FOR UPDATE');$workers=[];
    foreach([9=>[2,1],10=>[3,2]] as $member=>[$actor,$role]){
      $post=json_decode(${literal(JSON.stringify({...profile,member_id:'77889901'}))},true);$post['id']=(string)$member;
      $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start(); '
        .'require "tests/helpers/membership-db.php";require "admin_class.php"; '
        .'$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db; '
        .'$_SESSION=["login_id"=>'.$actor.',"login_type"=>'.$role.',"login_auth_version"=>1,"csrf_token"=>"number-test"]; '
        .'echo json_encode(new_membership_for_test($db,'.var_export($post,true).',"save_member"));';
      $pipes=[];$p=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
      if(!is_resource($p))throw new RuntimeException('Worker unavailable');fclose($pipes[0]);$workers[]=[$p,$pipes];
    }
    usleep(300000);$db->commit();$results=[];
    foreach($workers as [$p,$pipes]){$out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($p)!==0||$err!=='')throw new RuntimeException($err);$results[]=json_decode($out,true);}
    $count=$db->query('SELECT COUNT(*) n FROM members WHERE member_id=77889901')->fetch_assoc()['n'];$after=membership_snapshot($db);
    echo json_encode(compact('results','count','before','after'));`);
  assert.deepEqual(data.results.map(result=>result.status).sort(),[200,409]);
  assert.equal(Number(data.count),1);assert.deepEqual(data.before,data.after);
});
