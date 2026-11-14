// Run: node --test tests/roles.test.mjs
// PHP sessions and database objects are simulated in isolated CLI processes.
// No application records or PHP session files are created or changed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';
import { allowLoginThrottle } from './helpers/throttle.mjs';

const staff = { login_id: 9999, login_type: 2, login_name: 'Test Staff', csrf_token: 'test-csrf-token' };
const admin = { login_id: 2, login_type: 1, login_name: 'Test Admin' };

const sharedActions = [
  'logout', 'save_member', 'delete_member', 'save_membership', 'renew_membership',
  'end_membership', 'save_schedule', 'delete_schedule', 'get_schecdule', 'save_payment', 'save_account',
];
const adminActions = [
  'save_user', 'delete_user', 'save_plan', 'delete_plan', 'save_package',
  'delete_package', 'save_trainer', 'delete_trainer',
];
const unsupportedActions = ['signup', 'login2', 'update_account', 'delete_forum', 'unknown', 'save_settings'];

for (const [label, session, allowed] of [
  ['Admin', admin, [...sharedActions, ...adminActions]],
  ['Staff', staff, sharedActions],
  ['unsupported role', { login_id: 9999, login_type: 3 }, []],
  ['missing role', { login_id: 9999 }, []],
  ['anonymous', {}, []],
]) {
  test(`${label} has only the explicitly allowed actions`, () => {
    const actions = [...sharedActions, ...adminActions, ...unsupportedActions];
    const result = run(session, `
      $actions = json_decode(${literal(JSON.stringify(actions))}, true);
      echo json_encode(array_map('can_access_action', $actions));
    `);
    assert.deepEqual(JSON.parse(result.body), actions.map(action => allowed.includes(action)));
  });
}

for (const action of adminActions) {
  test(`Staff ${action} returns 403 before dispatch`, () => {
    const result = run(staff, `require_action_access(${literal(action)}); echo 'DISPATCHED';`);
    assert.equal(result.status, 403);
    assert.deepEqual(JSON.parse(result.body), { error: 'You do not have permission to perform this action.' });
  });
}

for (const page of ['plans', 'packages', 'trainer', 'users', 'events']) {
  test(`Staff cannot open ${page} directly or through index.php`, () => {
    for (const code of [
      `include '${page}.php';`,
      `$_GET['page'] = '${page}'; include 'index.php';`,
    ]) {
      const result = run(staff, code);
      assert.equal(result.status, 403);
      assert.match(result.body, /Access denied/);
      assert.match(result.body, /bootstrap.min.css/);
      assert.doesNotMatch(result.body, /Fatal error|Warning|id="view-panel"/);
    }
  });
}

test('Staff cannot open user-management forms, including a forged own-account request', () => {
  for (const query of [{}, { id: '2' }, { id: '2', mtype: 'own' }, { id: '9999 OR 1=1', mtype: 'own' }]) {
    const result = run(staff, `$_GET = json_decode(${literal(JSON.stringify(query))}, true); include 'manage_user.php';`);
    assert.equal(result.status, 403);
    assert.doesNotMatch(result.body, /<form\b|Fatal error|Warning/);
  }
});

test('own-account action accepts only the session owner and cannot change role', () => {
  for (const [post, expectedStatus] of [
    [{ id: '9999' }, 200],
    [{ id: '9999', type: '2' }, 200],
    [{ id: '2' }, 403],
    [{ id: '9999', type: '1' }, 403],
    [{ id: '9999', type: ['1'] }, 403],
    [{ id: '9999 OR 1=1' }, 403],
    [{ id: '9999', csrf_token: 'incorrect' }, 403],
    [{ id: '9999', csrf_token: null }, 403],
    [{}, 403],
  ]) {
    const result = run(staff, `
      $_POST = json_decode(${literal(JSON.stringify({ csrf_token: 'test-csrf-token', ...post }))}, true);
      require_action_access('save_account'); echo 'ALLOWED';
    `);
    assert.equal(result.status, expectedStatus, JSON.stringify(post));
    if (expectedStatus === 200) assert.equal(result.body, 'ALLOWED');
  }
});

