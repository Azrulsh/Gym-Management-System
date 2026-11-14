import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1, csrf_token: 'schedule-save-token' };
for (const token of [null, '', 'wrong', ['schedule-save-token']]) {
  for (const entry of ['dispatch', 'method']) {
    test(`save_schedule ${entry} rejects CSRF ${JSON.stringify(token)} before any schedule query`, () => {
      const response = run(session, `
        $_SERVER['REQUEST_METHOD']='POST';
        $_POST=['id'=>'','member_id'=>'0','csrf_token'=>json_decode(${literal(JSON.stringify(token))},true)];
        ${entry === 'dispatch' ? "require_action_access('save_schedule');" : `
          require 'admin_class.php'; ob_start();
          $action=(new ReflectionClass('Action'))->newInstanceWithoutConstructor();
          $property=new ReflectionProperty('Action','db'); $property->setAccessible(true);
          $property->setValue($action,new class { public function close() {} });
          echo $action->save_schedule(); unset($action);
        `}
        echo 'DISPATCHED';
      `);
      assert.equal(response.status, 403);
      assert.doesNotMatch(response.body, /DISPATCHED|Invalid schedule or member ID|Fatal error/);
    });
  }
}
test('Save Schedule rejects GET with 405 even when a valid token is supplied', () => {
  const response=run(session,"$_SERVER['REQUEST_METHOD']='GET'; $_POST=['csrf_token'=>'schedule-save-token']; require_action_access('save_schedule'); echo 'DISPATCHED';");
  assert.equal(response.status,405);
  assert.match(JSON.parse(response.body).error,/Use POST/);
  assert.doesNotMatch(response.body,/DISPATCHED/);
});
for(const role of [1,2]) {
  test(`role ${role} passes Save Schedule dispatch with a valid token`,()=>{
    const response=run({...session,login_type:role},"$_SERVER['REQUEST_METHOD']='POST'; $_POST=['csrf_token'=>'schedule-save-token']; require_action_access('save_schedule'); echo 'DISPATCHED';");
    assert.equal(response.status,200);
    assert.equal(response.body,'DISPATCHED');
  });
}
