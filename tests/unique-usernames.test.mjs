import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

const session={login_id:2,login_type:1,csrf_token:'unique-test'};
function isolated(code){return JSON.parse(run(session,`require 'tests/helpers/membership-db.php';
  with_throttle_database(function($db,$schema){$GLOBALS['auth_connection']=$db;${code}});`).body);}

test('migration 004 is repeatable and preserves accounts, hashes and session versions',()=>{
  const data=isolated(`$db->query('ALTER TABLE users DROP INDEX users_username_unique');
    $before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query(file_get_contents('database/migrations/004_unique_usernames.sql'));
    $db->query(file_get_contents('database/migrations/004_unique_usernames.sql'));
    $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $indexes=$db->query("SHOW INDEX FROM users WHERE Key_name='users_username_unique'")->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('before','after','indexes'));`);
  assert.deepEqual(data.before,data.after);assert.equal(data.indexes.length,1);
  assert.equal(Number(data.indexes[0].Non_unique),0);assert.equal(data.indexes[0].Column_name,'username');
});
test('migration rejects existing duplicates without deleting or renaming accounts',()=>{
  const data=isolated(`$db->query('ALTER TABLE users DROP INDEX users_username_unique');
    $db->query("UPDATE users SET username='same_username'");
    $before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);$code=0;
    try{$db->query(file_get_contents('database/migrations/004_unique_usernames.sql'));}catch(mysqli_sql_exception $e){$code=$e->getCode();}
    $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);echo json_encode(compact('before','after','code'));`);
  assert.equal(data.code,1062);assert.deepEqual(data.before,data.after);assert.equal(data.after.length,2);
});
test('database constraint respects the existing case-insensitive collation',()=>{
  const data=isolated(`$code=0;try{$db->query("UPDATE users SET username='AdMiN' WHERE id=3");}catch(mysqli_sql_exception $e){$code=$e->getCode();}
    $user=$db->query('SELECT username FROM users WHERE id=3')->fetch_assoc();echo json_encode(compact('code','user'));`);
  assert.equal(data.code,1062);assert.equal(data.user.username,'staff');
});
test('two simultaneous Manage Account saves cannot claim the same username',()=>{
  const data=isolated(`$before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->begin_transaction();$db->query('SELECT id FROM users ORDER BY id FOR UPDATE');$workers=[];
    foreach([2=>1,3=>2] as $id=>$role){
      $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start(); '
        .'require "tests/helpers/membership-db.php";require "admin_class.php"; '
        .'$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db; '
        .'$_SESSION=["login_id"=>'.$id.',"login_type"=>'.$role.',"login_auth_version"=>1,"csrf_token"=>"unique-test"]; '
        .'echo json_encode(new_membership_for_test($db,["id"=>"'.$id.'","name"=>"Test","username"=>"same_username","password"=>"","csrf_token"=>"unique-test"],"save_account"));';
      $pipes=[];$p=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
      if(!is_resource($p))throw new RuntimeException('Worker unavailable');
      fclose($pipes[0]);$workers[]=[$p,$pipes];
    }
    usleep(300000);$db->commit();$results=[];
    foreach($workers as [$p,$pipes]){$out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);if(proc_close($p)!==0||$err!=='')throw new RuntimeException($err);$results[]=json_decode($out,true);}
    $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('before','after','results'));`);
  assert.deepEqual(data.results.map(result=>result.status).sort(),[200,409]);
  assert.equal(data.after.filter(row=>row.username==='same_username').length,1);
  assert.match(JSON.parse(data.results.find(result=>result.status===409).result).error,/Username already exists/);
  for(let i=0;i<2;i++){
    assert.equal(data.after[i].password,data.before[i].password);
    assert.equal(data.after[i].auth_version,data.before[i].auth_version);
    assert.equal(data.after[i].type,data.before[i].type);
  }
});
test('Admin Add User still rejects an existing username with a clear conflict',()=>{
  const data=isolated(`echo json_encode(new_membership_for_test($db,['id'=>'','name'=>'Duplicate','username'=>'STAFF','password'=>'new','type'=>'2','csrf_token'=>'unique-test'],'save_user'));`);
  assert.equal(data.status,409);assert.match(JSON.parse(data.result).error,/Username already exists/);
});
