import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1, csrf_token: 'renew-test-token' };
const profile = { rid: '9', csrf_token: session.csrf_token };
function isolated(code, options = {}) {
  const result = run(session, `require 'tests/helpers/membership-db.php';
    with_membership_database(function($db, $schema) {
      $db->query('UPDATE registration_info SET end_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = 9');
      $post = json_decode(${literal(JSON.stringify(profile))}, true);
      ${code}
    });`, options);
  return JSON.parse(result.body);
}

for (const role of [1, 2]) {
  test(`role ${role} renews an expired active membership while preserving history and payments`, () => {
    const data = isolated(`
      $_SESSION['login_type'] = ${role};
      $before = membership_snapshot($db);
      $result = new_membership_for_test($db, $post, 'renew_membership');
      $after = membership_snapshot($db);
      $today = (new DateTimeImmutable('today'))->format('Y-m-d');
      $end = (new DateTimeImmutable('today'))->modify('+3 months')->format('Y-m-d');
      echo json_encode(compact('before', 'result', 'after', 'today', 'end'));
    `);
    assert.equal(data.result.status, 200);
    assert.ok(Number(data.result.result) > 9);
    assert.deepEqual(data.after.memberships[0], data.before.memberships[0]);
    assert.deepEqual({ ...data.after.memberships[1], status: data.before.memberships[1].status }, data.before.memberships[1]);
    assert.equal(Number(data.after.memberships[1].status), 0);
    const added = data.after.memberships[2];
    for (const field of ['member_id', 'plan_id', 'package_id', 'trainer_id']) assert.equal(added[field], data.before.memberships[1][field]);
    assert.equal(Number(added.status), 1);
    assert.equal(added.start_date, data.today);
    assert.equal(added.end_date, data.end);
    assert.deepEqual(data.after.payments, data.before.payments);
  });
}

test('a second renewal from the old modal cannot close or replace the first renewal', () => {
  const data = isolated(`
    $first = new_membership_for_test($db, $post, 'renew_membership');
    $before = membership_snapshot($db);
    $second = new_membership_for_test($db, $post, 'renew_membership');
    $after = membership_snapshot($db);
    echo json_encode(compact('first', 'second', 'before', 'after'));
  `);
  assert.equal(data.first.status, 200);
  assert.equal(data.second.status, 409);
  assert.match(JSON.parse(data.second.result).error, /already been renewed or ended/);
  assert.deepEqual(data.after, data.before);
});

test('renewal also works without a trainer and ignores extra posted metadata', () => {
  const data = isolated(`
    $db->query('UPDATE registration_info SET trainer_id = 0 WHERE id = 9');
    $post += ['member_id' => '11', 'plan_id' => '2', 'status' => '0', 'start_date' => '2000-01-01', 'trainer_id' => '200'];
    $result = new_membership_for_test($db, $post, 'renew_membership');
    $after = membership_snapshot($db);
    echo json_encode(compact('result', 'after'));
  `);
  assert.equal(data.result.status, 200);
  const added = data.after.memberships[2];
  assert.equal(Number(added.member_id), 10);
  assert.equal(Number(added.plan_id), 1);
  assert.equal(Number(added.trainer_id), 0);
  assert.equal(Number(added.status), 1);
  assert.notEqual(added.start_date, '2000-01-01');
});

for (const [label, setup, expected] of [
  ['ended record', "$post['rid'] = '8';", 409],
  ['expires today', "$db->query('UPDATE registration_info SET end_date = CURDATE() WHERE id = 9');", 409],
  ['not yet expired', "$db->query('UPDATE registration_info SET end_date = DATE_ADD(CURDATE(), INTERVAL 1 DAY) WHERE id = 9');", 409],
  ['another active membership', `$db->query("INSERT INTO registration_info VALUES (12, 10, 1, 1, 0, '2026-01-01', '2027-01-01', 1)");`, 409],
  ['missing source', "$post['rid'] = '999';", 404],
  ['missing member', "$db->query('DELETE FROM members WHERE id = 10');", 404],
  ['missing plan', "$db->query('DELETE FROM plans WHERE id = 1');", 404],
  ['missing package', "$db->query('DELETE FROM packages WHERE id = 1');", 404],
  ['missing trainer', "$db->query('DELETE FROM trainers WHERE id = 2');", 404],
  ['zero duration', "$db->query('UPDATE plans SET plan = 0 WHERE id = 1');", 400],
  ['overflow duration', "$db->query('UPDATE plans SET plan = 2147483647 WHERE id = 1');", 400],
]) {
  test(`${label} rejects renewal without changing records`, () => {
    const data = isolated(`
      ${setup}
      $before = membership_snapshot($db);
      $result = new_membership_for_test($db, $post, 'renew_membership');
      $after = membership_snapshot($db);
      echo json_encode(compact('before', 'result', 'after'));
    `);
    assert.equal(data.result.status, expected);
    assert.deepEqual(data.after, data.before);
  });
}

