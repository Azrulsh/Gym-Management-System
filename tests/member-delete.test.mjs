import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1, csrf_token: 'member-delete-token' };
function isolated(code, options = {}) {
  const response = run(session, `require 'tests/helpers/membership-db.php';
    function member_delete_snapshot($db) {
      $data = membership_snapshot($db);
      $data['members'] = $db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $data['schedules'] = $db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      return $data;
    }
    with_membership_database(function($db, $schema) {
      $db->query('INSERT INTO members (id) VALUES (12), (13)');
      $db->query('CREATE TABLE schedules (id INT PRIMARY KEY AUTO_INCREMENT, member_id INT NOT NULL, dow TEXT NOT NULL, date_from DATE NOT NULL, date_to DATE NOT NULL, time_from TIME NOT NULL, time_to TIME NOT NULL) ENGINE=InnoDB');
      $db->query("INSERT INTO schedules VALUES (1, 12, '1,3', '2026-01-01', '2026-12-31', '09:00', '10:00')");
      $db->query(file_get_contents('database/migrations/015_schedule_versions.sql'));
      ${code}
    });`, options);
  return JSON.parse(response.body);
}

for (const [id, reason] of [[9, 'membership history'], [10, 'membership history'], [12, 'schedule records']]) {
  test(`member ${id} cannot be deleted because ${reason} exists`, () => {
    const data = isolated(`
      $before = member_delete_snapshot($db);
      $result = new_membership_for_test($db, ['id' => '${id}', 'csrf_token' => $_SESSION['csrf_token']], 'delete_member');
      $after = member_delete_snapshot($db);
      echo json_encode(compact('before','result','after'));
    `);
    assert.equal(data.result.status, 409);
    assert.match(JSON.parse(data.result.result).error, new RegExp(reason));
    assert.deepEqual(data.after, data.before);
  });
}

for (const role of [1, 2]) {
  test(`role ${role} may delete an unused member without changing history`, () => {
    const data = isolated(`
      $_SESSION['login_type'] = ${role};
      $before = member_delete_snapshot($db);
      $result = new_membership_for_test($db, ['id' => '11', 'csrf_token' => $_SESSION['csrf_token']], 'delete_member');
      $after = member_delete_snapshot($db);
      echo json_encode(compact('before','result','after'));
    `);
    assert.equal(data.result.result, 1);
    const expected = { ...data.before, members: data.before.members.filter(row => Number(row.id) !== 11) };
    assert.deepEqual(data.after, expected);
  });
}

test('missing members return 404 and leave all history intact', () => {
  const data = isolated(`
    $before = member_delete_snapshot($db);
    $result = new_membership_for_test($db, ['id' => '999', 'csrf_token' => $_SESSION['csrf_token']], 'delete_member');
    $after = member_delete_snapshot($db);
    echo json_encode(compact('before','result','after'));
  `);
  assert.equal(data.result.status, 404);
  assert.deepEqual(data.after, data.before);
});

test('failed deletion rolls back and allows a subsequent valid attempt', () => {
  const data = isolated(`
    $db->query("CREATE TRIGGER fail_member_delete BEFORE DELETE ON members FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Forced test failure'");
    ini_set('error_log','');
    $post = ['id'=>'11', 'csrf_token'=>$_SESSION['csrf_token']];
    $before = member_delete_snapshot($db);
    $failed = new_membership_for_test($db, $post, 'delete_member');
    $afterFailure = member_delete_snapshot($db);
    $db->query('DROP TRIGGER fail_member_delete');
    $success = new_membership_for_test($db, $post, 'delete_member');
    echo json_encode(compact('before','failed','afterFailure','success'));
  `, { expectedStderr: /^Unable to delete member \(error code 1644\)\.\r?\n$/ });
  assert.equal(data.failed.status, 500);
  assert.deepEqual(data.afterFailure, data.before);
  assert.equal(data.success.result, 1);
});

for (const id of [null, '0', '-1', '9 OR 1=1', ['9'], true]) {
  test(`invalid ID ${JSON.stringify(id)} cannot reach a member deletion query`, () => {
    const response = run(session, `ob_start(); require 'admin_class.php';
      $action=(new ReflectionClass('Action'))->newInstanceWithoutConstructor();
      $p=new ReflectionProperty('Action','db'); $p->setAccessible(true);
      $p->setValue($action,new class {public function close(){}});
      $_SERVER['REQUEST_METHOD']='POST';
      $_POST=json_decode(${literal(JSON.stringify({ id, csrf_token: session.csrf_token }))},true);
      echo $action->delete_member(); unset($action);`);
    assert.equal(response.status, 400);
  });
}

