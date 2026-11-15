import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const admin = { login_id: 2, login_type: 1, csrf_token: 'plans-test-token' };
const profile = { id: '', plan: '6', amount: '120.50', version: '1', csrf_token: admin.csrf_token };
const database = `
  class PlanResult {
    private $statement;
    public function __construct($statement) { $this->statement = $statement; }
    public function fetch_assoc() { return $this->statement->fetch(PDO::FETCH_ASSOC); }
  }
  class PlanStatement {
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
      $values = array_map(function($value) { return $value; }, $this->values);
      $result = $this->statement->execute($values);
      $this->affected_rows = $this->db->noOp ? 0 : $this->statement->rowCount();
      return $result;
    }
    public function get_result() { return new PlanResult($this->statement); }
    public function close() { $this->statement->closeCursor(); }
  }
  class PlanDatabase {
    public $pdo;
    public $failWrite = false;
    public $noOp = false;
    public $failRead = false;
    public function __construct() {
      $this->pdo = new PDO('sqlite::memory:');
      $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $this->pdo->exec('CREATE TABLE plans (id INTEGER PRIMARY KEY AUTOINCREMENT, plan INTEGER NOT NULL, amount REAL NOT NULL)');
      $this->pdo->exec('INSERT INTO plans VALUES (1, 12, 1000), (2, 3, 250)');
      $this->pdo->exec('ALTER TABLE plans ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    }
    public function prepare($sql) {
      if ($this->failRead && str_starts_with($sql, 'SELECT')) return false;
      return new PlanStatement($this, $sql);
    }
    public function query($sql) { throw new RuntimeException('Use prepared SQL'); }
    public function snapshot() { return $this->pdo->query('SELECT * FROM plans ORDER BY id')->fetchAll(PDO::FETCH_ASSOC); }
    public function close() {}
  }
  require 'admin_class.php';
  ob_start();
  $db = new PlanDatabase();
  $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
  $property = new ReflectionProperty('Action', 'db');
  $property->setAccessible(true);
  $property->setValue($action, $db);
  $_SERVER['REQUEST_METHOD'] = 'POST';
`;

function save(post, setup = '', options = {}) {
  const response = run(admin, `${database}
    $_POST = json_decode(${literal(JSON.stringify(post))}, true);
    ${setup}
    $before = $db->snapshot();
    $result = $action->save_plan();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(compact('result', 'before', 'after'));
  `, options);
  return { status: response.status, ...JSON.parse(response.body) };
}

test('adding a valid plan stores months and amount without changing existing plans', () => {
  const data = save(profile);
  assert.equal(data.result, 1);
  assert.deepEqual(data.after.slice(0, 2), data.before);
  assert.deepEqual(data.after[2], { id: 3, plan: 6, amount: 120.5, version: 1 });
});

test('editing changes only the selected plan', () => {
  const data = save({ ...profile, id: '2' });
  assert.equal(data.result, 1);
  assert.deepEqual(data.after[0], data.before[0]);
  assert.deepEqual(data.after[1], { id: 2, plan: 6, amount: 120.5, version: 2 });
});

test('zero amount remains valid', () => {
  const data = save({ ...profile, amount: '0.00' });
  assert.equal(data.result, 1);
  assert.equal(data.after[2].amount, 0);
});

test('saving unchanged values succeeds and advances the edit version', () => {
  const data = save({ ...profile, id: '2', plan: '3', amount: '250' });
  assert.equal(data.result, 1);
  const expected=structuredClone(data.before);expected[1].version=2;
  assert.deepEqual(data.after, expected);
});

for (const [label, patch] of [
  ['negative amount', { amount: '-10' }], ['blank amount', { amount: '' }],
  ['fractional cents', { amount: '1.001' }], ['infinite amount', { amount: 'INF' }],
  ['exponent amount', { amount: '1e3' }], ['array amount', { amount: ['1'] }],
  ['negative months', { plan: '-1' }], ['zero months', { plan: '0' }],
  ['fractional months', { plan: '1.5' }], ['missing months', { plan: null }],
  ['array months', { plan: ['1'] }], ['boolean months', { plan: true }],
  ['oversized months', { plan: '2147483648' }], ['invalid ID', { id: '2 OR 1=1' }],
  ['zero ID', { id: '0' }], ['array ID', { id: ['2'] }], ['boolean ID', { id: true }],
  ['SQL in months', { plan: "1'; DROP TABLE plans; --" }],
  ['SQL in amount', { amount: "1', plan=0 --" }],
]) {
  test(`${label} is rejected before any record changes`, () => {
    const data = save({ ...profile, ...patch });
    assert.equal(data.status, 400);
    assert.equal(typeof JSON.parse(data.result).error, 'string');
    assert.deepEqual(data.after, data.before);
  });
}

test('an unknown plan is not reported as successfully updated', () => {
  const data = save({ ...profile, id: '999' });
  assert.equal(data.status, 404);
  assert.deepEqual(data.after, data.before);
});

test('write failure returns a safe error without changing records', () => {
  const data = save(profile, '$db->failWrite = true;');
  assert.equal(data.status, 500);
  assert.equal(JSON.parse(data.result).error, 'Unable to save plan. Please try again.');
  assert.deepEqual(data.after, data.before);
});

test('read failure returns a safe error without claiming a missing record', () => {
  const data = save({ ...profile, id: '2' }, "$db->failRead = true; ini_set('error_log', '');", {
    expectedStderr: /^Unable to save plan \(error code 0\)\.\r?\n$/,
  });
  assert.equal(data.status, 500);
  assert.deepEqual(data.after, data.before);
});

for (const token of [null, '', 'incorrect', ['token']]) {
  test(`CSRF ${JSON.stringify(token)} is rejected before dispatch`, () => {
    const response = run(admin, `$_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = json_decode(${literal(JSON.stringify({ ...profile, csrf_token: token }))}, true);
      require_action_access('save_plan'); echo 'DISPATCHED';`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(response.body, /DISPATCHED/);
  });
}

test('GET and Staff cannot save plans', () => {
  const get = run(admin, "$_SERVER['REQUEST_METHOD'] = 'GET'; require_action_access('save_plan');");
  assert.equal(get.status, 405);
  const staff = run({ ...admin, login_type: 2 }, "require_action_access('save_plan');");
  assert.equal(staff.status, 403);
});

test('the rendered plan page has clean Edit attributes and a CSRF-protected validated form', () => {
  const response = run(admin, "include 'plans.php';");
  assert.equal(response.status, 200);
  assert.doesNotMatch(response.body, /Warning|Fatal error|data-description/);
  assert.match(response.body, /action="ajax.php\?action=save_plan" method="post"/);
  assert.match(response.body, /name="csrf_token" value="plans-test-token"/);
  assert.match(response.body, /min="0" step="0.01" name="amount" max="9999999999\.99" required/);
  assert.match(response.body, /<script src="assets\/js\/plans.js\?v=\d+"><\/script>/);
  assert.match(response.body, /data-id="\d+" data-plan="\d+" data-amount="[^"]+" data-version="\d+">Edit/);
});
