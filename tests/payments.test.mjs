import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const admin = { login_id: 2, login_type: 1, csrf_token: 'payments-test-token' };
const profile = { registration_id: '9', amount: '10.25', remarks: ` Member's payment `, csrf_token: admin.csrf_token, request_key: 'a'.repeat(64) };
const database = `
  class PaymentResult {
    private $statement;
    public function __construct($statement) { $this->statement = $statement; }
    public function fetch_assoc() { return $this->statement->fetch(PDO::FETCH_ASSOC); }
    public function fetch_all($mode) { return $this->statement->fetchAll(PDO::FETCH_ASSOC); }
  }
  class PaymentStatement {
    private $db;
    private $sql;
    private $statement;
    private $values;
    public $affected_rows = 0;
    public function __construct($db, $sql) { $this->db = $db; $this->sql = $sql; $this->statement = $db->pdo->prepare(str_replace(' FOR UPDATE', '', $sql)); }
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
    public function get_result() { return new PaymentResult($this->statement); }
    public function close() { $this->statement->closeCursor(); }
  }
  class PaymentDatabase {
    public $pdo;
    public $failWrite = false;
    public $noOp = false;
    public $failRead = false;
    public function __construct() {
      $this->pdo = new PDO('sqlite::memory:');
      $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $this->pdo->sqliteCreateFunction('CONCAT_WS', function($separator, ...$values) { return implode($separator, array_filter($values, function($value) { return $value !== null; })); }, -1);
      $this->pdo->exec('CREATE TABLE members (id INTEGER PRIMARY KEY, member_id INTEGER, firstname TEXT, lastname TEXT, middlename TEXT)');
      $this->pdo->exec("INSERT INTO members VALUES (9, 10009, 'Test', 'User', ''), (10, 10010, 'Another', 'User', '')");
      $this->pdo->exec('CREATE TABLE plans (id INTEGER PRIMARY KEY, plan INTEGER, amount NUMERIC)');
      $this->pdo->exec('INSERT INTO plans VALUES (1, 3, 100)');
      $this->pdo->exec('CREATE TABLE packages (id INTEGER PRIMARY KEY, package TEXT, amount NUMERIC)');
      $this->pdo->exec("INSERT INTO packages VALUES (1, 'Test Package', 20)");
      $this->pdo->exec('CREATE TABLE trainers (id INTEGER PRIMARY KEY, name TEXT, rate NUMERIC)');
      $this->pdo->exec("CREATE TABLE registration_info (id INTEGER PRIMARY KEY, member_id INTEGER, plan_id INTEGER, package_id INTEGER, trainer_id INTEGER, status INTEGER, start_date TEXT, end_date TEXT, plan_fee NUMERIC DEFAULT 100, package_fee NUMERIC DEFAULT 20, trainer_fee_snapshot NUMERIC DEFAULT 10, price_source TEXT DEFAULT 'captured')");
      $today = date('Y-m-d'); $end = date('Y-m-d', strtotime('+1 year'));
      $this->pdo->exec("INSERT INTO registration_info (id,member_id,plan_id,package_id,trainer_id,status,start_date,end_date) VALUES (9, 9, 1, 1, 0, 1, '$today', '$end'), (10, 10, 1, 1, 0, 1, '$today', '$end')");
      $this->pdo->exec('ALTER TABLE registration_info ADD COLUMN plan_months INTEGER DEFAULT 3');
      $this->pdo->exec('CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, registration_id INTEGER, amount NUMERIC, remarks TEXT, type INTEGER, plan_amount NUMERIC, request_key TEXT UNIQUE)');
      $this->pdo->exec("INSERT INTO payments VALUES (1, 10, 500, 'Existing payment', 2, NULL, NULL)");
    }
    public function prepare($sql) {
      if ($this->failRead && str_starts_with($sql, 'SELECT')) return false;
      return new PaymentStatement($this, $sql);
    }
    public function query($sql) { throw new RuntimeException('Use prepared SQL'); }
    public function begin_transaction() { return $this->pdo->beginTransaction(); }
    public function commit() { return $this->pdo->commit(); }
    public function rollback() { return $this->pdo->rollBack(); }
    public function snapshot() { return $this->pdo->query('SELECT * FROM payments ORDER BY id')->fetchAll(PDO::FETCH_ASSOC); }
    public function close() {}
  }
  require 'admin_class.php';
  ob_start();
  $db = new PaymentDatabase();
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
    $result = $action->save_payment();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(compact('result', 'before', 'after'));
  `, options);
  return { status: response.status, ...JSON.parse(response.body) };
}

for (const role of [1, 2]) {
  test(`role ${role} can save apostrophes and cents without changing existing payments`, () => {
    const data = save(profile, `$_SESSION['login_type'] = ${role};`);
    assert.equal(data.result, 1);
    assert.deepEqual(data.after.slice(0, 1), data.before);
    assert.deepEqual(data.after[1], { id: 2, registration_id: 9, amount: 10.25, remarks: "Member's payment", type: 2, plan_amount: 0, request_key: profile.request_key });
  });
}

test('unapproved POST columns cannot override payment metadata', () => {
  const data = save({ ...profile, id: '1', type: '1', date_created: '2000-01-01', status: '0' });
  assert.equal(data.result, 1);
  assert.deepEqual(data.after[0], data.before[0]);
  assert.equal(data.after[1].id, 2);
  assert.equal(data.after[1].type, 2);
});

test('SQL and HTML text in remarks is stored as data and optional remarks can be blank', () => {
  const remarks = `O'Neil "; DROP TABLE payments; -- <b>Test</b>`;
  const data = save({ ...profile, remarks });
  assert.equal(data.result, 1);
  assert.equal(data.after[1].remarks, remarks);
  assert.deepEqual(data.after[0], data.before[0]);
  assert.equal(save({ ...profile, remarks: '' }).result, 1);
});

