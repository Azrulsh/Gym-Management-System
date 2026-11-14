import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1, csrf_token: 'delete-test' };
function isolated(code, options = {}) {
  const result = run(session, `require 'tests/helpers/membership-db.php';
    with_throttle_database(function($db,$schema) {
      $GLOBALS['auth_connection']=$db;
      ${code}
    });`, options);
  return JSON.parse(result.body);
}
const post = "['id'=>'2','csrf_token'=>'delete-test','password'=>'admin']";

test('last Admin cannot delete their account and their login remains valid', () => {
  const data = isolated(`$before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $result=new_membership_for_test($db,${post},'delete_user');
    $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $user=auth_session_account(2); echo json_encode(compact('before','after','result','user'));`);
  assert.equal(data.result.status, 409);
  assert.match(JSON.parse(data.result.result).error, /last Admin/);
  assert.deepEqual(data.before, data.after);
  assert.equal(Number(data.user.type), 1);
});

test('last Admin cannot be demoted through Edit User', () => {
  const data = isolated(`$result=new_membership_for_test($db,
    ['id'=>'2','name'=>'Admin','username'=>'admin','password'=>'','type'=>'2','csrf_token'=>'delete-test'],'save_user');
    $user=auth_session_account(2); echo json_encode(compact('result','user'));`);
  assert.equal(data.result.status, 409);
  assert.equal(Number(data.user.type), 1);
});

for (const password of ['', 'wrong', ['admin']]) {
  test(`self deletion requires a correct password: ${JSON.stringify(password)}`, () => {
    const data = isolated(`$db->query('UPDATE users SET type=1 WHERE id=3');
      $result=new_membership_for_test($db,['id'=>'2','csrf_token'=>'delete-test','password'=>json_decode(${literal(JSON.stringify(password))},true)],'delete_user');
      $user=auth_session_account(2); echo json_encode(compact('result','user'));`);
    assert.equal(data.result.status, 400);
    assert.ok(data.user);
  });
}

test('self deletion succeeds with another Admin, destroys session and preserves the replacement', () => {
  const data = isolated(`$db->query('UPDATE users SET type=1 WHERE id=3');
    $result=new_membership_for_test($db,${post},'delete_user');
    $user=auth_session_account(2); $replacement=auth_session_account(3);
    $session=$_SESSION; $active=session_status()===PHP_SESSION_ACTIVE;
    echo json_encode(compact('result','user','replacement','session','active'));`);
  assert.deepEqual(JSON.parse(data.result.result), { deleted: true, self_deleted: true });
  assert.equal(data.user, null);
  assert.equal(Number(data.replacement.type), 1);
  assert.deepEqual(data.session, []);
  assert.equal(data.active, false);
});

test('Admin can delete a Staff account without deleting their own session', () => {
  const data = isolated(`$result=new_membership_for_test($db,['id'=>'3','csrf_token'=>'delete-test'],'delete_user');
    $user=auth_session_account(3); $session=$_SESSION; echo json_encode(compact('result','user','session'));`);
  assert.equal(data.result.result, 1);
  assert.equal(data.user, null);
  assert.equal(data.session.login_id, 2);
});

for (const id of ['abc', '0', '-1', '2 OR 1=1', ['2'], null]) {
  test(`invalid delete ID ${JSON.stringify(id)} preserves both users`, () => {
    const data = isolated(`$result=new_membership_for_test($db,['id'=>json_decode(${literal(JSON.stringify(id))},true),'csrf_token'=>'delete-test'],'delete_user');
      $count=$db->query('SELECT COUNT(*) AS n FROM users')->fetch_assoc()['n']; echo json_encode(compact('result','count'));`);
    assert.equal(data.result.status, 400);
    assert.equal(Number(data.count), 2);
  });
}

test('missing account returns 404', () => {
  assert.equal(isolated("echo json_encode(new_membership_for_test($db,['id'=>'999','csrf_token'=>'delete-test'],'delete_user')); ").status, 404);
});

for (const token of [null, '', 'wrong', ['delete-test']]) {
  test(`delete rejects CSRF ${JSON.stringify(token)}`, () => {
    assert.equal(run(session, `$_SERVER['REQUEST_METHOD']='POST'; $_POST=['csrf_token'=>json_decode(${literal(JSON.stringify(token))},true)]; require_action_access('delete_user');`).status, 403);
  });
}
test('GET cannot delete users', () => assert.equal(run(session, "$_SERVER['REQUEST_METHOD']='GET'; require_action_access('delete_user');").status, 405));
test('Staff cannot delete users', () => assert.equal(run({ ...session, login_type: 2 }, "$_SERVER['REQUEST_METHOD']='POST'; require_action_access('delete_user');").status, 403));

