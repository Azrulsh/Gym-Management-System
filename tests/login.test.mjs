// Run the actual login method against a database in memory, without changing real accounts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';
import { allowLoginThrottle } from './helpers/throttle.mjs';

const database = `
  class LoginResult {
    private $statement;
    public function __construct($statement) { $this->statement = $statement; }
    public function fetch_assoc() { return $this->statement->fetch(PDO::FETCH_ASSOC); }
  }
  class LoginStatement {
    public $affected_rows = 0;
    private $db;
    private $statement;
    private $values;
    private $sql;
    public function __construct($db, $sql) { $this->db = $db; $this->sql = $sql; $this->statement = $db->pdo->prepare($sql); }
    public function bind_param($types, &...$values) {
      if (strlen($types) !== count($values)) throw new RuntimeException('Incorrect binding count');
      $this->values = $values;
    }
    public function execute() {
      if ($this->db->mode === 'execute-failure') return false;
      if (str_starts_with($this->sql, 'UPDATE')) {
        if ($this->db->mode === 'upgrade-failure') return false;
        if ($this->db->mode === 'concurrent-reset') {
          $reset = $this->db->pdo->prepare('UPDATE users SET password = ? WHERE id = 2');
          $reset->execute([gym_password_hash('replacement-password')]);
        }
      }
      $values = array_map(function($value) { return $value; }, $this->values);
      $result = $this->statement->execute($values);
      $this->affected_rows = $this->statement->rowCount();
      return $result;
    }
    public function get_result() { return new LoginResult($this->statement); }
    public function close() { $this->statement->closeCursor(); }
  }
  class LoginDatabase {
    public $pdo;
    public $mode = '';
    public function __construct() {
      $this->pdo = new PDO('sqlite::memory:');
      $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $this->pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, username TEXT COLLATE NOCASE, password TEXT, type INTEGER, auth_version INTEGER NOT NULL DEFAULT 1)');
      $insert = $this->pdo->prepare('INSERT INTO users (id,name,username,password,type) VALUES (?, ?, ?, ?, ?)');
      $insert->execute([2, 'Admin', 'admin', md5('admin'), 1]);
      $insert->execute([3, 'Staff', 'staff', md5('staff'), 2]);
      $insert->execute([4, 'Quoted User', "o'neil", md5('quoted-pass'), 2]);
      $insert->execute([5, 'Unsupported', 'legacy', md5('legacy'), 3]);
      $insert->execute([6, 'Literal User', "admin' -- ", md5('literal-pass'), 2]);
    }
    public function query($sql) { throw new RuntimeException('Login must use prepared statements'); }
    public function prepare($sql) {
      if ($this->mode === 'prepare-failure') return false;
      if ($this->mode === 'exception') throw new mysqli_sql_exception('SELECT users password=private-hash', 1064);
      return new LoginStatement($this, $sql);
    }
    public function snapshot() { return $this->pdo->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC); }
    public function close() {}
  }
  require 'admin_class.php';
  ob_start();
  $db = new LoginDatabase();
  $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
  $property = new ReflectionProperty('Action', 'db');
  $property->setAccessible(true);
  $property->setValue($action, $db);
  ${allowLoginThrottle}
  $_SERVER['REQUEST_METHOD'] = 'POST';
`;

function login(post, { session = { csrf_token: 'keep-token' }, mode = '', setup = '' } = {}) {
  const result = run(session, `${database}
    $_POST = json_decode(${literal(JSON.stringify(post))}, true);
    $_POST += ['csrf_token' => csrf_token()];
    $db->mode = ${literal(mode)};
    ini_set('error_log', '');
    ${setup}
    $before = $db->snapshot();
    $oldSessionId = session_id();
    $result = $action->login();
    $after = $db->snapshot();
    $verified = isset($_SESSION['login_id']) && gym_password_verify($_POST['password'], $after[$_SESSION['login_id'] - 2]['password']);
    unset($action);
    echo json_encode(['result' => $result, 'verified' => $verified, 'session' => $_SESSION, 'rotated' => session_id() !== $oldSessionId, 'before' => $before, 'after' => $after]);
  `, mode === 'exception' ? { expectedStderr: /^Login database error \(code 1064\)\.\r?\n$/ } : {});
  const data = JSON.parse(result.body);
  if (data.result === 1) {
    assert.equal(data.verified, true);
    for (let index = 0; index < data.before.length; index++) {
      const before = data.before[index];
      const after = data.after[index];
      if (before.id === data.session.login_id) {
        assert.match(after.password, /^\$argon2id\$/);
        assert.deepEqual({ ...after, password: before.password }, before);
      } else assert.deepEqual(after, before, 'other accounts must not change');
    }
  } else if (mode !== 'concurrent-reset') assert.deepEqual(data.after, data.before);
  return { status: result.status, ...data };
}

