// Run the actual login method against a database in memory, without changing real accounts.
import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const database = `
  class LoginResult {
    private $statement;
    public function __construct($statement) { $this->statement = $statement; }
    public function fetch_assoc() { return $this->statement->fetch(PDO::FETCH_ASSOC); }
  }
  class LoginStatement {
    private $db;
    private $statement;
    private $values;
    public function __construct($db, $sql) { $this->db = $db; $this->statement = $db->pdo->prepare($sql); }
    public function bind_param($types, &...$values) {
      if (strlen($types) !== count($values)) throw new RuntimeException('Incorrect binding count');
      $this->values = $values;
    }
    public function execute() {
      if ($this->db->mode === 'execute-failure') return false;
      $values = array_map(function($value) { return $value; }, $this->values);
      return $this->statement->execute($values);
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
      $this->pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, username TEXT COLLATE NOCASE, password TEXT, type INTEGER)');
      $insert = $this->pdo->prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)');
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
  $_SERVER['REQUEST_METHOD'] = 'POST';
`;

function login(post, { session = { csrf_token: 'keep-token' }, mode = '', setup = '' } = {}) {
  const result = run(session, `${database}
    $_POST = json_decode(${literal(JSON.stringify(post))}, true);
    $db->mode = ${literal(mode)};
    ini_set('error_log', '');
    ${setup}
    $before = $db->snapshot();
    $oldSessionId = session_id();
    $result = $action->login();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(['result' => $result, 'session' => $_SESSION, 'rotated' => session_id() !== $oldSessionId, 'before' => $before, 'after' => $after]);
  `, mode === 'exception' ? { expectedStderr: /^Login database error \(code 1064\)\.\r?\n$/ } : {});
  const data = JSON.parse(result.body);
  assert.deepEqual(data.after, data.before, 'login must not update accounts in this password-compatible change');
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

for (const mode of ['prepare-failure', 'execute-failure', 'exception']) {
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