test('unsupported roles cannot access protected pages', () => {
  const result = run({ login_id: 9999, login_type: 3 }, 'require_login(true);');
  assert.equal(result.status, 403);
});

test('page paths cannot bypass the page allowlist', () => {
  for (const page of ['../users', './users', 'manage_user', 'admin_class', ['users']]) {
    const result = run(admin, `$_GET['page'] = json_decode(${literal(JSON.stringify(page))}, true); include 'index.php';`);
    assert.equal(result.status, 404);
    assert.equal(result.body, 'Page not found.');
  }
});

// Action methods use this recording database only; no SQL reaches MySQL.
const recordingDatabase = `
  class RecordingStatement {
    public $affected_rows = 1;
    public $sql;
    public $values;
    private $db;
    public function __construct($sql, $db) { $this->sql = $sql; $this->db = $db; }
    public function bind_param($types, &...$values) { $this->values = $values; }
    public function execute() { return true; }
    public function get_result() {
      if (strpos($this->sql, 'SELECT password, auth_version') === 0) {
        return new class { public function fetch_assoc() { return ['password'=>gym_password_hash('test'), 'auth_version'=>1]; } };
      }
      if (strpos($this->sql, 'SELECT id, name, username, type') === 0) {
        return new class($this->db->role) {
          private $role;
          public function __construct($role) { $this->role = $role; }
          public function fetch_assoc() { return ['id' => 9999, 'type' => $this->role, 'name' => 'Test User', 'username' => 'test', 'password' => gym_password_hash('test'), 'auth_version'=>1]; }
        };
      }
      return (object) ['num_rows' => 0];
    }
    public function close() {}
  }
  class RecordingDatabase {
    public $statements = [];
    public $role;
    public function query($sql) { throw new RuntimeException('Expected a prepared statement'); }
    public function prepare($sql) {
      $statement = new RecordingStatement($sql, $this);
      $this->statements[] = $statement;
      return $statement;
    }
    public function close() {}
  }
  require 'admin_class.php';
  ob_start();
  $db = new RecordingDatabase();
  $reflection = new ReflectionClass('Action');
  $action = $reflection->newInstanceWithoutConstructor();
  $property = $reflection->getProperty('db');
  $property->setAccessible(true);
  $property->setValue($action, $db);
  ${allowLoginThrottle}
  $_SERVER['REQUEST_METHOD'] = 'POST';
`;

for (const [role, expected] of [[1, 1], [2, 1], [3, 2]]) {
  test(`login handles database role ${role} correctly`, () => {
    const result = run({}, `${recordingDatabase}
      $db->role = ${role};
      $_POST = ['username' => 'test', 'password' => 'test'];
      $result = $action->login();
      unset($action);
      echo json_encode(['result' => $result, 'session' => $_SESSION]);
    `);
    const data = JSON.parse(result.body);
    assert.equal(data.result, expected);
    if (expected === 1) {
      assert.equal(data.session.login_type, role);
      assert.equal(data.session.login_password, undefined);
    } else {
      assert.deepEqual(data.session, []);
    }
  });
}

test('own-account update binds profile values, targets the session ID, and never updates role', () => {
  for (const password of ['', 'new test password']) {
    const name = "O'Neil <test>";
    const result = run(staff, `${recordingDatabase}
      $_POST = json_decode(${literal(JSON.stringify({ id: '9999', name, username: 'test_staff', password, current_password: 'test', csrf_token: 'test-csrf-token' }))}, true);
      $result = $action->save_account();
      unset($action);
      echo json_encode(['result' => $result, 'statements' => $db->statements, 'session' => $_SESSION]);
    `);
    const data = JSON.parse(result.body);
    assert.equal(data.result, 1);
    const update = data.statements.at(-1);
    assert.match(update.sql, /WHERE id = \?/);
    assert.doesNotMatch(update.sql, /\btype\b|establishment_id|O'Neil/);
    assert.equal(update.values[0], name);
    assert.equal(update.values.at(password ? -2 : -1), 9999);
    assert.equal(data.session.login_type, 2);
    assert.equal(data.session.login_name, name);
  }
});