for (const [username, password, id, role] of [
  ['admin', 'admin', 2, 1], ['staff', 'staff', 3, 2], ["o'neil", 'quoted-pass', 4, 2],
]) {
  test(`valid credentials for ${username} authenticate with the correct role and a fresh session ID`, () => {
    const data = login({ username, password });
    assert.equal(data.status, 200);
    assert.equal(data.result, 1);
    assert.equal(data.session.login_id, id);
    assert.equal(data.session.login_type, role);
    assert.equal(data.rotated, true);
    assert.equal(data.session.login_password, undefined);
    assert.equal(data.session.csrf_token, 'keep-token');
  });
}

for (const username of ["'", "admin' -- ", "' OR '1'='1' -- ", "' UNION SELECT 1,2,3,1 -- ", 'missing-user']) {
  test(`username ${JSON.stringify(username)} cannot bypass a wrong password or break SQL`, () => {
    const data = login({ username, password: 'wrong-password' });
    assert.equal(data.status, 200);
    assert.equal(data.result, 3);
    assert.deepEqual(data.session, { csrf_token: 'keep-token' });
  });
}

test('a correct username with a wrong password is rejected', () => {
  const data = login({ username: 'admin', password: 'wrong-password' });
  assert.equal(data.result, 3);
  assert.equal(data.session.login_id, undefined);
});

test('matching the dummy hash can never authenticate a nonexistent account',()=>{
  const data=login({username:'missing-user',password:'gym-login-dummy-verification-not-an-account'});
  assert.equal(data.status,200);assert.equal(data.result,3);
  assert.deepEqual(data.session,{csrf_token:'keep-token'});assert.deepEqual(data.after,data.before);
});

for(const [username,blocked,hashType] of [
  ['missing-user',false,'argon'],['admin',false,'argon'],['missing-user',true,'argon'],
  ['admin',false,'md5'],['admin',false,'uppercase-md5'],['admin',true,'md5'],
]){
  test(`${username} (${hashType}): ${blocked?'throttle rejection skips':'admitted attempt performs'} password verification`,()=>{
    // Observe calls while executing the real helper body, without timing assertions.
    const tracedDatabase=database.replace("require 'admin_class.php';",`
      $source=file_get_contents('passwords.php');
      $source=str_replace('function gym_password_verify($password, $hash){',
        'function gym_password_verify($password, $hash){ $GLOBALS["verification_hashes"][]=$hash;', $source);
      eval('?>'.$source);
      $actionSource=str_replace("require_once __DIR__ . '/passwords.php';",'',file_get_contents('admin_class.php'));
      eval('?>'.$actionSource);
    `);
    const data=JSON.parse(run({csrf_token:'verify-test'},`${tracedDatabase}
      $db->pdo->prepare('UPDATE users SET password=? WHERE id=2')->execute([${hashType==='md5'?"md5('admin')":hashType==='uppercase-md5'?"strtoupper(md5('admin'))":"gym_password_hash('admin')"}]);
      $GLOBALS['verification_hashes']=[];$GLOBALS['throttle_events']=[];
      $throttleProperty->setValue($action,new class {
        public function begin($account,$ip){$GLOBALS['throttle_events'][]='begin';return ${blocked?900:0};}
        public function finish($success){$GLOBALS['throttle_events'][]=$success?'success':'failure';}
        public function cancel(){}
      });
      $_POST=['username'=>'${username}','password'=>'incorrect','csrf_token'=>'verify-test'];
      $before=$db->snapshot();$result=$action->login();$after=$db->snapshot();unset($action);
      echo json_encode(['result'=>$result,'status'=>http_response_code()?:200,
       'hashes'=>$GLOBALS['verification_hashes'],'events'=>$GLOBALS['throttle_events'],
       'dummy'=>gym_password_dummy_hash(),'session'=>$_SESSION,'before'=>$before,'after'=>$after]);`).body);
    assert.deepEqual(data.after,data.before);assert.deepEqual(data.session,{csrf_token:'verify-test'});
    if(blocked){assert.equal(data.status,429);assert.deepEqual(data.hashes,[]);assert.deepEqual(data.events,['begin']);}
    else{
      const legacy=hashType!=='argon';
      assert.equal(data.result,3);assert.equal(data.hashes.length,legacy?2:1);
      assert.equal(data.hashes[0],username==='missing-user'?data.dummy:data.before[0].password);
      assert.match(data.hashes.at(-1),/^\$argon2id\$/);
      if(legacy)assert.equal(data.hashes[1],data.dummy);
      assert.deepEqual(data.events,['begin','failure']);
    }
  });
}

