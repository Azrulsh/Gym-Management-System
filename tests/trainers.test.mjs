import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const admin = { login_id: 2, login_type: 1, csrf_token: 'trainers-test-token' };
const profile = { id: '', name: ` O'Neil Trainer `, email: ' trainer@example.com ', contact: ' 0123456789 ', rate: '120.50', csrf_token: admin.csrf_token };
const database = `
  class TrainerResult {
    private $statement;
    public function __construct($statement) { $this->statement = $statement; }
    public function fetch_assoc() { return $this->statement->fetch(PDO::FETCH_ASSOC); }
  }
  class TrainerStatement {
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
    public function get_result() { return new TrainerResult($this->statement); }
    public function close() { $this->statement->closeCursor(); }
  }
  class TrainerDatabase {
    public $pdo;
    public $failWrite = false;
    public $noOp = false;
    public $failRead = false;
    public function __construct() {
      $this->pdo = new PDO('sqlite::memory:');
      $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $this->pdo->exec('CREATE TABLE trainers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, contact TEXT NOT NULL, rate REAL NOT NULL)');
      $this->pdo->exec("INSERT INTO trainers VALUES (1, 'First Trainer', 'first@example.com', '0111111111', 1000), (2, 'Second Trainer', 'second@example.com', '0222222222', 250)");
    }
    public function prepare($sql) {
      if ($this->failRead && str_starts_with($sql, 'SELECT')) return false;
      return new TrainerStatement($this, $sql);
    }
    public function query($sql) { throw new RuntimeException('Use prepared SQL'); }
    public function snapshot() { return $this->pdo->query('SELECT * FROM trainers ORDER BY id')->fetchAll(PDO::FETCH_ASSOC); }
    public function close() {}
  }
  require 'admin_class.php';
  ob_start();
  $db = new TrainerDatabase();
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
    $result = $action->save_trainer();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(compact('result', 'before', 'after'));
  `, options);
  return { status: response.status, ...JSON.parse(response.body) };
}

test('adding a trainer accepts apostrophes and preserves leading zeroes in contact numbers', () => {
  const data = save(profile);
  assert.equal(data.result, 1);
  assert.deepEqual(data.after.slice(0, 2), data.before);
  assert.deepEqual(data.after[2], { id: 3, name: "O'Neil Trainer", email: 'trainer@example.com', contact: '0123456789', rate: 120.5 });
});

test('editing changes only the selected trainer', () => {
  const data = save({ ...profile, id: '2' });
  assert.equal(data.result, 1);
  assert.deepEqual(data.after[0], data.before[0]);
  assert.deepEqual(data.after[1], { id: 2, name: "O'Neil Trainer", email: 'trainer@example.com', contact: '0123456789', rate: 120.5 });
});

test('unchanged values succeed even when the database reports no changes', () => {
  const data = save({ ...profile, id: '2', name: 'Second Trainer', email: 'second@example.com', contact: '0222222222', rate: '250' }, '$db->noOp = true;');
  assert.equal(data.result, 1);
  assert.deepEqual(data.after, data.before);
});

test('zero rate and a formatted international contact remain valid', () => {
  const data = save({ ...profile, rate: '0.00', contact: '+60 (12) 345-6789' });
  assert.equal(data.result, 1);
  assert.equal(data.after[2].rate, 0);
  assert.equal(data.after[2].contact, '+60 (12) 345-6789');
});

test('Unicode and SQL-looking or HTML-looking names are stored as bound data', () => {
  const name = `教练 O'Neil "; DROP TABLE trainers; -- <b>Test</b>`;
  const data = save({ ...profile, name });
  assert.equal(data.result, 1);
  assert.equal(data.after[2].name, name);
  assert.deepEqual(data.after.slice(0, 2), data.before);
});

