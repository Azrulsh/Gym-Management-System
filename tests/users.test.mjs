// Exercise the actual save_user and login methods against an in-memory SQL database.
// No application accounts or password hashes are changed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';
import { allowLoginThrottle, allowCurrentPasswordThrottle } from './helpers/throttle.mjs';

const session = { login_id: 2, login_type: 1, login_name: 'Admin', login_username: 'admin', csrf_token: 'users-test-token' };
const profile = { version: '1', id: '', name: " Test O'Neil ", username: 'staff_test', password: 'staff_test', type: '2', csrf_token: session.csrf_token };
function assertPassword(hash, password) {
  assert.match(hash, /^\$argon2id\$/);
  const response = run({}, `echo json_encode(password_verify(${literal(password)}, ${literal(hash)}));`);
  assert.equal(JSON.parse(response.body), true);
}

const database = `
  class UserResult {
    public $num_rows;
    private $rows;
    public function __construct($rows) { $this->rows = $rows; $this->num_rows = count($rows); }
    public function fetch_assoc() { return array_shift($this->rows); }
    public function fetch_array() { return $this->fetch_assoc(); }
    public function fetch_all($mode) { return $this->rows; }
  }
  class UserStatement {
    private $db;
    private $sql;
    private $statement;
    private $values;
    public $affected_rows = 0;
    public function __construct($db, $sql) { $this->db = $db; $this->sql = $sql; $this->statement = $db->pdo->prepare($sql); }
    public function bind_param($types, &...$values) {
      if (strlen($types) !== count($values)) throw new RuntimeException('Incorrect binding count');
      $this->values = $values;
    }
    public function execute() {
      if ($this->db->failWrite && preg_match('/^(INSERT|UPDATE)/', $this->sql)) return false;
      if ($this->db->duplicateWrite && preg_match('/^(INSERT|UPDATE)/', $this->sql)) throw new mysqli_sql_exception('Duplicate username', 1062);
      // PDO otherwise converts referenced PHP integers to strings, unlike mysqli.
      $values = array_map(function($value) { return $value; }, $this->values);
      $result = $this->statement->execute($values);
      $this->affected_rows = $this->db->noOp ? 0 : $this->statement->rowCount();
      return $result;
    }
    public function get_result() { return new UserResult($this->statement->fetchAll(PDO::FETCH_ASSOC)); }
    public function close() { $this->statement->closeCursor(); }
  }
  class UserDatabase {
    public $pdo;
    public $failWrite = false;
    public $duplicateWrite = false;
    public $noOp = false;
    public function __construct() {
      $this->pdo = new PDO('sqlite::memory:');
      $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $this->pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT COLLATE NOCASE NOT NULL, password TEXT NOT NULL, type INTEGER NOT NULL, auth_version INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1)');
      $insert = $this->pdo->prepare('INSERT INTO users (id,name,username,password,type) VALUES (?, ?, ?, ?, ?)');
      $insert->execute([2, 'Admin', 'admin', md5('admin'), 1]);
      $insert->execute([3, 'Staff', 'staff', md5('staff'), 2]);
    }
    public function prepare($sql) { return new UserStatement($this, $sql); }
    public function query($sql) { return new UserResult($this->pdo->query(str_replace(' FOR UPDATE', '', $sql))->fetchAll(PDO::FETCH_ASSOC)); }
    public function begin_transaction() { return $this->pdo->beginTransaction(); }
    public function commit() { return $this->pdo->commit(); }
    public function rollback() { return $this->pdo->rollBack(); }
    public function snapshot() { return $this->pdo->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC); }
    public function close() {}
  }
  require 'admin_class.php';
  ob_start();
  $db = new UserDatabase();
  $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
  $property = new ReflectionProperty('Action', 'db');
  $property->setAccessible(true);
  $property->setValue($action, $db);
  ${allowLoginThrottle}
  ${allowCurrentPasswordThrottle}
  $_SERVER['REQUEST_METHOD'] = 'POST';
`;

function save(post, setup = '') {
  const response = run(session, `${database}
    $_POST = json_decode(${literal(JSON.stringify(post))}, true);
    ${setup}
    $before = $db->snapshot();
    $result = $action->save_user();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(['result' => $result, 'before' => $before, 'after' => $after, 'session' => $_SESSION]);
  `);
  return { status: response.status, ...JSON.parse(response.body) };
}