// Separate processes exercise real request entry guards without exiting the fixture owner.
const worker = `
  function guard_worker($schema,$id,$api=true) {
    $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;}); session_start(); '
      . 'require "tests/helpers/throttle-db.php"; require "auth.php"; '
      . '$GLOBALS["auth_connection"]=throttle_test_connection('.var_export($schema,true).'); '
      . '$_SESSION=["login_id"=>'.(int)$id.',"login_type"=>1,"login_auth_version"=>1]; '
      . 'register_shutdown_function(function(){echo json_encode(["status"=>http_response_code()?:200,"session"=>$_SESSION]);}); '
      . 'require_login('.($api?'true':'false').'); echo "ALLOWED";';
    $pipes=[]; $process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
    fclose($pipes[0]); $out=stream_get_contents($pipes[1]); $err=stream_get_contents($pipes[2]);
    fclose($pipes[1]);fclose($pipes[2]);
    if(proc_close($process)!==0||$err!=='') throw new RuntimeException($err);
    return $out;
  }
`;
test('deleted user is rejected on their next API request and normal page request', () => {
  const data = isolated(`${worker}
    $db->query('DELETE FROM users WHERE id=3');
    $api=guard_worker($schema,3); $page=guard_worker($schema,3,false);
    echo json_encode(compact('api','page'));`);
  assert.match(data.api, /Authentication required/);
  assert.match(data.api, /"status":401/);
  assert.match(data.page, /"status":302/);
  assert.doesNotMatch(data.api + data.page, /ALLOWED/);
});
test('existing session refreshes its role from the DB after demotion', () => {
  const data = isolated(`${worker}
    $out=guard_worker($schema,3); echo json_encode($out);`);
  assert.match(data, /ALLOWED/);
  assert.match(data, /"login_type":2/);
});

test('failed delete rolls back and keeps both accounts', () => {
  const data = isolated(`$db->query("CREATE TRIGGER fail_delete BEFORE DELETE ON users FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'");
    ini_set('error_log','');
    $result=new_membership_for_test($db,['id'=>'3','csrf_token'=>'delete-test'],'delete_user');
    $count=$db->query('SELECT COUNT(*) n FROM users')->fetch_assoc()['n'];
    echo json_encode(compact('result','count'));`, { expectedStderr: /^Unable to delete user\.\r?\n$/ });
  assert.equal(data.result.status, 500);
  assert.equal(Number(data.count), 2);
});

for (const competingAction of ['delete_user', 'save_user']) {
test(`simultaneous self deletion and ${competingAction} preserve one Admin`, () => {
  const data = isolated(`
    $db->query('UPDATE users SET type=1 WHERE id=3');
    $db->begin_transaction(); $db->query('SELECT id FROM users ORDER BY id FOR UPDATE');
    $workers=[];
    foreach ([2=>'admin',3=>'staff'] as $id=>$password) {
      $method=$id===3 ? '${competingAction}' : 'delete_user';
      $post=['id'=>(string)$id,'csrf_token'=>'delete-test','password'=>$password];
      if($method==='save_user') $post+=['name'=>'Staff','username'=>'staff','type'=>'2','current_password'=>$password];
      $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;}); session_start(); '
        . 'require "tests/helpers/membership-db.php"; require "admin_class.php"; '
        . '$db=throttle_test_connection('.var_export($schema,true).'); $GLOBALS["auth_connection"]=$db; '
        . '$_SESSION=["login_id"=>'.$id.',"login_type"=>1,"login_auth_version"=>1,"csrf_token"=>"delete-test"]; '
        . 'echo json_encode(new_membership_for_test($db,'.var_export($post,true).','.var_export($method,true).'));';
      $pipes=[];$p=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
      fclose($pipes[0]);$workers[]=[$p,$pipes];
    }
    usleep(200000);$db->commit();$results=[];
    foreach($workers as [$p,$pipes]) {
      $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
      if(proc_close($p)!==0||$err!=='') throw new RuntimeException($err);
      $results[]=json_decode($out,true);
    }
    $remaining=$db->query('SELECT COUNT(*) n FROM users WHERE type=1')->fetch_assoc()['n'];
    echo json_encode(compact('results','remaining'));`);
  assert.equal(Number(data.remaining), 1);
  assert.deepEqual(data.results.map(r => r.status).sort(), [200, 409]);
});
}

test('session verification failure returns 503 and cannot grant access', () => {
  const response=run(session, `ini_set('error_log','');
    $GLOBALS['auth_connection']=new class { public function prepare($sql) { throw new RuntimeException('Unavailable'); } };
    require_login(true); echo 'ALLOWED';`, { expectedStderr: /^Unable to verify login session\.\r?\n$/ });
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.body, /ALLOWED|Unavailable|Stack trace/);
});