for (const token of [null, '', 'wrong', ['token']]) {
  test(`CSRF ${JSON.stringify(token)} cannot dispatch a member deletion`, () => {
    const response = run(session, `$_SERVER['REQUEST_METHOD']='POST';
      $_POST=json_decode(${literal(JSON.stringify({ id: '11', csrf_token: token }))},true);
      require_action_access('delete_member'); echo 'DISPATCHED';`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(response.body, /DISPATCHED/);
  });
}

test('GET cannot delete a member', () => {
  assert.equal(run(session, "$_SERVER['REQUEST_METHOD']='GET'; require_action_access('delete_member');").status, 405);
});

for (const action of ['save_membership', 'save_schedule', 'edit_schedule']) {
  test(`concurrent ${action} and Delete Member cannot leave a dangling member reference`, () => {
    const data = isolated(`
      $post = ${action === 'save_membership'
        ? "['member_id'=>'13','plan_id'=>'1','package_id'=>'1','trainer_id'=>'','csrf_token'=>$_SESSION['csrf_token']]"
        : "['id'=>'" + (action === 'edit_schedule' ? '1' : '') + "','version'=>'1','member_id'=>'13','date_from'=>'2026-01','date_to'=>'2026-12','time_from'=>'09:00','time_to'=>'10:00','dow'=>['1','3'],'csrf_token'=>$_SESSION['csrf_token']]"};
      $method = '${action === 'edit_schedule' ? 'save_schedule' : action}';
      $db->begin_transaction();
      $db->query('SELECT id FROM members WHERE id=13 FOR UPDATE');
      $workers=[];
      foreach ([[$method,$post], ['delete_member',['id'=>'13','csrf_token'=>$_SESSION['csrf_token']]]] as [$method,$post]) {
        $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;}); session_start(); '
          . 'require "tests/helpers/membership-db.php"; require "admin_class.php"; '
          . '$_SESSION=' . var_export($_SESSION,true) . '; '
          . '$db=throttle_test_connection(' . var_export($schema,true) . '); '
          . '$GLOBALS["auth_connection"]=$db; '
          . 'echo json_encode(new_membership_for_test($db,' . var_export($post,true) . ',' . var_export($method,true) . ')); $db->close();';
        $pipes=[];
        $process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
        if(!is_resource($process)) throw new RuntimeException('Worker failed');
        fclose($pipes[0]); $workers[]=[$process,$pipes];
      }
      usleep(200000); $db->commit();
      $results=[];
      foreach($workers as [$process,$pipes]) {
        $out=stream_get_contents($pipes[1]); $error=stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        if(proc_close($process)!==0 || $error!=='') throw new RuntimeException('Worker failed: '.$error);
        $results[]=json_decode($out,true);
      }
      $after=member_delete_snapshot($db);
      echo json_encode(compact('results','after'));
    `);
    const [save, deletion] = data.results;
    const memberExists = data.after.members.some(row => Number(row.id) === 13);
    if (save.status === 200) {
      assert.equal(deletion.status, 409);
      assert.equal(memberExists, true);
    } else {
      assert.equal(save.status, 404);
      assert.equal(deletion.result, 1);
      assert.equal(memberExists, false);
      assert.equal(data.after.memberships.some(row => Number(row.member_id) === 13), false);
      assert.equal(data.after.schedules.some(row => Number(row.member_id) === 13), false);
    }
  });
}

test('schedule member validation retains existing date/day semantics and blocks missing members', () => {
  const data = isolated(`
    $post=['id'=>'','member_id'=>'11','date_from'=>'2026-02','date_to'=>'2026-02','time_from'=>'09:00','time_to'=>'10:00','dow'=>['0','2'],'csrf_token'=>$_SESSION['csrf_token']];
    $saved=new_membership_for_test($db,$post,'save_schedule');
    $after=member_delete_snapshot($db);
    $post['member_id']='999';
    $missing=new_membership_for_test($db,$post,'save_schedule');
    echo json_encode(compact('saved','after','missing'));
  `);
  assert.equal(data.saved.result, 1);
  const added = data.after.schedules[1];
  assert.equal(added.date_from, '2026-02-01');
  assert.equal(added.date_to, '2026-02-28');
  assert.equal(added.dow, '0,2');
  assert.equal(data.missing.status, 404);
});
