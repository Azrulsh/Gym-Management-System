import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';
const session={login_id:2,login_type:1};
// Execute the real feed and delete SQL against isolated SQLite; no application DB.
const database=`require 'tests/helpers/membership-db.php';
 require 'admin_class.php';
 function with_membership_read_database($test){
  $db=new class {
   public $pdo;
   public function __construct(){
    $this->pdo=new PDO('sqlite::memory:');
    $this->pdo->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
    $this->pdo->sqliteCreateFunction('CONCAT',static fn(...$parts)=>implode('', $parts));
    $this->pdo->exec('CREATE TABLE members(id INTEGER PRIMARY KEY,lastname TEXT,firstname TEXT,middlename TEXT)');
    $this->pdo->exec("INSERT INTO members VALUES(11,'Test','Member','')");
    $this->pdo->exec('CREATE TABLE registration_info(id INTEGER PRIMARY KEY,member_id INTEGER)');
    $this->pdo->exec('INSERT INTO registration_info VALUES(9,11)');
    $this->pdo->exec('CREATE TABLE payments(id INTEGER PRIMARY KEY,registration_id INTEGER,amount TEXT)');
    $this->pdo->exec("INSERT INTO payments VALUES(1,9,'100.00')");
   }
   public function query($sql){
    $sql=str_replace(' ENGINE=InnoDB','',$sql);
    $result=$this->pdo->query($sql);
    return new class($result){
     private $result;public function __construct($result){$this->result=$result;}
     public function fetch_all($mode){return $this->result->fetchAll(PDO::FETCH_ASSOC);}
     public function free(){$this->result->closeCursor();}
    };
   }
   public function prepare($sql){return new class($this->pdo->prepare($sql)){
    private $statement,$values;public $affected_rows=0;
    public function __construct($statement){$this->statement=$statement;}
    public function bind_param($types,&...$values){$this->values=$values;}
    public function execute(){$ok=$this->statement->execute($this->values);$this->affected_rows=$this->statement->rowCount();return $ok;}
    public function close(){$this->statement->closeCursor();}
   };}
  };
  $test($db);
 }
`;

for(const role of [1,2]){
  test(`role ${role}: orphaned schedules stay visible and can be deleted without creating profiles or changing history`,()=>{
    const response=run({...session,login_id:role===1?2:3,login_type:role,csrf_token:'orphan-test'},`
      ${database}
      with_membership_read_database(function($db){
        $db->query('CREATE TABLE schedules (id INT PRIMARY KEY, member_id INT, dow TEXT, date_from DATE, date_to DATE, time_from TIME, time_to TIME) ENGINE=InnoDB');
        $db->query("INSERT INTO schedules VALUES (1,11,'1','2026-11-01','2026-11-30','09:00','10:00'),(2,999,'2','2026-11-01','2026-11-30','11:00','12:00')");
        $before=membership_snapshot($db);$members=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);
        $schedules=$db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
        $feed=new_membership_for_test($db,[],'get_schecdule');
        $afterRead=$db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
        $deleted=new_membership_for_test($db,['id'=>'2','csrf_token'=>'orphan-test'],'delete_schedule');
        $afterFeed=new_membership_for_test($db,[],'get_schecdule');
        $after=membership_snapshot($db);$membersAfter=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);
        echo json_encode(compact('before','after','members','membersAfter','schedules','afterRead','feed','deleted','afterFeed'));
      });`);
    const d=JSON.parse(response.body);assert.equal(d.feed.status,200);
    const rows=JSON.parse(d.feed.result);assert.equal(rows.length,2);
    const orphan=rows.find(row=>Number(row.id)===2);assert.equal(orphan.name,'Member profile missing (ID 999)');
    for(const field of ['id','member_id','dow','date_from','date_to','time_from','time_to'])assert.equal(orphan[field],d.schedules[1][field]);
    assert.deepEqual(d.afterRead,d.schedules);assert.equal(d.deleted.result,1);
    const remaining=JSON.parse(d.afterFeed.result);assert.equal(remaining.length,1);assert.equal(Number(remaining[0].id),1);
    assert.equal(remaining[0].name,rows.find(row=>Number(row.id)===1).name);
    assert.deepEqual(d.after,d.before);assert.deepEqual(d.membersAfter,d.members);
  });
}
