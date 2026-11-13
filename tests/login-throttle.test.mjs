import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

function isolated(code, options = {}) {
  const response = run({}, `require 'tests/helpers/throttle-db.php';
    with_throttle_database(function($db, $schema) { ${code} });`, options);
  return JSON.parse(response.body);
}

test('five failures block the next attempt including the correct password across sessions, IPs and username case', () => {
  const data = isolated(`
    $results = [];
    for ($i = 0; $i < 5; $i++) $results[] = throttle_test_login($db, 'staff', 'wrong');
    $_SESSION = [];
    $results[] = throttle_test_login($db, 'STAFF', 'staff', '192.0.2.2');
    echo json_encode($results);
  `);
  for (const attempt of data.slice(0, 5)) assert.equal(attempt.result, 3);
  assert.equal(data[5].status, 429);
  const blocked = JSON.parse(data[5].result);
  assert.ok(blocked.retry_after > 0 && blocked.retry_after <= 900);
  assert.equal(blocked.error, `Too many login attempts. Retry in ${Math.ceil(blocked.retry_after / 60)} min.`);
  assert.equal(data[5].authenticated, false);
});

test('unknown accounts also receive a generic temporary limit', () => {
  const data = isolated(`
    for ($i = 0; $i < 5; $i++) throttle_test_login($db, 'missing', 'wrong');
    echo json_encode(throttle_test_login($db, 'MISSING', 'wrong'));
  `);
  assert.equal(data.status, 429);
  const blocked = JSON.parse(data.result);
  assert.equal(blocked.error, `Too many login attempts. Retry in ${Math.ceil(blocked.retry_after / 60)} min.`);
});

test('IP limit stops username rotation and ignores forged forwarded headers', () => {
  const data = isolated(`
    for ($i = 0; $i < 30; $i++) {
      $_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.' . $i;
      $result = throttle_test_login($db, 'missing-' . $i, 'wrong');
      if ($result['result'] !== 3) throw new RuntimeException('Blocked too soon');
    }
    echo json_encode(['blocked' => throttle_test_login($db, 'staff', 'staff'),
      'otherIp' => throttle_test_login($db, 'staff', 'staff', '192.0.2.9')]);
  `);
  assert.equal(data.blocked.status, 429);
  const blocked = JSON.parse(data.blocked.result);
  assert.equal(blocked.error, `Too many login attempts. Retry in ${Math.ceil(blocked.retry_after / 60)} min.`);
  assert.equal(data.otherIp.result, 1);
});

test('successful login resets account failures but keeps the IP budget', () => {
  const data = isolated(`
    for ($i = 0; $i < 4; $i++) throttle_test_login($db, 'staff', 'wrong');
    $success = throttle_test_login($db, 'staff', 'staff');
    $counts = $db->query('SELECT attempts FROM login_throttle ORDER BY attempts')->fetch_all(MYSQLI_NUM);
    for ($i = 0; $i < 5; $i++) $last = throttle_test_login($db, 'staff', 'wrong');
    echo json_encode(compact('success', 'counts', 'last'));
  `);
  assert.equal(data.success.result, 1);
  assert.deepEqual(data.counts.map(row => Number(row[0])), [0, 5]);
  assert.equal(data.last.result, 3);
});

test('expired windows admit login again and blocked requests never extend expiry', () => {
  const data = isolated(`
    for ($i = 0; $i < 5; $i++) throttle_test_login($db, 'staff', 'wrong');
    $before = $db->query('SELECT * FROM login_throttle ORDER BY bucket')->fetch_all(MYSQLI_ASSOC);
    $blocked = throttle_test_login($db, 'staff', 'wrong');
    $after = $db->query('SELECT * FROM login_throttle ORDER BY bucket')->fetch_all(MYSQLI_ASSOC);
    $db->query('UPDATE login_throttle SET expires_at = UNIX_TIMESTAMP() - 1');
    $success = throttle_test_login($db, 'staff', 'staff');
    echo json_encode(compact('before', 'after', 'blocked', 'success'));
  `);
  assert.deepEqual(data.after, data.before);
  assert.equal(data.blocked.status, 429);
  assert.equal(data.success.result, 1);
});

test('legacy MD5 migration remains compatible with the login transaction', () => {
  const data = isolated(`
    $login = throttle_test_login($db, 'admin', 'admin');
    $hash = $db->query('SELECT password FROM users WHERE id = 2')->fetch_assoc()['password'];
    echo json_encode(['login' => $login, 'algorithm' => password_get_info($hash)['algoName'], 'valid' => password_verify('admin', $hash)]);
  `);
  assert.equal(data.login.result, 1);
  assert.equal(data.algorithm, 'argon2id');
  assert.equal(data.valid, true);
});

test('missing throttle storage fails closed without authenticating or migrating the password', () => {
  const data = isolated(`
    $db->query('DROP TABLE login_throttle');
    ini_set('error_log', '');
    $login = throttle_test_login($db, 'admin', 'admin');
    $unchanged = $db->query('SELECT password FROM users WHERE id = 2')->fetch_assoc()['password'] === md5('admin');
    echo json_encode(compact('login', 'unchanged'));
  `, { expectedStderr: /^Login database error \(code 1146\)\.\r?\n$/ });
  assert.equal(data.login.status, 503);
  assert.equal(data.login.authenticated, false);
  assert.equal(data.unchanged, true);
});

test('parallel processes cannot admit more than five attempts for one account', () => {
  const data = isolated(`
    $source = 'require "login_throttle.php"; require "tests/helpers/throttle-db.php"; '
      . '$db = throttle_test_connection(' . var_export($schema, true) . '); '
      . '$guard = new LoginThrottle($db); $wait = $guard->begin("id:3", "192.0.2.20"); '
      . 'if (!$wait) { usleep(30000); $guard->finish(false); } echo $wait ? "blocked" : "admitted";';
    $workers = [];
    for ($i = 0; $i < 10; $i++) {
      $pipes = [];
      $process = proc_open([PHP_BINARY, '-r', $source], [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes);
      if (!is_resource($process)) throw new RuntimeException('Worker did not start');
      fclose($pipes[0]);
      $workers[] = [$process, $pipes];
    }
    $results = [];
    foreach ($workers as [$process, $pipes]) {
      $results[] = stream_get_contents($pipes[1]);
      $error = stream_get_contents($pipes[2]);
      fclose($pipes[1]); fclose($pipes[2]);
      if (proc_close($process) !== 0 || $error !== '') throw new RuntimeException('Worker failed: ' . $error);
    }
    echo json_encode($results);
  `);
  assert.equal(data.filter(result => result === 'admitted').length, 5);
  assert.equal(data.filter(result => result === 'blocked').length, 5);
});