for (const [label, patch] of [
  ['negative rate', { rate: '-10' }], ['missing rate', { rate: '' }],
  ['fractional cents', { rate: '1.001' }], ['infinite rate', { rate: 'INF' }],
  ['exponent rate', { rate: '1e3' }], ['array rate', { rate: ['1'] }],
  ['SQL rate', { rate: "1', name='changed" }],
  ['blank name', { name: '  ' }], ['long name', { name: 'x'.repeat(201) }],
  ['array name', { name: ['test'] }], ['blank email', { email: '' }],
  ['invalid email', { email: 'invalid-email' }], ['array email', { email: ['trainer@example.com'] }],
  ['long email', { email: 'a'.repeat(90) + '@example.com' }],
  ['blank contact', { contact: '' }], ['array contact', { contact: ['123'] }],
  ['long contact', { contact: '1'.repeat(101) }], ['contact without digits', { contact: '+ --' }],
  ['invalid contact', { contact: 'telephone' }],
  ['invalid ID', { id: '2 OR 1=1' }], ['zero ID', { id: '0' }],
  ['array ID', { id: ['2'] }], ['boolean ID', { id: true }],
]) {
  test(`${label} is rejected before any trainer changes`, () => {
    const data = save({ ...profile, ...patch });
    assert.equal(data.status, 400);
    assert.equal(typeof JSON.parse(data.result).error, 'string');
    assert.deepEqual(data.after, data.before);
  });
}

test('malformed UTF-8 is rejected safely', () => {
  const data = save(profile, "$_POST['name'] = chr(255);");
  assert.equal(data.status, 400);
  assert.deepEqual(data.after, data.before);
});

test('missing records and failed reads/writes produce safe errors', () => {
  for (const [id, setup, status, options] of [
    ['999', '', 404, {}],
    ['', '$db->failWrite = true;', 500, {}],
    ['2', "$db->failRead = true; ini_set('error_log', '');", 500, { expectedStderr: /^Unable to save trainer \(error code 0\)\.\r?\n$/ }],
  ]) {
    const data = save({ ...profile, id }, setup, options);
    assert.equal(data.status, status);
    assert.deepEqual(data.after, data.before);
    assert.doesNotMatch(JSON.parse(data.result).error, /SELECT|INSERT|UPDATE/);
  }
});

for (const token of [null, '', 'incorrect', ['token']]) {
  test(`CSRF ${JSON.stringify(token)} cannot dispatch save_trainer`, () => {
    const response = run(admin, `$_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = json_decode(${literal(JSON.stringify({ ...profile, csrf_token: token }))}, true);
      require_action_access('save_trainer'); echo 'DISPATCHED';`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(response.body, /DISPATCHED/);
  });
}

test('GET and Staff cannot save trainers', () => {
  assert.equal(run(admin, "$_SERVER['REQUEST_METHOD'] = 'GET'; require_action_access('save_trainer');").status, 405);
  assert.equal(run({ ...admin, login_type: 2 }, "require_action_access('save_trainer');").status, 403);
});

test('trainer page escapes text and Edit attributes and provides a protected Add form', () => {
  const attackName = `O'Neil "<b>Trainer</b>`;
  const attackEmail = '" onmouseover="alert(1)';
  const attackContact = '<img src=x onerror="alert(1)">';
  const response = run(admin, `
    class TrainerPageResult {
      private $row;
      public function __construct() {
        $this->row = ['id' => 7, 'name' => ${literal(attackName)}, 'email' => ${literal(attackEmail)}, 'contact' => ${literal(attackContact)}, 'rate' => 10];
      }
      public function fetch_assoc() { $row = $this->row; $this->row = null; return $row; }
    }
    class TrainerPageDatabase { public function query($sql) { return new TrainerPageResult(); } }
    $page = str_replace("include 'db_connect.php';", '$conn = new TrainerPageDatabase();', file_get_contents('trainer.php'));
    eval('?>' . $page);
  `);
  assert.doesNotMatch(response.body, /Warning|Fatal error|<img src=x|<b>Trainer<\/b>|data-email="" onmouseover/);
  assert.match(response.body, /data-name="O&#039;Neil &quot;&lt;b&gt;Trainer&lt;\/b&gt;"/);
  assert.match(response.body, /data-email="&quot; onmouseover=&quot;alert\(1\)"/);
  assert.match(response.body, /data-contact="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;"/);
  assert.match(response.body, /name="csrf_token" value="trainers-test-token"/);
  assert.match(response.body, /action="ajax.php\?action=save_trainer" method="post"/);
  assert.match(response.body, /min="0" step="1" name="rate" max="9999999999\.99" required/);
  assert.match(response.body, /trainers.js\?v=\d+/);
  assert.match(response.body, /Add Trainer/);
});

