// Run: node --test tests/membership.test.mjs
// Execute the real Action method against SQLite in memory, never the application database.
import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 3, login_type: 2, csrf_token: 'membership-test-token' };
const request = { rid: '9', csrf_token: session.csrf_token };

// Adapt mysqli's small statement interface to a real, isolated SQL database.
const database = `
  class MemoryStatement {
    private $statement;
    private $values;
    public $affected_rows = 0;
    public function __construct($statement) { $this->statement = $statement; }
    public function bind_param($types, &...$values) { $this->values = $values; }
    public function execute() {
      $result = $this->statement->execute($this->values);
      $this->affected_rows = $this->statement->rowCount();
      return $result;
    }
    public function close() { $this->statement->closeCursor(); }
  }
  class MemoryDatabase {
    public $pdo;
    public $fail = false;
    public function __construct() {
      $this->pdo = new PDO('sqlite::memory:');
      $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $this->pdo->exec('CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT)');
      $this->pdo->exec("INSERT INTO members VALUES (9, 'Other member'), (10, 'Selected member'), (11, 'Another member')");
      $this->pdo->exec('CREATE TABLE registration_info (id INTEGER PRIMARY KEY, member_id INTEGER, status INTEGER)');
      $this->pdo->exec('INSERT INTO registration_info VALUES (8, 10, 0), (9, 10, 1), (12, 11, 1)');
      $this->pdo->exec('CREATE TABLE payments (id INTEGER PRIMARY KEY, registration_id INTEGER, amount INTEGER)');
      $this->pdo->exec('INSERT INTO payments VALUES (1, 9, 500)');
    }
    public function prepare($sql) {
      return $this->fail ? false : new MemoryStatement($this->pdo->prepare($sql));
    }
    public function snapshot() {
      $data = [];
      foreach (['members', 'registration_info', 'payments'] as $table) {
        $data[$table] = $this->pdo->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
      }
      return $data;
    }
    public function close() {}
  }
  require 'admin_class.php';
  ob_start();
  $db = new MemoryDatabase();
  $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
  $property = new ReflectionProperty('Action', 'db');
  $property->setAccessible(true);
  $property->setValue($action, $db);
  $_SERVER['REQUEST_METHOD'] = 'POST';
`;

for (const role of [1, 2]) {
  test(`role ${role} ends registration 9 without deleting member 9, member 10 or payment history`, () => {
    const result = run({ ...session, login_type: role }, `${database}
      $_POST = json_decode(${literal(JSON.stringify(request))}, true);
      $before = $db->snapshot();
      $result = $action->end_membership();
      $after = $db->snapshot();
      unset($action);
      echo json_encode(['result' => $result, 'before' => $before, 'after' => $after]);
    `);
    assert.equal(result.status, 200);
    const data = JSON.parse(result.body);
    assert.equal(data.result, 1);
    assert.deepEqual(data.after.members, data.before.members);
    assert.deepEqual(data.after.payments, data.before.payments);
    assert.deepEqual(data.after.registration_info, data.before.registration_info.map(row => (
      row.id === 9 ? { ...row, status: 0 } : row
    )));
  });
}

for (const rid of ['8', '999']) {
  test(`inactive or missing registration ${rid} returns conflict without changing data`, () => {
    const result = run(session, `${database}
      $_POST = json_decode(${literal(JSON.stringify({ ...request, rid }))}, true);
      $before = $db->snapshot();
      $result = $action->end_membership();
      $after = $db->snapshot();
      unset($action);
      echo json_encode(['result' => json_decode($result, true), 'before' => $before, 'after' => $after]);
    `);
    assert.equal(result.status, 409);
    const data = JSON.parse(result.body);
    assert.match(data.result.error, /already ended or no longer exists/);
    assert.deepEqual(data.after, data.before);
  });
}

test('repeating the same request reports success only once', () => {
  const result = run(session, `${database}
    $_POST = json_decode(${literal(JSON.stringify(request))}, true);
    $first = $action->end_membership();
    $before = $db->snapshot();
    $second = $action->end_membership();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(['first' => $first, 'second' => json_decode($second, true), 'before' => $before, 'after' => $after]);
  `);
  assert.equal(result.status, 409);
  const data = JSON.parse(result.body);
  assert.equal(data.first, 1);
  assert.ok(data.second.error);
  assert.deepEqual(data.after, data.before);
});

for (const rid of [null, '', 0, -1, '9 OR 1=1', ['9']]) {
  test(`invalid registration ID ${JSON.stringify(rid)} is rejected without changes`, () => {
    const result = run(session, `${database}
      $_POST = json_decode(${literal(JSON.stringify({ ...request, rid }))}, true);
      $before = $db->snapshot();
      $result = $action->end_membership();
      $after = $db->snapshot();
      unset($action);
      echo json_encode(['result' => json_decode($result, true), 'before' => $before, 'after' => $after]);
    `);
    assert.equal(result.status, 400);
    const data = JSON.parse(result.body);
    assert.equal(data.result.error, 'Invalid membership ID.');
    assert.deepEqual(data.after, data.before);
  });
}

test('database failure returns a generic error and never success', () => {
  const result = run(session, `${database}
    $_POST = json_decode(${literal(JSON.stringify(request))}, true);
    $db->fail = true;
    $before = $db->snapshot();
    $result = $action->end_membership();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(['result' => json_decode($result, true), 'before' => $before, 'after' => $after]);
  `);
  assert.equal(result.status, 500);
  const data = JSON.parse(result.body);
  assert.equal(data.result.error, 'Unable to end membership. Please try again.');
  assert.deepEqual(data.after, data.before);
});

for (const token of [null, '', 'wrong-token', ['token']]) {
  test(`end-membership rejects CSRF token ${JSON.stringify(token)} before dispatch`, () => {
    const result = run(session, `
      $_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = json_decode(${literal(JSON.stringify({ rid: '9', csrf_token: token }))}, true);
      require_action_access('end_membership'); echo 'DISPATCHED';
    `);
    assert.equal(result.status, 403);
    assert.ok(JSON.parse(result.body).error);
  });
}

test('GET cannot end a membership', () => {
  const result = run(session, `$_SERVER['REQUEST_METHOD'] = 'GET'; require_action_access('end_membership');`);
  assert.equal(result.status, 405);
  assert.deepEqual(JSON.parse(result.body), { error: 'Use POST to end a membership.' });
});
