import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

function isolated(code, options = {}) {
  return JSON.parse(run({login_id:2, login_type:1, login_name:'Admin', login_username:'admin', csrf_token:'reauth-test'}, `
    require 'tests/helpers/membership-db.php';
    with_throttle_database(function($db) {
      $GLOBALS['auth_connection'] = $db;
      $_SERVER['REMOTE_ADDR'] = '192.0.2.50';
      function attempt($db, $password = 'wrong', $method = 'save_account') {
        return new_membership_for_test($db, [
          'id'=>'2', 'version'=>'1', 'name'=>'Admin', 'username'=>'admin', 'type'=>'1',
          'password'=>$method === 'delete_user' ? $password : 'new-password',
          'current_password'=>$password, 'csrf_token'=>'reauth-test'
        ], $method);
      }
      ${code}
    });`, options).body);
}

for (const method of ['save_account', 'save_user', 'delete_user']) {
  test(`${method}: five failures persist and block the correct password without account changes`, () => {
    const data = isolated(`
      $db->query('UPDATE users SET type=1 WHERE id=3');
      $before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $sessionBefore=$_SESSION;
      $failures=[];
      for($i=0;$i<5;$i++) $failures[]=attempt($db,'wrong','${method}');
      $blocked=attempt($db,'admin','${method}');
      $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      echo json_encode(compact('before','after','failures','blocked','sessionBefore')+['sessionAfter'=>$_SESSION]);
    `);
    assert.ok(data.failures.every(result => result.status === 400));
    assert.equal(data.blocked.status,429);
    const message=JSON.parse(data.blocked.result);
    assert.ok(message.retry_after>0 && message.retry_after<=900);
    assert.match(message.error,/Retry in \d+ min/);
    assert.deepEqual(data.before,data.after);
    assert.deepEqual(data.sessionBefore,data.sessionAfter);
  });
}

test('switching self-service actions or IP cannot evade the account limit', () => {
  const data=isolated(`
    $db->query('UPDATE users SET type=1 WHERE id=3');
    for($i=0;$i<5;$i++) attempt($db,'wrong',$i%2?'save_user':'save_account');
    $_SERVER['REMOTE_ADDR']='192.0.2.99';
    echo json_encode(attempt($db,'admin','delete_user'));
  `);
  assert.equal(data.status,429);
});

test('successful verification resets failures even when the later write is stale', () => {
  const data=isolated(`
    for($i=0;$i<4;$i++) attempt($db);
    $db->query('UPDATE users SET version=2 WHERE id=2');
    $stale=attempt($db,'admin');
    $failures=[];for($i=0;$i<5;$i++) $failures[]=attempt($db);
    $blocked=attempt($db);
    echo json_encode(compact('stale','failures','blocked'));
  `);
  assert.equal(data.stale.status,409);
  assert.ok(data.failures.every(result=>result.status===400));
  assert.equal(data.blocked.status,429);
});

test('expired verification window permits a new attempt', () => {
  const data=isolated(`
    for($i=0;$i<5;$i++) attempt($db);
    $db->query('UPDATE login_throttle SET expires_at=UNIX_TIMESTAMP()-1');
    echo json_encode(attempt($db,'admin'));
  `);
  assert.equal(data.result,1);
});

test('IP limit bounds repeated successful verifications without changing account data', () => {
  const data=isolated(`
    $db->query('UPDATE users SET version=2 WHERE id=2');
    $before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $results=[];for($i=0;$i<30;$i++) $results[]=attempt($db,'admin');
    $blocked=attempt($db,'admin');
    $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('results','blocked','before','after'));
  `);
  assert.ok(data.results.every(result=>result.status===409));
  assert.equal(data.blocked.status,429);
  assert.deepEqual(data.before,data.after);
});

test('reauthentication blocking does not block normal login', () => {
  const data=isolated(`
    for($i=0;$i<5;$i++) attempt($db);
    echo json_encode(throttle_test_login($db,'admin','admin','192.0.2.50'));
  `);
  assert.equal(data.result,1);
});

test('normal login blocking does not consume reauthentication attempts', () => {
  const data=isolated(`
    for($i=0;$i<5;$i++) throttle_test_login($db,'admin','wrong','192.0.2.50');
    $_SESSION=['login_id'=>2,'login_type'=>1,'login_auth_version'=>1,'csrf_token'=>'reauth-test'];
    echo json_encode(attempt($db,'admin'));
  `);
  assert.equal(data.result,1);
});

test('verification outage fails closed without changing account data', () => {
  const data=isolated(`
    $before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query('DROP TABLE login_throttle');
    $result=attempt($db,'admin');
    $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('before','after','result'));
  `,{expectedStderr:/Unable to save account/});
  assert.notEqual(data.result.result,1);
  assert.deepEqual(data.before,data.after);
});

test('a password reset between verification and deletion prevents self deletion', () => {
  const data=isolated(`
    $db->query('UPDATE users SET type=1 WHERE id=3');
    $proxy=new class($db) {
      private $db;
      private $transactions=0;
      public function __construct($db){$this->db=$db;}
      public function __call($name,$arguments){return $this->db->$name(...$arguments);}
      public function begin_transaction(){
        if(++$this->transactions===2) $this->db->query('UPDATE users SET auth_version=auth_version+1, version=version+1 WHERE id=2');
        return $this->db->begin_transaction();
      }
    };
    $result=attempt($proxy,'admin','delete_user');
    $user=$db->query('SELECT id,auth_version FROM users WHERE id=2')->fetch_assoc();
    echo json_encode(compact('result','user'));
  `);
  assert.equal(data.result.status,409);
  assert.equal(Number(data.user.id),2);
  assert.equal(Number(data.user.auth_version),2);
});
