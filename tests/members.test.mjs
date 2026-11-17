// Run: node --test tests/members.test.mjs
// The actual save_member method runs against SQL in memory, never the gym database.
import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 3, login_type: 2, csrf_token: 'members-test-token' };
const profile = {
  id: '', version: '1', member_id: '77889901', firstname: ' Aisyah ', lastname: "O'Neil",
  middlename: '', email: 'test@example.com', contact: '+60 11-12345678', gender: 'Female',
  address: 'Unit 1 <Block A>', csrf_token: session.csrf_token,
};

const database = `
  class MemberResult {
    public $num_rows;
    private $rows;
    public function __construct($rows) { $this->rows = $rows; $this->num_rows = count($rows); }
    public function fetch_assoc() { return array_shift($this->rows); }
  }
  class MemberStatement {
    private $db;
    private $statement;
    private $sql;
    private $values;
    public $affected_rows = 0;
    public function __construct($db, $sql) { $this->db = $db; $this->sql = $sql; $this->statement = $db->pdo->prepare($sql); }
    public function bind_param($types, &...$values) {
      if (strlen($types) !== count($values)) throw new RuntimeException('Incorrect binding count');
      $this->values = $values;
    }
    public function execute() {
      if ($this->db->failWrite && preg_match('/^(INSERT|UPDATE)/', $this->sql)) return false;
      $result = $this->statement->execute($this->values);
      $this->affected_rows = $this->db->noOp ? 0 : $this->statement->rowCount();
      return $result;
    }
    public function get_result() {
      if (strpos($this->sql, 'WHERE member_id =') !== false) {
        $this->db->numberChecks++;
        if ($this->db->allNumbersExist) return new MemberResult([['id' => 10]]);
      }
      return new MemberResult($this->statement->fetchAll(PDO::FETCH_ASSOC));
    }
    public function close() { $this->statement->closeCursor(); }
  }
  class MemberDatabase {
    public $pdo;
    public $failWrite = false;
    public $noOp = false;
    public $allNumbersExist = false;
    public $numberChecks = 0;
    public function __construct() {
      $this->pdo = new PDO('sqlite::memory:');
      $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $this->pdo->exec('CREATE TABLE members (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, firstname TEXT NOT NULL, lastname TEXT NOT NULL, middlename TEXT NOT NULL, email TEXT NOT NULL, contact TEXT NOT NULL, gender TEXT NOT NULL, address TEXT NOT NULL, date_created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      $this->pdo->exec("INSERT INTO members VALUES (10, 100010, 'Before', 'Edit', 'Old middle', 'before@example.com', '0111111111', 'Male', 'Old address', '2026-01-01'), (11, 100011, 'Other', 'Member', '', 'other@example.com', '0222222222', 'Male', '', '2026-01-02')");
      $this->pdo->exec('ALTER TABLE members ADD version INTEGER NOT NULL DEFAULT 1');
      $this->pdo->exec('CREATE TABLE registration_info (id INTEGER PRIMARY KEY, member_id INTEGER, status INTEGER)');
      $this->pdo->exec('INSERT INTO registration_info VALUES (9, 10, 0), (12, 11, 1)');
      $this->pdo->exec('CREATE TABLE payments (id INTEGER PRIMARY KEY, registration_id INTEGER, amount INTEGER)');
      $this->pdo->exec('INSERT INTO payments VALUES (1, 9, 500)');
    }
    public function prepare($sql) { return new MemberStatement($this, $sql); }
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
  $db = new MemberDatabase();
  $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
  $property = new ReflectionProperty('Action', 'db');
  $property->setAccessible(true);
  $property->setValue($action, $db);
  $_SERVER['REQUEST_METHOD'] = 'POST';
`;

function save(post, { role = 2, setup = '' } = {}) {
  const response = run({ ...session, login_type: role }, `${database}
    $_POST = json_decode(${literal(JSON.stringify(post))}, true);
    ${setup}
    $before = $db->snapshot();
    $result = $action->save_member();
    $after = $db->snapshot();
    unset($action);
    echo json_encode(['result' => $result, 'before' => $before, 'after' => $after, 'numberChecks' => $db->numberChecks]);
  `);
  return { status: response.status, ...JSON.parse(response.body) };
}

function assertRelatedDataUnchanged(data) {
  assert.deepEqual(data.after.registration_info, data.before.registration_info);
  assert.deepEqual(data.after.payments, data.before.payments);
}

for (const role of [1, 2]) {
  test(`role ${role} adds the full member profile without creating a membership`, () => {
    const data = save({ ...profile, plan_id: '999', arbitrary_column: 'ignored' }, { role });
    assert.equal(data.status, 200);
    assert.equal(data.result, 1);
    assert.equal(data.after.members.length, data.before.members.length + 1);
    assert.deepEqual(data.after.members.slice(0, 2), data.before.members);
    const added = data.after.members.at(-1);
    for (const field of ['lastname', 'firstname', 'middlename', 'email', 'contact', 'gender', 'address']) {
      assert.equal(added[field], profile[field].trim());
    }
    assert.equal(added.member_id, 77889901);
    assertRelatedDataUnchanged(data);
  });
}

test('a blank member number generates an unused eight-digit number', () => {
  const data = save({ ...profile, member_id: '' });
  assert.equal(data.result, 1);
  const number = data.after.members.at(-1).member_id;
  assert.ok(number >= 10000000 && number <= 99999999);
  assert.equal(data.before.members.some(member => member.member_id === number), false);
  assertRelatedDataUnchanged(data);
});

