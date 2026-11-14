import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1, csrf_token: 'membership-test-token' };
const profile = { member_id: '9', plan_id: '1', package_id: '1', trainer_id: '', csrf_token: session.csrf_token };
function isolated(code, options = {}) {
  const response = run(session, `require 'tests/helpers/membership-db.php';
    with_membership_database(function($db, $schema) {
      $post = json_decode(${literal(JSON.stringify(profile))}, true);
      ${code}
    });`, options);
  return JSON.parse(response.body);
}

for (const role of [1, 2]) {
  test(`role ${role} creates one membership with no trainer and leaves previous history untouched`, () => {
    const data = isolated(`
      $_SESSION['login_type'] = ${role};
      $before = membership_snapshot($db);
      $result = new_membership_for_test($db, $post);
      $after = membership_snapshot($db);
      $today = (new DateTimeImmutable('today'))->format('Y-m-d');
      $end = membership_end_date(new DateTimeImmutable('today'), 3);
      echo json_encode(compact('before', 'result', 'after', 'today', 'end'));
    `);
    assert.equal(data.result.result, 1);
    assert.deepEqual(data.after.memberships.slice(0, 2), data.before.memberships);
    assert.deepEqual(data.after.payments, data.before.payments);
    const added = data.after.memberships[2];
    assert.equal(Number(added.trainer_id), 0);
    assert.equal(Number(added.status), 1);
    assert.equal(added.start_date, data.today);
    assert.equal(added.end_date, data.end);
  });
}

test('a stale form cannot replace or close the membership created by the first request', () => {
  const data = isolated(`
    $first = new_membership_for_test($db, $post);
    $before = membership_snapshot($db);
    $second = new_membership_for_test($db, $post);
    $after = membership_snapshot($db);
    echo json_encode(compact('first', 'second', 'before', 'after'));
  `);
  assert.equal(data.first.result, 1);
  assert.equal(data.second.status, 409);
  assert.match(JSON.parse(data.second.result).error, /already has an active membership/);
  assert.deepEqual(data.after, data.before);
});

test('an existing status-1 membership is protected even when its end date has passed', () => {
  const data = isolated(`
    $post['member_id'] = '10';
    $before = membership_snapshot($db);
    $result = new_membership_for_test($db, $post);
    $after = membership_snapshot($db);
    echo json_encode(compact('before', 'result', 'after'));
  `);
  assert.equal(data.result.status, 409);
  assert.deepEqual(data.after, data.before);
});

test('dates, status and IDs supplied outside the approved fields cannot override the new record', () => {
  const data = isolated(`
    $post += ['id' => '8', 'status' => '0', 'start_date' => '2000-01-01', 'end_date' => '2000-01-02'];
    $post['trainer_id'] = '2';
    $result = new_membership_for_test($db, $post);
    $after = membership_snapshot($db);
    echo json_encode(compact('result', 'after'));
  `);
  assert.equal(data.result.result, 1);
  const added = data.after.memberships[2];
  assert.notEqual(Number(added.id), 8);
  assert.equal(Number(added.status), 1);
  assert.equal(Number(added.trainer_id), 2);
  assert.notEqual(added.start_date, '2000-01-01');
});

for (const [field, value, status] of [
  ['member_id', '999', 404], ['plan_id', '999', 404], ['package_id', '999', 404], ['trainer_id', '99', 404],
  ['member_id', '0', 400], ['plan_id', '-1', 400], ['package_id', '1 OR 1=1', 400],
  ['member_id', ['9'], 400], ['trainer_id', true, 400], ['trainer_id', '200', 400],
  ['plan_id', '2', 400], ['plan_id', '3', 400],
]) {
  test(`invalid or unavailable ${field} ${JSON.stringify(value)} leaves all history intact`, () => {
    const data = isolated(`
      $post[${literal(field)}] = json_decode(${literal(JSON.stringify(value))}, true);
      $before = membership_snapshot($db);
      $result = new_membership_for_test($db, $post);
      $after = membership_snapshot($db);
      echo json_encode(compact('before', 'result', 'after'));
    `);
    assert.equal(data.result.status, status);
    assert.deepEqual(data.after, data.before);
  });
}

