import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const admin = { login_id: 2, login_type: 1, csrf_token: 'packages-test-token' };
const profile = { id: '', package: ` O'Neil Package `, description: ` Owner's description `, amount: '120.50', version: '1', csrf_token: admin.csrf_token };
const database = `
  class PackageResult {
    private $statement;
    public function __construct($statement) { $this->statement = $statement; }
    public function fetch_assoc() { return $this->statement->fetch(PDO::FETCH_ASSOC); }
  }
  class PackageStatement {
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
    public function get_result() { return new PackageResult($this->statement); }
    public function close() { $this->statement->closeCursor(); }
  }
  class PackageDatabase {
    public $pdo;
    public $failWrite = false;
    public $noOp = false;
    public $failRead = false;
    public function __construct() {
      $this->pdo = new PDO('sqlite::memory:');
      $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $this->pdo->exec('CREATE TABLE packages (id INTEGER PRIMARY KEY AUTOINCREMENT, package TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL)');
      $this->pdo->exec("INSERT INTO packages VALUES (1, 'Premium', 'Premium description', 1000), (2, 'Basic', 'Basic description', 250)");
      $this->pdo->exec('ALTER TABLE packages ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    }
    public function prepare($sql) {
      if ($this->failRead && str_starts_with($sql, 'SELECT')) return false;
      return new PackageStatement($this, $sql);
    }
    public function query($sql) { throw new RuntimeException('Use prepared SQL'); }
    public function snapshot() { return $this->pdo->query('SELECT * FROM packages ORDER BY id')->fetchAll(PDO::FETCH_ASSOC); }
    public function close() {}
  }
  require 'admin_class.php';
  ob_start();
  $db = new PackageDatabase();
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
    $result = $action->save_package();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(compact('result', 'before', 'after'));
  `, options);
  return { status: response.status, ...JSON.parse(response.body) };
}

test('new packages accept apostrophes in name and description as bound data', () => {
  const data = save(profile);
  assert.equal(data.result, 1);
  assert.deepEqual(data.after.slice(0, 2), data.before);
  assert.deepEqual(data.after[2], { id: 3, package: "O'Neil Package", description: "Owner's description", amount: 120.5, version: 1 });
});

test('editing changes only the selected package and can clear its optional description', () => {
  const data = save({ ...profile, id: '2', description: '' });
  assert.equal(data.result, 1);
  assert.deepEqual(data.after[0], data.before[0]);
  assert.deepEqual(data.after[1], { id: 2, package: "O'Neil Package", description: '', amount: 120.5, version: 2 });
});

test('unchanged values and zero price remain valid', () => {
  const same = save({ ...profile, id: '2', package: 'Basic', description: 'Basic description', amount: '250' });
  assert.equal(same.result, 1);
  const expected=structuredClone(same.before);expected[1].version=2;
  assert.deepEqual(same.after, expected);
  const free = save({ ...profile, amount: '0' });
  assert.equal(free.result, 1);
  assert.equal(free.after[2].amount, 0);
});

test('Unicode, SQL-looking and HTML-looking text is stored verbatim as data', () => {
  const name = `健身 O'Neil "; DROP TABLE packages; -- <b>Test</b>`;
  const description = '<img src=x onerror="alert(1)">';
  const data = save({ ...profile, package: name, description });
  assert.equal(data.result, 1);
  assert.equal(data.after[2].package, name);
  assert.equal(data.after[2].description, description);
  assert.deepEqual(data.after.slice(0, 2), data.before);
});

