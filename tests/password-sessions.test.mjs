import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

const session={login_id:2,login_type:1,csrf_token:'version-test'};
function isolated(code,options={}) {
  return JSON.parse(run(session,`require 'tests/helpers/membership-db.php';
    function session_guard_worker($schema,$session,$api=true) {
      $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start(); '
        . 'require "tests/helpers/throttle-db.php";require "auth.php"; '
        . '$GLOBALS["auth_connection"]=throttle_test_connection('.var_export($schema,true).'); '
        . '$_SESSION='.var_export($session,true).'; '
        . 'register_shutdown_function(function(){echo "__RESULT__".json_encode(["status"=>http_response_code()?:200,"session"=>$_SESSION]);}); '
        . 'require_login('.($api?'true':'false').');echo "ALLOWED";';
      $pipes=[];$p=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
      fclose($pipes[0]);$out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
      if(proc_close($p)!==0||$err!=='')throw new RuntimeException($err);
      [$body,$result]=explode('__RESULT__',$out);return ['body'=>$body]+json_decode($result,true);
    }
    with_throttle_database(function($db,$schema){$GLOBALS['auth_connection']=$db;${code}});
  `,options).body);
}
test('migration 003 can be applied twice without changing existing accounts or hashes',()=>{
  const data=isolated(`$db->query('ALTER TABLE users DROP COLUMN auth_version');
    $before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query(file_get_contents('database/migrations/003_user_auth_version.sql'));
    $db->query('UPDATE users SET auth_version=7 WHERE id=2');
    $db->query(file_get_contents('database/migrations/003_user_auth_version.sql'));
    $after=$db->query('SELECT id,name,username,password,type FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $versions=$db->query('SELECT auth_version FROM users')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('before','after','versions'));`);
  assert.deepEqual(data.before,data.after);
  assert.deepEqual(data.versions.map(row=>Number(row.auth_version)),[7,1]);
});
test('Admin reset rejects both old staff sessions but permits fresh login with the new password',()=>{
  const data=isolated(`throttle_test_login($db,'staff','staff');$old=$_SESSION;
    throttle_test_login($db,'admin','admin');$_SESSION['csrf_token']='version-test';
    $result=new_membership_for_test($db,['id'=>'3','name'=>'Staff','username'=>'staff','password'=>'new-staff','type'=>'2','csrf_token'=>'version-test'],'save_user');
    $first=session_guard_worker($schema,$old);$second=session_guard_worker($schema,$old,false);
    $oldLogin=throttle_test_login($db,'staff','staff');
    $newLogin=throttle_test_login($db,'staff','new-staff');$fresh=$_SESSION;
    $allowed=session_guard_worker($schema,$fresh);
    echo json_encode(compact('result','first','second','oldLogin','newLogin','fresh','allowed'));`);
  assert.equal(data.result.result,1);
  assert.equal(data.first.status,401);assert.deepEqual(data.first.session,[]);
  assert.equal(data.second.status,302);
  assert.equal(data.oldLogin.result,3);assert.equal(data.newLogin.result,1);
  assert.equal(data.fresh.login_auth_version,2);assert.equal(data.allowed.body,'ALLOWED');
});
test('Manage Account password change rotates current session and rejects other sessions',()=>{
  const data=isolated(`throttle_test_login($db,'staff','staff');$_SESSION['csrf_token']='version-test';
    $old=$_SESSION;$beforeId=session_id();
    $result=new_membership_for_test($db,['id'=>'3','name'=>'Staff','username'=>'staff','password'=>'new-own','current_password'=>'staff','csrf_token'=>'version-test'],'save_account');
    $current=$_SESSION;$rotated=session_id()!==$beforeId;
    $oldGuard=session_guard_worker($schema,$old);$currentGuard=session_guard_worker($schema,$current);
    echo json_encode(compact('result','oldGuard','currentGuard','current','rotated'));`);
  assert.equal(data.result.result,1);assert.equal(data.rotated,true);
  assert.equal(data.oldGuard.status,401);assert.equal(data.currentGuard.body,'ALLOWED');
  assert.equal(data.current.login_auth_version,2);
});
test('profile-only edit and automatic hash upgrade preserve existing sessions',()=>{
  const data=isolated(`throttle_test_login($db,'admin','admin');$_SESSION['csrf_token']='version-test';$old=$_SESSION;
    $profile=new_membership_for_test($db,['id'=>'2','name'=>'Renamed','username'=>'admin','password'=>'','csrf_token'=>'version-test'],'save_account');
    $after=auth_session_account(2);$guard=session_guard_worker($schema,$old);
    echo json_encode(compact('profile','after','guard'));`);
  assert.equal(data.profile.result,1);assert.equal(Number(data.after.auth_version),1);
  assert.equal(data.guard.body,'ALLOWED');
});
test('a legacy session without a version must authenticate again',()=>{
  const data=isolated(`$old=$_SESSION;unset($old['login_auth_version']);
    echo json_encode(session_guard_worker($schema,$old));`);
  assert.equal(data.status,401);assert.deepEqual(data.session,[]);
});
test('failed password reset rolls back the hash and version, preserving valid sessions',()=>{
  const data=isolated(`$db->query("CREATE TRIGGER fail_password BEFORE UPDATE ON users FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Forced failure'");
    ini_set('error_log','');$before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $result=new_membership_for_test($db,['id'=>'3','name'=>'Staff','username'=>'staff','password'=>'new','type'=>'2','csrf_token'=>'version-test'],'save_user');
    $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('result','before','after'));`,{expectedStderr:/^Unable to save user \(database code 1644\)\.\r?\n$/});
  assert.equal(data.result.status,500);assert.deepEqual(data.before,data.after);
});

test('a concurrent reset cannot let Manage Account adopt the new version with a stale session',()=>{
  const data=isolated(`throttle_test_login($db,'staff','staff');$_SESSION['csrf_token']='version-test';
    $proxy=new class($db) {
      private $db;public function __construct($db){$this->db=$db;}
      public function prepare($sql){
        if(strpos($sql,'auth_version = auth_version + 1')!==false){
          $hash=gym_password_hash('admin-reset');
          $reset=$this->db->prepare('UPDATE users SET password=?,auth_version=auth_version+1 WHERE id=3');
          $reset->bind_param('s',$hash);$reset->execute();$reset->close();
        }
        return $this->db->prepare($sql);
      }
    };
    $result=new_membership_for_test($proxy,['id'=>'3','name'=>'Staff','username'=>'staff','password'=>'stale-change','current_password'=>'staff','csrf_token'=>'version-test'],'save_account');
    $guard=session_guard_worker($schema,$_SESSION);
    $hash=$db->query('SELECT password FROM users WHERE id=3')->fetch_assoc()['password'];
    $correct=gym_password_verify('admin-reset',$hash);echo json_encode(compact('result','guard','correct'));`);
  assert.equal(data.result.status,409);assert.equal(data.guard.status,401);assert.equal(data.correct,true);
});