test('dummy verification success cannot authenticate an existing MD5 account with a wrong password',()=>{
  const data=login({username:'admin',password:'gym-login-dummy-verification-not-an-account'});
  assert.equal(data.status,200);assert.equal(data.result,3);
  assert.deepEqual(data.session,{csrf_token:'keep-token'});assert.deepEqual(data.after,data.before);
});

test('unsupported roles are rejected without creating an authenticated session', () => {
  const data = login({ username: 'legacy', password: 'legacy' });
  assert.equal(data.result, 2);
  assert.equal(data.session.login_id, undefined);
  assert.equal(data.session.login_type, undefined);
});

test('a failed attempt clears stale authentication keys but preserves unrelated session data', () => {
  const data = login({ username: 'admin', password: 'wrong-password' }, {
    session: { login_id: 2, login_type: 1, login_name: 'Admin', login_password: 'old-hash', login_legacy: 'old-data', csrf_token: 'keep-token' },
  });
  assert.equal(data.result, 3);
  assert.deepEqual(data.session, { csrf_token: 'keep-token' });
});

for (const [label, post] of [
  ['missing fields', {}],
  ['blank username', { username: '  ', password: 'test' }],
  ['blank password', { username: 'admin', password: '' }],
  ['username array', { username: ['admin'], password: 'test' }],
  ['password array', { username: 'admin', password: ['test'] }],
  ['long username', { username: 'x'.repeat(201), password: 'test' }],
]) {
  test(`${label} is rejected safely`, () => {
    const data = login(post);
    assert.equal(data.status, 400);
    assert.equal(JSON.parse(data.result).error, 'Enter a valid username and password.');
    assert.equal(data.session.login_id, undefined);
  });
}

test('an oversized password is rejected safely', () => {
  const data = login({ username: 'admin', password: 'test' }, { setup: "$_POST['password'] = str_repeat('x', 4097);" });
  assert.equal(data.status, 400);
  assert.equal(data.session.login_id, undefined);
});

for (const mode of ['prepare-failure', 'execute-failure', 'exception', 'upgrade-failure']) {
  test(`${mode} returns a generic service error without SQL, hashes or an authenticated session`, () => {
    const data = login({ username: 'admin', password: 'admin' }, { mode });
    assert.equal(data.status, 503);
    assert.deepEqual(JSON.parse(data.result), { error: 'Unable to log in right now. Please try again.' });
    assert.equal(data.session.login_id, undefined);
  });
}

test('the login route rejects GET before creating the Action or opening the database', () => {
  const result = run({}, "$_GET['action'] = 'login'; $_SERVER['REQUEST_METHOD'] = 'GET'; include 'ajax.php';");
  assert.equal(result.status, 405);
  assert.deepEqual(JSON.parse(result.body), { error: 'Use POST to log in.' });
});

test('a concurrent password reset is preserved and the stale password cannot authenticate', () => {
  const data = login({ username: 'admin', password: 'admin' }, { mode: 'concurrent-reset' });
  assert.equal(data.result, 3);
  assert.equal(data.session.login_id, undefined);
  assert.notEqual(data.after[0].password, data.before[0].password);
  assert.deepEqual(data.after.slice(1), data.before.slice(1));
});

for (const [label, expression, upgrades] of [
  ['uppercase MD5', "strtoupper(md5('admin'))", true],
  ['current Argon2id', "gym_password_hash('admin')", false],
  ['older Argon2id cost', "password_hash('admin', PASSWORD_ARGON2ID, ['memory_cost' => 8192, 'time_cost' => 1, 'threads' => 1])", true],
  ['legacy bcrypt', "password_hash('admin', PASSWORD_BCRYPT)", true],
]) {
  test(`${label} authenticates and upgrades only when needed`, () => {
    const data = login({ username: 'admin', password: 'admin' }, {
      setup: `$seed = $db->pdo->prepare('UPDATE users SET password = ? WHERE id = 2'); $seed->execute([${expression}]);`,
    });
    assert.equal(data.result, 1);
    assert.equal(data.after[0].password !== data.before[0].password, upgrades);
  });
}

test('a migrated account can log in again without rewriting its hash', () => {
  const data = login({ username: 'admin', password: 'admin' }, {
    setup: `$_POST = ['username' => 'admin', 'password' => 'admin', 'csrf_token' => csrf_token()];
      if ($action->login() !== 1) throw new RuntimeException('First login failed');`,
  });
  assert.equal(data.result, 1);
  assert.deepEqual(data.after, data.before);
});