for (const type of ['1', '2']) {
  test(`Admin creates role ${type} using only real schema fields and the new account can log in`, () => {
    const post = { ...profile, type, establishment_id: 'ignored' };
    const response = run(session, `${database}
      $_POST = json_decode(${literal(JSON.stringify(post))}, true);
      $before = $db->snapshot();
      $saved = $action->save_user();
      $after = $db->snapshot();
      $_POST = ['username' => 'staff_test', 'password' => 'staff_test'];
      $_POST['csrf_token'] = csrf_token();
      $login = $action->login();
      unset($action);
      echo json_encode(['saved' => $saved, 'login' => $login, 'before' => $before, 'after' => $after, 'session' => $_SESSION]);
    `);
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body);
    assert.equal(data.saved, 1);
    assert.equal(data.login, 1);
    assert.deepEqual(data.after.slice(0, 2), data.before);
    assert.equal(data.after.length, 3);
    assert.equal(data.after[2].name, "Test O'Neil");
    assert.equal(data.after[2].username, 'staff_test');
    assertPassword(data.after[2].password, 'staff_test');
    assert.equal(data.after[2].type, Number(type));
    assert.equal(data.session.login_type, Number(type));
    assert.equal(data.session.login_password, undefined);
  });
}

test('editing a user with a blank password preserves the password and other accounts', () => {
  const data = save({ ...profile, id: '3', name: 'Updated Staff', username: 'renamed_staff', password: '' });
  assert.equal(data.result, 1);
  assert.equal(data.after.length, 2);
  assert.deepEqual(data.after[0], data.before[0]);
  assert.equal(data.after[1].id, 3);
  assert.equal(data.after[1].name, 'Updated Staff');
  assert.equal(data.after[1].username, 'renamed_staff');
  assert.equal(data.after[1].password, data.before[1].password);
});

test('editing may set a new password and role for the selected user', () => {
  const data = save({ ...profile, id: '3', type: '1', password: 'new-password' });
  assert.equal(data.result, 1);
  assertPassword(data.after[1].password, 'new-password');
  assert.equal(data.after[1].type, 1);
  assert.deepEqual(data.after[0], data.before[0]);
  assert.equal(data.session.login_type, 1);
});

for (const password of ['', 'new-account-password']) {
  test(`own-account update ${password ? 'hashes a new password and permits login' : 'preserves an existing modern hash'}`, () => {
    const response = run(session, `${database}
      $seed = $db->pdo->prepare('UPDATE users SET password = ? WHERE id = 2');
      $seed->execute([gym_password_hash('admin')]);
      $before = $db->snapshot();
      $_POST = ['version'=>'1','id'=> '2', 'name' => 'Admin Updated', 'username' => 'admin',
        'password' => ${literal(password)}, 'current_password'=>'admin', 'csrf_token' => 'users-test-token'];
      $saved = $action->save_account();
      $after = $db->snapshot();
      $_POST = ['username' => 'admin', 'password' => ${literal(password || 'admin')}];
      $_POST['csrf_token'] = csrf_token();
      $login = $action->login();
      $afterLogin = $db->snapshot();
      unset($action);
      echo json_encode(compact('saved', 'login', 'before', 'after', 'afterLogin'));
    `);
    const data = JSON.parse(response.body);
    assert.equal(data.saved, 1);
    assert.equal(data.login, 1);
    assertPassword(data.after[0].password, password || 'admin');
    assert.equal(data.after[0].password === data.before[0].password, !password);
    assert.deepEqual(data.after[1], data.before[1]);
    assert.deepEqual(data.afterLogin, data.after);
  });
}

test('a blank password in user management also preserves an existing Argon2id hash', () => {
  const data = save({ ...profile, id: '3', password: '' }, `
    $seed = $db->pdo->prepare('UPDATE users SET password = ? WHERE id = 3');
    $seed->execute([gym_password_hash('staff')]);
  `);
  assert.equal(data.result, 1);
  assert.equal(data.after[1].password, data.before[1].password);
});

test('editing the logged-in account refreshes its session profile and role', () => {
  const data = save({ ...profile, id: '2', username: 'renamed_admin', password: '', type: '2' }, "$db->pdo->exec('UPDATE users SET type=1 WHERE id=3');");
  assert.equal(data.result, 1);
  assert.equal(data.session.login_name, "Test O'Neil");
  assert.equal(data.session.login_username, 'renamed_admin');
  assert.equal(data.session.login_type, 2);
});