test('a failed insert rolls back and releases the member lock for a subsequent valid attempt', () => {
  const data = isolated(`
    $db->query("CREATE TRIGGER fail_membership BEFORE INSERT ON registration_info FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Forced test failure'");
    ini_set('error_log', '');
    $before = membership_snapshot($db);
    $failed = new_membership_for_test($db, $post);
    $afterFailure = membership_snapshot($db);
    $db->query('DROP TRIGGER fail_membership');
    $success = new_membership_for_test($db, $post);
    echo json_encode(compact('before', 'failed', 'afterFailure', 'success'));
  `, { expectedStderr: /^Unable to save membership \(error code 1644\)\.\r?\n$/ });
  assert.equal(data.failed.status, 500);
  assert.deepEqual(data.afterFailure, data.before);
  assert.equal(data.success.result, 1);
});

test('parallel New Membership requests admit exactly one creation', () => {
  const data = isolated(`
    $source = 'session_set_save_handler(function(){return true;}, function(){return true;}, function(){return "";}, function(){return true;}, function(){return true;}, function(){return 0;}); session_start(); '
      . 'require "tests/helpers/membership-db.php"; require "admin_class.php"; '
      . '$_SESSION = ' . var_export($_SESSION, true) . '; '
      . '$db = throttle_test_connection(' . var_export($schema, true) . '); '
      . '$GLOBALS["auth_connection"] = $db; '
      . 'echo json_encode(new_membership_for_test($db, ' . var_export($post, true) . ')); $db->close();';
    $db->begin_transaction();
    $db->query('SELECT id FROM members WHERE id = 9 FOR UPDATE');
    $workers = [];
    for ($i = 0; $i < 5; $i++) {
      $pipes = [];
      $process = proc_open([PHP_BINARY, '-r', $source], [['pipe','r'], ['pipe','w'], ['pipe','w']], $pipes);
      if (!is_resource($process)) throw new RuntimeException('Worker failed to start');
      fclose($pipes[0]);
      $workers[] = [$process, $pipes];
    }
    usleep(200000);
    $db->commit();
    $results = [];
    foreach ($workers as [$process, $pipes]) {
      $out = stream_get_contents($pipes[1]); $error = stream_get_contents($pipes[2]);
      fclose($pipes[1]); fclose($pipes[2]);
      if (proc_close($process) !== 0 || $error !== '') throw new RuntimeException('Worker failed: ' . $error);
      $results[] = json_decode($out, true);
    }
    $snapshot = membership_snapshot($db);
    echo json_encode(compact('results', 'snapshot'));
  `);
  assert.equal(data.results.filter(row => row.result === 1).length, 1);
  assert.equal(data.results.filter(row => row.status === 409).length, 4);
  assert.equal(data.snapshot.memberships.length, 3);
  assert.equal(Number(data.snapshot.memberships[2].status), 1);
});

for (const token of [null, '', 'wrong', ['token']]) {
  test(`CSRF ${JSON.stringify(token)} cannot dispatch a membership creation`, () => {
    const response = run(session, `$_SERVER['REQUEST_METHOD']='POST';
      $_POST=json_decode(${literal(JSON.stringify({ ...profile, csrf_token: token }))},true);
      require_action_access('save_membership'); echo 'DISPATCHED';`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(response.body, /DISPATCHED/);
  });
}

test('GET cannot save a membership', () => {
  assert.equal(run(session, "$_SERVER['REQUEST_METHOD']='GET'; require_action_access('save_membership');").status, 405);
});

test('New Membership form contains CSRF and rejects malformed optional member IDs', () => {
  const form = run(session, "include 'manage_membership.php';");
  assert.match(form.body, /action="ajax.php\?action=save_membership" method="post"/);
  assert.match(form.body, /name="csrf_token" value="membership-test-token"/);
  assert.doesNotMatch(form.body, /Warning|Fatal error|\.submit\(function/);
  const invalid = run(session, "$_GET['id']='9 OR 1=1'; include 'manage_membership.php';");
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(invalid.body, /<form|Warning|Fatal error/);
});