for (const [label, patch] of [
  ['negative amount', { amount: '-10' }], ['blank amount', { amount: '' }],
  ['fractional cents', { amount: '1.001' }], ['infinite amount', { amount: 'INF' }],
  ['exponent amount', { amount: '1e3' }], ['array amount', { amount: ['1'] }],
  ['SQL amount', { amount: "1', package='changed" }],
  ['blank name', { package: '   ' }], ['long name', { package: 'x'.repeat(201) }],
  ['array name', { package: ['test'] }], ['array description', { description: ['test'] }],
  ['invalid ID', { id: '2 OR 1=1' }], ['zero ID', { id: '0' }],
  ['array ID', { id: ['2'] }], ['boolean ID', { id: true }],
]) {
  test(`${label} is rejected without changing any package`, () => {
    const data = save({ ...profile, ...patch });
    assert.equal(data.status, 400);
    assert.equal(typeof JSON.parse(data.result).error, 'string');
    assert.deepEqual(data.after, data.before);
  });
}

test('oversized or malformed text is rejected before writing', () => {
  for (const setup of ["$_POST['description'] = str_repeat('x', 65536);", "$_POST['package'] = chr(255);", "$_POST['description'] = chr(255);"]) {
    const data = save(profile, setup);
    assert.equal(data.status, 400);
    assert.deepEqual(data.after, data.before);
  }
});

test('missing records and database failures return clear errors without changing data', () => {
  for (const [id, setup, status, options] of [
    ['999', '', 404, {}],
    ['', '$db->failWrite = true;', 500, {}],
    ['2', "$db->failRead = true; ini_set('error_log', '');", 500, { expectedStderr: /^Unable to save package \(error code 0\)\.\r?\n$/ }],
  ]) {
    const data = save({ ...profile, id }, setup, options);
    assert.equal(data.status, status);
    assert.deepEqual(data.after, data.before);
    assert.doesNotMatch(JSON.parse(data.result).error, /SELECT|UPDATE|INSERT/);
  }
});

for (const token of [null, '', 'incorrect', ['token']]) {
  test(`CSRF ${JSON.stringify(token)} cannot dispatch save_package`, () => {
    const response = run(admin, `$_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = json_decode(${literal(JSON.stringify({ ...profile, csrf_token: token }))}, true);
      require_action_access('save_package'); echo 'DISPATCHED';`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(response.body, /DISPATCHED/);
  });
}

test('GET and Staff cannot save packages', () => {
  const get = run(admin, "$_SERVER['REQUEST_METHOD'] = 'GET'; require_action_access('save_package');");
  assert.equal(get.status, 405);
  const staff = run({ ...admin, login_type: 2 }, "require_action_access('save_package');");
  assert.equal(staff.status, 403);
});

test('package markup escapes quotes and HTML in visible text and Edit attributes', () => {
  const attackName = `O'Neil "<b>Package</b>`;
  const attackDescription = '<img src=x onerror="alert(1)">';
  const response = run(admin, `
    class PackagePageResult {
      private $row;
      public function __construct() {
        $this->row = ['id' => 7, 'version' => 1, 'package' => ${literal(attackName)}, 'description' => ${literal(attackDescription)}, 'amount' => 10];
      }
      public function fetch_assoc() { $row = $this->row; $this->row = null; return $row; }
      public function fetch_all($mode) { $row = $this->fetch_assoc(); return $row === null ? [] : [$row]; }
      public function free() { $this->row = null; }
    }
    class PackagePageDatabase { public function query($sql) { return new PackagePageResult(); } }
    // Substitute the DB connection in memory; never modify or seed application records.
    $page = str_replace("include 'db_connect.php';", '$conn = new PackagePageDatabase();', file_get_contents('packages.php'));
    eval('?>' . $page);
  `);
  assert.doesNotMatch(response.body, /Warning|Fatal error|<img src=x|<b>Package<\/b>/);
  assert.match(response.body, /data-package="O&#039;Neil &quot;&lt;b&gt;Package&lt;\/b&gt;"/);
  assert.match(response.body, /data-description="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;"/);
  assert.match(response.body, /name="csrf_token" value="packages-test-token"/);
  assert.match(response.body, /action="ajax.php\?action=save_package" method="post"/);
  assert.match(response.body, /min="0" step="0.01" name="amount" max="9999999999\.99" required/);
  assert.match(response.body, /packages.js\?v=\d+/);
  assert.match(response.body, /Add Package/);
});