for (const id of ['', '3']) {
  test(`duplicate username is rejected for ${id ? 'edit' : 'add'}`, () => {
    const data = save({ ...profile, id, username: 'ADMIN' });
    assert.equal(data.status, 409);
    assert.equal(JSON.parse(data.result).error, 'Username already exists.');
    assert.deepEqual(data.after, data.before);
  });
}

test('keeping the same username on edit succeeds and increments the edit version', () => {
  const data = save({ ...profile, id: '3', name: 'Staff', username: 'staff', password: '' });
  assert.equal(data.status, 200);
  assert.equal(data.result, 1);
  assert.deepEqual(data.after, data.before.map(row=>row.id===3?{...row,version:2}:row));
});

test('unknown user ID returns 404 without modifying any account', () => {
  const data = save({ ...profile, id: '999' });
  assert.equal(data.status, 404);
  assert.deepEqual(data.after, data.before);
});

test('Unicode and SQL-like names are stored as data', () => {
  const data = save({ ...profile, name: "陈'); DELETE FROM users; -- <test>" });
  assert.equal(data.result, 1);
  assert.equal(data.after[2].name, "陈'); DELETE FROM users; -- <test>");
  assert.deepEqual(data.after.slice(0, 2), data.before);
});

for (const [label, patch] of [
  ['blank name', { name: '  ' }],
  ['blank username', { username: '' }],
  ['missing password for a new user', { password: '' }],
  ['array instead of password', { password: ['test'] }],
  ['array instead of text', { name: ['test'] }],
  ['long username', { username: 'x'.repeat(201) }],
  ['long name', { name: 'x'.repeat(201) }],
  ['unsupported role', { type: '3' }],
  ['missing role', { type: null }],
  ['array role', { type: ['1'] }],
  ['malformed role', { type: '1 OR 1=1' }],
  ['malformed ID', { version: '1', id: '3 OR 1=1' }],
  ['zero ID', { version: '1', id: '0' }],
]) {
  test(`${label} is rejected before changing accounts`, () => {
    const data = save({ ...profile, ...patch });
    assert.equal(data.status, 400);
    assert.ok(JSON.parse(data.result).error);
    assert.deepEqual(data.after, data.before);
  });
}

test('oversized password is rejected', () => {
  const data = save(profile, "$_POST['password'] = str_repeat('x', 4097);");
  assert.equal(data.status, 400);
  assert.deepEqual(data.after, data.before);
});

test('write failure returns a generic error without changing accounts', () => {
  const data = save(profile, '$db->failWrite = true;');
  assert.equal(data.status, 500);
  assert.equal(JSON.parse(data.result).error, 'Unable to save user. Please try again.');
  assert.deepEqual(data.after, data.before);
});

test('a database duplicate-key error is reported as a username conflict', () => {
  const data = save(profile, '$db->duplicateWrite = true;');
  assert.equal(data.status, 409);
  assert.equal(JSON.parse(data.result).error, 'Username already exists.');
  assert.deepEqual(data.after, data.before);
});

test('Staff cannot invoke save_user even with a valid CSRF token', () => {
  const response = run({ ...session, login_id: 3, login_type: 2 }, `${database}
    $_POST = json_decode(${literal(JSON.stringify(profile))}, true);
    $action->save_user(); echo 'SAVED';
  `);
  assert.equal(response.status, 403);
  assert.ok(JSON.parse(response.body).error);
});

for (const token of [null, '', 'wrong-token', ['token']]) {
  test(`save_user rejects CSRF token ${JSON.stringify(token)} before dispatch`, () => {
    const response = run(session, `
      $_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = json_decode(${literal(JSON.stringify({ ...profile, csrf_token: token }))}, true);
      require_action_access('save_user'); echo 'DISPATCHED';
    `);
    assert.equal(response.status, 403);
    assert.ok(JSON.parse(response.body).error);
  });
}

test('GET cannot save a user', () => {
  const response = run(session, `$_SERVER['REQUEST_METHOD'] = 'GET'; require_action_access('save_user');`);
  assert.equal(response.status, 405);
  assert.equal(JSON.parse(response.body).error, 'Use POST to save a user.');
});
