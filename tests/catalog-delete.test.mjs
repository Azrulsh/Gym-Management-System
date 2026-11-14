import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1, csrf_token: 'delete-test-token' };
const kinds = [['plan', 'plans', 1, 2], ['package', 'packages', 1, 2], ['trainer', 'trainers', 2, 3]];
function isolated(code, options = {}) {
  const response = run(session, `require 'tests/helpers/membership-db.php';
    function catalog_snapshot($db) {
      $snapshot = membership_snapshot($db);
      foreach (['plans', 'packages', 'trainers'] as $table) $snapshot[$table] = $db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      return $snapshot;
    }
    with_membership_database(function($db, $schema) {
      $db->query('UPDATE plans SET plan = 3 WHERE id = 2');
      $db->query('INSERT INTO packages (id) VALUES (2)');
      $db->query('INSERT INTO trainers (id) VALUES (3)');
      ${code}
    });`, options);
  return JSON.parse(response.body);
}

for (const [kind, table, usedId, unusedId] of kinds) {
  for (const status of [0, 1]) {
    test(`${kind} linked to ${status ? 'active' : 'closed'} memberships is retained with a clear explanation`, () => {
      const data = isolated(`
        $db->query('UPDATE registration_info SET status = ${status}');
        $before = catalog_snapshot($db);
        $result = new_membership_for_test($db, ['id' => '${usedId}', 'csrf_token' => $_SESSION['csrf_token']], 'delete_${kind}');
        $after = catalog_snapshot($db);
        echo json_encode(compact('before', 'result', 'after'));
      `);
      assert.equal(data.result.status, 409);
      assert.equal(JSON.parse(data.result.result).error, `Cannot delete this ${kind} because it is used by membership records, including closed memberships.`);
      assert.deepEqual(data.after, data.before);
    });
  }

  test(`an unused ${kind} can be deleted without changing membership/payment history`, () => {
    const data = isolated(`
      $before = catalog_snapshot($db);
      $result = new_membership_for_test($db, ['id' => '${unusedId}', 'csrf_token' => $_SESSION['csrf_token']], 'delete_${kind}');
      $after = catalog_snapshot($db);
      echo json_encode(compact('before', 'result', 'after'));
    `);
    assert.equal(data.result.result, 1);
    const expected = { ...data.before, [table]: data.before[table].filter(row => Number(row.id) !== unusedId) };
    assert.deepEqual(data.after, expected);
  });

  test(`a missing ${kind} returns 404 rather than pretending deletion succeeded`, () => {
    const data = isolated(`
      $before = catalog_snapshot($db);
      $result = new_membership_for_test($db, ['id' => '999', 'csrf_token' => $_SESSION['csrf_token']], 'delete_${kind}');
      $after = catalog_snapshot($db);
      echo json_encode(compact('before', 'result', 'after'));
    `);
    assert.equal(data.result.status, 404);
    assert.deepEqual(data.after, data.before);
  });

  test(`failed ${kind} deletion preserves the resource and releases its transaction`, () => {
    const data = isolated(`
      $db->query("CREATE TRIGGER fail_deletion BEFORE DELETE ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Forced test failure'");
      ini_set('error_log', '');
      $post = ['id' => '${unusedId}', 'csrf_token' => $_SESSION['csrf_token']];
      $before = catalog_snapshot($db);
      $failed = new_membership_for_test($db, $post, 'delete_${kind}');
      $afterFailure = catalog_snapshot($db);
      $db->query('DROP TRIGGER fail_deletion');
      $success = new_membership_for_test($db, $post, 'delete_${kind}');
      echo json_encode(compact('before', 'failed', 'afterFailure', 'success'));
    `, { expectedStderr: new RegExp(`^Unable to delete ${kind} \\(error code 1644\\)\\.\\r?\\n$`) });
    assert.equal(data.failed.status, 500);
    assert.deepEqual(data.afterFailure, data.before);
    assert.equal(data.success.result, 1);
  });

  test(`concurrent creation and ${kind} deletion cannot leave a dangling membership reference`, () => {
    const data = isolated(`
      $db->begin_transaction();
      $db->query('SELECT id FROM ${table} WHERE id = ${unusedId} FOR UPDATE');
      $requests = [
        ['save_membership', ['member_id' => '11', 'plan_id' => '2', 'package_id' => '2', 'trainer_id' => '3', 'csrf_token' => $_SESSION['csrf_token']]],
        ['delete_${kind}', ['id' => '${unusedId}', 'csrf_token' => $_SESSION['csrf_token']]],
      ];
      $workers = [];
      foreach ($requests as [$method, $post]) {
        $source = 'session_set_save_handler(function(){return true;}, function(){return true;}, function(){return "";}, function(){return true;}, function(){return true;}, function(){return 0;}); session_start(); '
          . 'require "tests/helpers/membership-db.php"; require "admin_class.php"; '
          . '$_SESSION = ' . var_export($_SESSION, true) . '; '
          . '$db = throttle_test_connection(' . var_export($schema, true) . '); '
          . '$GLOBALS["auth_connection"] = $db; '
          . 'echo json_encode(new_membership_for_test($db, ' . var_export($post, true) . ', ' . var_export($method, true) . ')); $db->close();';
        $pipes = [];
        $process = proc_open([PHP_BINARY, '-r', $source], [['pipe','r'], ['pipe','w'], ['pipe','w']], $pipes);
        if (!is_resource($process)) throw new RuntimeException('Worker failed');
        fclose($pipes[0]); $workers[] = [$process, $pipes];
      }
      usleep(200000); $db->commit();
      $results = [];
      foreach ($workers as [$process, $pipes]) {
        $out = stream_get_contents($pipes[1]); $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        if (proc_close($process) !== 0 || $error !== '') throw new RuntimeException('Worker failed: ' . $error);
        $results[] = json_decode($out, true);
      }
      $after = catalog_snapshot($db);
      echo json_encode(compact('results', 'after'));
    `);
    const [creation, deletion] = data.results;
    const remains = data.after[table].some(row => Number(row.id) === unusedId);
    if (creation.status === 200) {
      assert.equal(deletion.status, 409);
      assert.equal(remains, true);
      assert.equal(data.after.memberships.length, 3);
    } else {
      assert.equal(creation.status, 404);
      assert.equal(deletion.result, 1);
      assert.equal(remains, false);
      assert.equal(data.after.memberships.length, 2);
    }
  });

  test(`invalid IDs, Staff, GET and missing CSRF cannot dispatch delete_${kind}`, () => {
    for (const id of [null, '0', '-1', '1 OR 1=1', ['1'], true]) {
      const response = run(session, `ob_start(); require 'admin_class.php';
        $action=(new ReflectionClass('Action'))->newInstanceWithoutConstructor();
        $p=new ReflectionProperty('Action','db'); $p->setAccessible(true);
        $p->setValue($action,new class {public function close(){}});
        $_SERVER['REQUEST_METHOD']='POST';
        $_POST=json_decode(${literal(JSON.stringify({ id, csrf_token: session.csrf_token }))},true);
        echo $action->delete_${kind}(); unset($action);`);
      assert.equal(response.status, 400);
    }
    assert.equal(run(session, `$_SERVER['REQUEST_METHOD']='GET'; require_action_access('delete_${kind}');`).status, 405);
    assert.equal(run(session, `$_SERVER['REQUEST_METHOD']='POST'; require_action_access('delete_${kind}');`).status, 403);
    assert.equal(run({ ...session, login_type: 2 }, `require_action_access('delete_${kind}');`).status, 403);
  });
}