test('editing changes only the selected profile and allows optional fields to be cleared', () => {
  const data = save({ ...profile, id: '10', member_id: '100010', middlename: '', address: '' });
  assert.equal(data.status, 200);
  assert.equal(data.result, 1);
  assert.equal(data.after.members.length, data.before.members.length);
  const edited = data.after.members[0];
  assert.equal(edited.id, 10);
  assert.equal(edited.firstname, 'Aisyah');
  assert.equal(edited.lastname, "O'Neil");
  assert.equal(edited.contact, profile.contact);
  assert.equal(edited.middlename, '');
  assert.equal(edited.address, '');
  assert.equal(edited.date_created, data.before.members[0].date_created);
  assert.deepEqual(data.after.members[1], data.before.members[1]);
  assertRelatedDataUnchanged(data);
});

test('blank ID number on edit preserves the existing member number', () => {
  const data = save({ ...profile, id: '10', member_id: '' });
  assert.equal(data.result, 1);
  assert.equal(data.after.members[0].member_id, 100010);
});

test('an edit may change the public member number without changing the internal ID or history', () => {
  const data = save({ ...profile, id: '10' });
  assert.equal(data.result, 1);
  assert.equal(data.after.members[0].id, 10);
  assert.equal(data.after.members[0].member_id, 77889901);
  assertRelatedDataUnchanged(data);
});

for (const id of ['', '10']) {
  test(`duplicate member number is rejected for ${id ? 'edit' : 'add'}`, () => {
    const data = save({ ...profile, id, member_id: '100011' });
    assert.equal(data.status, 409);
    assert.equal(JSON.parse(data.result).error, 'ID No. already exists.');
    assert.deepEqual(data.after, data.before);
  });
}

test('saving an unchanged profile increments its version', () => {
  const post = { ...profile, id: '10', member_id: '100010', firstname: 'Before', lastname: 'Edit', middlename: 'Old middle', email: 'before@example.com', contact: '0111111111', gender: 'Male', address: 'Old address' };
  const data = save(post);
  assert.equal(data.status, 200);
  assert.equal(data.result, 1);
  assert.deepEqual(data.after, {...data.before, members: data.before.members.map((row,index)=>index===0?{...row,version:2}:row)});
});

test('missing member records return 404 instead of claiming a successful edit', () => {
  const data = save({ ...profile, id: '999' });
  assert.equal(data.status, 404);
  assert.deepEqual(data.after, data.before);
});

test('Unicode, apostrophes and HTML-like text are stored as bound values', () => {
  const data = save({ ...profile, firstname: '陈', lastname: "O'Neil", address: "'); DELETE FROM members; -- <test>" });
  assert.equal(data.result, 1);
  assert.equal(data.after.members.at(-1).firstname, '陈');
  assert.equal(data.after.members.at(-1).address, "'); DELETE FROM members; -- <test>");
  assert.equal(data.after.members.length, 3);
});

for (const [label, patch] of [
  ['missing first name', { firstname: '' }],
  ['missing last name', { lastname: '   ' }],
  ['missing contact', { contact: '' }],
  ['invalid email', { email: 'not-an-email' }],
  ['invalid gender', { gender: 'unexpected' }],
  ['array instead of text', { firstname: ['test'] }],
  ['long name', { lastname: 'x'.repeat(101) }],
  ['zero public ID', { member_id: '0' }],
  ['negative public ID', { member_id: '-1' }],
  ['out-of-range public ID', { member_id: '2147483648' }],
  ['array public ID', { member_id: ['9'] }],
  ['SQL in public ID', { member_id: '9 OR 1=1' }],
  ['SQL in record ID', { id: '10 OR 1=1' }],
  ['invalid record ID', { id: '0' }],
]) {
  test(`${label} is rejected before any record changes`, () => {
    const data = save({ ...profile, ...patch });
    assert.equal(data.status, 400);
    assert.ok(JSON.parse(data.result).error);
    assert.deepEqual(data.after, data.before);
  });
}

test('generation retries are bounded when no unused number is found', () => {
  const data = save({ ...profile, member_id: '' }, { setup: '$db->allNumbersExist = true;' });
  assert.equal(data.status, 503);
  assert.equal(data.numberChecks, 10);
  assert.deepEqual(data.after, data.before);
});

test('an oversized address is rejected without changes', () => {
  const data = save(profile, { setup: "$_POST['address'] = str_repeat('x', 65536);" });
  assert.equal(data.status, 400);
  assert.deepEqual(data.after, data.before);
});

test('a failed write returns a generic error and leaves existing records untouched', () => {
  const data = save(profile, { setup: '$db->failWrite = true;' });
  assert.equal(data.status, 500);
  assert.equal(JSON.parse(data.result).error, 'Unable to save member. Please try again.');
  assert.deepEqual(data.after, data.before);
});

for (const token of [null, '', 'wrong', ['token']]) {
  test(`save_member rejects CSRF token ${JSON.stringify(token)} before dispatch`, () => {
    const response = run(session, `
      $_SERVER['REQUEST_METHOD'] = 'POST';
      $_POST = json_decode(${literal(JSON.stringify({ ...profile, csrf_token: token }))}, true);
      require_action_access('save_member'); echo 'DISPATCHED';
    `);
    assert.equal(response.status, 403);
    assert.ok(JSON.parse(response.body).error);
  });
}

test('GET cannot save a member', () => {
  const response = run(session, `$_SERVER['REQUEST_METHOD'] = 'GET'; require_action_access('save_member');`);
  assert.equal(response.status, 405);
  assert.equal(JSON.parse(response.body).error, 'Use POST to save a member.');
});
