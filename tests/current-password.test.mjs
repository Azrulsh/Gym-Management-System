import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session={login_id:2,login_type:1,login_name:'Admin',login_username:'admin',csrf_token:'current-test'};
function isolated(code) {
  return JSON.parse(run(session,`require 'tests/helpers/membership-db.php';
    with_throttle_database(function($db,$schema){$GLOBALS['auth_connection']=$db;${code}});`).body);
}
for(const [label,password] of [['missing',null],['empty',''],['wrong','wrong'],['array',['admin']],['boolean',true]]) {
  test(`${label} current password cannot change password, profile, version or session`,()=>{
    const data=isolated(`$before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $sessionBefore=$_SESSION;
      $post=['id'=>'2','name'=>'Changed','username'=>'changed','password'=>'new-password','csrf_token'=>'current-test'];
      ${label==='missing'?'':`$post['current_password']=json_decode(${literal(JSON.stringify(password))},true);`}
      $result=new_membership_for_test($db,$post,'save_account');
      $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $sessionAfter=$_SESSION;echo json_encode(compact('before','after','sessionBefore','sessionAfter','result'));`);
    assert.equal(data.result.status,400);
    assert.match(JSON.parse(data.result.result).error,/current password/i);
    assert.deepEqual(data.before,data.after);assert.deepEqual(data.sessionBefore,data.sessionAfter);
  });
}
test('oversized current password is rejected before verification',()=>{
  const data=isolated(`echo json_encode(new_membership_for_test($db,['id'=>'2','name'=>'Admin','username'=>'admin','password'=>'new','current_password'=>str_repeat('a',4097),'csrf_token'=>'current-test'],'save_account'));`);
  assert.equal(data.status,400);
});
for(const modern of [false,true]) {
  test(`correct ${modern?'Argon2id':'legacy MD5'} current password permits change and increments version once`,()=>{
    const data=isolated(`
      ${modern?`$hash=gym_password_hash('admin');$s=$db->prepare('UPDATE users SET password=? WHERE id=2');$s->bind_param('s',$hash);$s->execute();$s->close();`:''}
      $result=new_membership_for_test($db,['id'=>'2','name'=>'Admin','username'=>'admin','password'=>'new-password','current_password'=>'admin','csrf_token'=>'current-test'],'save_account');
      $row=$db->query('SELECT password,auth_version FROM users WHERE id=2')->fetch_assoc();
      $correct=gym_password_verify('new-password',$row['password']);$version=$_SESSION['login_auth_version'];
      echo json_encode(compact('result','row','correct','version'));`);
    assert.equal(data.result.result,1);assert.equal(data.correct,true);
    assert.match(data.row.password,/^\$argon2id\$/);assert.equal(Number(data.row.auth_version),2);assert.equal(data.version,2);
  });
}
test('profile-only edits do not require current password or increment the version',()=>{
  const data=isolated(`$before=$db->query('SELECT password,auth_version FROM users WHERE id=2')->fetch_assoc();
    $result=new_membership_for_test($db,['id'=>'2','name'=>'Renamed','username'=>'admin','password'=>'','csrf_token'=>'current-test'],'save_account');
    $after=$db->query('SELECT password,auth_version FROM users WHERE id=2')->fetch_assoc();echo json_encode(compact('result','before','after'));`);
  assert.equal(data.result.result,1);assert.deepEqual(data.before,data.after);
});
test('Manage Account displays an empty current-password field; Admin user reset does not',()=>{
  const data=isolated(`
    function password_test_form($db,$get){
      $_GET=$get;
      $source=str_replace("include('db_connect.php');",'$conn=$db;',file_get_contents('manage_user.php'));
      $source=str_replace('__DIR__',var_export(getcwd(),true),$source);
      ob_start();eval('?>'.$source);return ob_get_clean();
    }
    $own=password_test_form($db,['id'=>'2','mtype'=>'own']);
    $admin=password_test_form($db,['id'=>'3']);$self=password_test_form($db,['id'=>'2']);echo json_encode(compact('own','admin','self'));`);
  assert.match(data.own,/name="current_password"[^>]*autocomplete="current-password"/);
  assert.match(data.own,/New Password/);
  assert.doesNotMatch(data.own,/name="current_password"[^>]*value="[^"]+"/);
  assert.doesNotMatch(data.admin,/name="current_password"/);
  assert.match(data.self,/name="current_password"/);
});

for(const correct of [false,true]) {
  test(`Admin editing their own account through Users ${correct?'accepts':'requires'} current password`,()=>{
    const data=isolated(`$before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $result=new_membership_for_test($db,['id'=>'2','name'=>'Admin','username'=>'admin','type'=>'1','password'=>'new-self','current_password'=>'${correct?'admin':'wrong'}','csrf_token'=>'current-test'],'save_user');
      $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);echo json_encode(compact('result','before','after'));`);
    if(correct){assert.equal(data.result.result,1);assert.equal(Number(data.after[0].auth_version),2);}
    else {assert.equal(data.result.status,400);assert.deepEqual(data.before,data.after);}
  });
}