test('insert failure rolls back closing the original membership', () => {
  const data = isolated(`
    $db->query("CREATE TRIGGER fail_renewal BEFORE INSERT ON registration_info FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Forced test failure'");
    ini_set('error_log', '');
    $before = membership_snapshot($db);
    $failed = new_membership_for_test($db, $post, 'renew_membership');
    $afterFailure = membership_snapshot($db);
    $db->query('DROP TRIGGER fail_renewal');
    $success = new_membership_for_test($db, $post, 'renew_membership');
    echo json_encode(compact('before', 'failed', 'afterFailure', 'success'));
  `, { expectedStderr: /^Unable to renew membership \(error code 1644\)\.\r?\n$/ });
  assert.equal(data.failed.status, 500);
  assert.deepEqual(data.afterFailure, data.before);
  assert.equal(data.success.status, 200);
});

for (const rid of [null, '0', '-1', '9 OR 1=1', ['9'], true]) {
  test(`invalid renewal ID ${JSON.stringify(rid)} is rejected before database access`, () => {
    const response = run(session, `ob_start(); require 'admin_class.php';
      $action = (new ReflectionClass('Action'))->newInstanceWithoutConstructor();
      $property = new ReflectionProperty('Action','db');
      $property->setAccessible(true);
      $property->setValue($action, new class { public function close() {} });
      $_SERVER['REQUEST_METHOD']='POST';
      $_POST=json_decode(${literal(JSON.stringify({ rid, csrf_token: session.csrf_token }))},true);
      echo $action->renew_membership(); unset($action);`);
    assert.equal(response.status, 400);
  });
}

for (const token of [null, '', 'incorrect', ['token']]) {
  test(`CSRF ${JSON.stringify(token)} blocks renewal before dispatch`, () => {
    const response = run(session, `$_SERVER['REQUEST_METHOD']='POST';
      $_POST=json_decode(${literal(JSON.stringify({ ...profile, csrf_token: token }))},true);
      require_action_access('renew_membership'); echo 'DISPATCHED';`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(response.body, /DISPATCHED/);
  });
}

test('GET cannot renew a membership', () => {
  assert.equal(run(session, "$_SERVER['REQUEST_METHOD']='GET'; require_action_access('renew_membership');").status, 405);
});

test('parallel renewals and a concurrent New Membership create exactly one replacement', () => {
  const data = isolated(`
    $db->begin_transaction();
    $db->query('SELECT id FROM members WHERE id = 10 FOR UPDATE');
    $workers = [];
    for ($i = 0; $i < 6; $i++) {
      $method = $i === 5 ? 'save_membership' : 'renew_membership';
      $workerPost = $i === 5 ? ['member_id' => '10', 'plan_id' => '1', 'package_id' => '1', 'trainer_id' => '', 'csrf_token' => $_SESSION['csrf_token']] : $post;
      $source = 'session_set_save_handler(function(){return true;}, function(){return true;}, function(){return "";}, function(){return true;}, function(){return true;}, function(){return 0;}); session_start(); '
        . 'require "tests/helpers/membership-db.php"; require "admin_class.php"; '
        . '$_SESSION = ' . var_export($_SESSION, true) . '; '
        . '$db = throttle_test_connection(' . var_export($schema, true) . '); '
        . '$GLOBALS["auth_connection"] = $db; '
        . 'echo json_encode(new_membership_for_test($db, ' . var_export($workerPost, true) . ', ' . var_export($method, true) . ')); $db->close();';
      $pipes = [];
      $process = proc_open([PHP_BINARY, '-r', $source], [['pipe','r'], ['pipe','w'], ['pipe','w']], $pipes);
      if (!is_resource($process)) throw new RuntimeException('Worker did not start');
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
  assert.equal(data.results.filter(row => row.status === 200).length, 1);
  assert.equal(data.results.filter(row => row.status === 409).length, 5);
  assert.equal(data.snapshot.memberships.length, 3);
  assert.equal(Number(data.snapshot.memberships[1].status), 0);
  assert.equal(Number(data.snapshot.memberships[2].status), 1);
  assert.equal(data.snapshot.payments.length, 2);
});
