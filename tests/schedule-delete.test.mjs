import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1, csrf_token: 'schedule-delete-test' };
function isolated(code, options = {}) {
  return JSON.parse(run(session, `require 'tests/helpers/membership-db.php';
    with_membership_database(function($db,$schema) {
      $db->query('CREATE TABLE schedules (id INT PRIMARY KEY, member_id INT, dow TEXT, date_from DATE, date_to DATE, time_from TIME, time_to TIME) ENGINE=InnoDB');
      $db->query("INSERT INTO schedules VALUES (1,9,'1','2026-11-01','2026-11-30','09:00','10:00'),(2,10,'2','2026-11-01','2026-11-30','11:00','12:00')");
      function schedule_delete_snapshot($db) { return [
        'schedules'=>$db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC),
        'members'=>$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC),
        'history'=>membership_snapshot($db)]; }
      ${code}
    });`, options).body);
}
for (const role of [1,2]) {
  test(`role ${role} deletes only the selected schedule and preserves members and membership/payment history`, () => {
    const data = isolated(`$_SESSION['login_type']=${role};
      $before=schedule_delete_snapshot($db);
      $result=new_membership_for_test($db,['id'=>'1','csrf_token'=>'schedule-delete-test'],'delete_schedule');
      $after=schedule_delete_snapshot($db); echo json_encode(compact('before','result','after'));`);
    assert.equal(data.result.result, 1);
    assert.deepEqual(data.after, { ...data.before, schedules: data.before.schedules.filter(row => Number(row.id)!==1) });
  });
}
for (const id of [null,'','0','-1','2147483648','1 OR 1=1',['1'],true]) {
  test(`invalid ID ${JSON.stringify(id)} cannot delete schedules`, () => {
    const data=isolated(`$before=schedule_delete_snapshot($db);
      $result=new_membership_for_test($db,['id'=>json_decode(${literal(JSON.stringify(id))},true),'csrf_token'=>'schedule-delete-test'],'delete_schedule');
      $after=schedule_delete_snapshot($db); echo json_encode(compact('before','result','after'));`);
    assert.equal(data.result.status,400);
    assert.deepEqual(data.after,data.before);
  });
}
test('missing or already deleted schedule returns 404, not success', () => {
  const data=isolated(`$post=['id'=>'1','csrf_token'=>'schedule-delete-test'];
    $first=new_membership_for_test($db,$post,'delete_schedule');
    $before=schedule_delete_snapshot($db);
    $second=new_membership_for_test($db,$post,'delete_schedule');
    $after=schedule_delete_snapshot($db); echo json_encode(compact('first','second','before','after'));`);
  assert.equal(data.first.result,1);
  assert.equal(data.second.status,404);
  assert.match(JSON.parse(data.second.result).error,/no longer exists/);
  assert.deepEqual(data.after,data.before);
});
test('database write failure leaves all records intact and returns a safe error', () => {
  const data=isolated(`$db->query("CREATE TRIGGER fail_delete BEFORE DELETE ON schedules FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Forced failure'");
    ini_set('error_log',''); $before=schedule_delete_snapshot($db);
    $result=new_membership_for_test($db,['id'=>'1','csrf_token'=>'schedule-delete-test'],'delete_schedule');
    $after=schedule_delete_snapshot($db); echo json_encode(compact('before','result','after'));`, {expectedStderr:/^Unable to delete schedule\.\r?\n$/});
  assert.equal(data.result.status,500);
  assert.deepEqual(data.after,data.before);
  assert.doesNotMatch(data.result.result,/Forced failure|SQLSTATE|Stack trace/);
});
for(const token of [null,'','wrong',['schedule-delete-test']]) {
  test(`CSRF ${JSON.stringify(token)} is rejected before deletion`,()=>{
    assert.equal(run(session,`$_SERVER['REQUEST_METHOD']='POST'; $_POST=['csrf_token'=>json_decode(${literal(JSON.stringify(token))},true)]; require_action_access('delete_schedule');`).status,403);
  });
}
test('GET cannot delete schedules',()=>assert.equal(run(session,"$_SERVER['REQUEST_METHOD']='GET'; require_action_access('delete_schedule');").status,405));