for (const [label, patch] of [
  ['negative amount', { amount: '-10' }], ['zero amount', { amount: '0.00' }],
  ['blank amount', { amount: '' }], ['too many cents', { amount: '10.001' }],
  ['overflow amount', { amount: '10000000000' }], ['non-numeric amount', { amount: 'ten' }],
  ['exponent amount', { amount: '1e3' }], ['array amount', { amount: ['10'] }],
  ['SQL amount', { amount: "1', type=1 --" }], ['array remarks', { remarks: ['test'] }],
  ['missing ID', { registration_id: null }], ['zero ID', { registration_id: '0' }],
  ['negative ID', { registration_id: '-1' }], ['SQL ID', { registration_id: '9 OR 1=1' }],
  ['array ID', { registration_id: ['9'] }], ['boolean ID', { registration_id: true }],
]) {
  test(`${label} is rejected without changing payments`, () => {
    const data = save({ ...profile, ...patch });
    assert.equal(data.status, 400);
    assert.deepEqual(data.after, data.before);
  });
}

test('oversized or malformed remarks are rejected', () => {
  for (const setup of ["$_POST['remarks'] = str_repeat('x', 65536);", "$_POST['remarks'] = chr(255);"]) {
    const data = save(profile, setup);
    assert.equal(data.status, 400);
    assert.deepEqual(data.after, data.before);
  }
});

test('missing membership returns 404 and writes no orphan payment', () => {
  const data = save({ ...profile, registration_id: '999' });
  assert.equal(data.status, 404);
  assert.deepEqual(data.after, data.before);
});

test('missing request key is rejected without inserting a payment', () => {
  const {request_key,...post}=profile;
  const data=save(post);
  assert.equal(data.status,400);assert.deepEqual(data.after,data.before);
});

test('write failure returns a safe error without claiming success', () => {
  const data = save(profile, '$db->failWrite = true;');
  assert.equal(data.status, 500);
  assert.equal(JSON.parse(data.result).error, 'Unable to save payment. Please try again.');
  assert.deepEqual(data.after, data.before);
});

for (const token of [null, '', 'wrong', ['token']]) {
  test(`invalid CSRF ${JSON.stringify(token)} is rejected before dispatch`, () => {
    const response = run(admin, `$_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = json_decode(${literal(JSON.stringify({ ...profile, csrf_token: token }))}, true);
      require_action_access('save_payment'); echo 'DISPATCHED';`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(response.body, /DISPATCHED/);
  });
}

test('GET cannot save a payment', () => {
  assert.equal(run(admin, "$_SERVER['REQUEST_METHOD'] = 'GET'; require_action_access('save_payment');").status, 405);
});

test('payment modal validates missing and malformed IDs before reading the database', () => {
  for (const rid of [null, '9 OR 1=1', '0', ['9']]) {
    const response = run(admin, `$_GET['rid'] = json_decode(${literal(JSON.stringify(rid))}, true); include 'payment.php';`);
    assert.equal(response.status, 400);
    assert.doesNotMatch(response.body, /Warning|Fatal error|<form/);
  }
});

test('modal safely displays saved remarks and decimal amounts and handles absent trainer', () => {
  const response = run(admin, `
    require 'tests/helpers/membership-read-db.php';
    with_membership_read_database(function($db,$schema) {
      $db->query('UPDATE registration_info SET trainer_id=0 WHERE id=9');
      $statement=$db->prepare('INSERT INTO payments (registration_id,amount,remarks) VALUES (9,10.25,?)');
      $remarks='<img src=x onerror="alert(1)">'; $statement->bind_param('s',$remarks); $statement->execute(); $statement->close();
      echo render_membership_read_page($db,'payment.php',['rid'=>'9']);
    });
  `);
  assert.doesNotMatch(response.body, /Warning|Fatal error|<img src=x/);
  assert.match(response.body, /10\.25/);
  assert.match(response.body, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(response.body, /name="csrf_token" value="payments-test-token"/);
  assert.match(response.body, /action="ajax.php\?action=save_payment" method="post"/);
  assert.match(response.body, /min="0.01" max="9999999999.99" step="0.01" required/);
});

test('MariaDB decimal migration preserves old integer amounts and saves cents exactly', () => {
  const response = run(admin, `
    require 'tests/helpers/membership-read-db.php';
    with_membership_read_database(function($db, $schema) {
      $db->query('DELETE FROM payments');
      $db->query('ALTER TABLE payments MODIFY amount INT NOT NULL');
      $db->query("INSERT INTO payments (registration_id, amount, remarks) VALUES (9, -11, 'old'), (9, 5000, 'old')");
      $db->query(file_get_contents('database/migrations/002_payment_amount_decimal.sql'));
      ob_start();
      $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
      $property = new ReflectionProperty('Action', 'db');
      $property->setAccessible(true);
      $property->setValue($action, $db);
      $_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = ['registration_id' => '9', 'amount' => '10.25', 'remarks' => "Member's payment", 'csrf_token' => 'payments-test-token'];
      $_POST['request_key'] = str_repeat('a',64);
      $saved = $action->save_payment();
      $amounts = $db->query('SELECT amount FROM payments ORDER BY id')->fetch_all(MYSQLI_NUM);
      $property->setValue($action, new class { public function close() {} });
      unset($action);
      echo json_encode(compact('saved', 'amounts'));
    });
  `);
  const data = JSON.parse(response.body);
  assert.equal(data.saved, 1);
  assert.deepEqual(data.amounts, [['-11.00'], ['5000.00'], ['10.25']]);
});

