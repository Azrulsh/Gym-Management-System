import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const admin = { login_id: 2, login_type: 1, csrf_token: 'payments-test-token' };
const profile = { registration_id: '9', amount: '10.25', remarks: ` Member's payment `, csrf_token: admin.csrf_token };
const database = `
  class PaymentResult {
    private $statement;
    public function __construct($statement) { $this->statement = $statement; }
    public function fetch_assoc() { return $this->statement->fetch(PDO::FETCH_ASSOC); }
  }
  class PaymentStatement {
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
      $this->pdo->exec('CREATE TABLE registration_info (id INTEGER PRIMARY KEY)');
      $this->pdo->exec('INSERT INTO registration_info VALUES (9), (10)');
      $this->pdo->exec('CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, registration_id INTEGER, amount NUMERIC, remarks TEXT, type INTEGER)');
      $this->pdo->exec("INSERT INTO payments VALUES (1, 10, 500, 'Existing payment', 2)");
    }
    public function prepare($sql) {
      if ($this->failRead && str_starts_with($sql, 'SELECT')) return false;
      return new PaymentStatement($this, $sql);
    }
    public function query($sql) { throw new RuntimeException('Use prepared SQL'); }
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
    assert.deepEqual(data.after[1], { id: 2, registration_id: 9, amount: 10.25, remarks: "Member's payment", type: 2 });
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
    class PaymentPageResult {
      public function fetch_assoc() { return ['id' => 9, 'pamount' => 100, 'ppamount' => 20, 'trainer_fee' => 0]; }
      public function fetch_all($mode) { return [['amount' => '10.25', 'remarks' => '<img src=x onerror="alert(1)">', 'date_created' => '2026-01-01']]; }
    }
    class PaymentPageStatement {
      public function bind_param($types, &...$values) {}
      public function execute() { return true; }
      public function get_result() { return new PaymentPageResult(); }
      public function close() {}
    }
    class PaymentPageDatabase { public function prepare($sql) { return new PaymentPageStatement(); } }
    $_GET['rid'] = '9';
    $page = str_replace("include 'db_connect.php';", '$conn = new PaymentPageDatabase();', file_get_contents('payment.php'));
    eval('?>' . $page);
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
    require 'tests/helpers/throttle-db.php';
    with_throttle_database(function($db, $schema) {
      $db->query('CREATE TABLE registration_info (id INT PRIMARY KEY) ENGINE=InnoDB');
      $db->query('INSERT INTO registration_info VALUES (9)');
      $db->query('CREATE TABLE payments (id INT PRIMARY KEY AUTO_INCREMENT, registration_id INT, amount INT NOT NULL, remarks TEXT NOT NULL, type TINYINT NOT NULL DEFAULT 2) ENGINE=InnoDB');
      $db->query("INSERT INTO payments (registration_id, amount, remarks) VALUES (9, -11, 'old'), (9, 5000, 'old')");
      $db->query(file_get_contents('database/migrations/002_payment_amount_decimal.sql'));
      ob_start();
      $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
      $property = new ReflectionProperty('Action', 'db');
      $property->setAccessible(true);
      $property->setValue($action, $db);
      $_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = ['registration_id' => '9', 'amount' => '10.25', 'remarks' => "Member's payment", 'csrf_token' => 'payments-test-token'];
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

