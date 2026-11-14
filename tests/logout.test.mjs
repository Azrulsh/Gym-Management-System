import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session={login_id:2,login_type:1,csrf_token:'logout-test'};
const action=`require 'admin_class.php'; ob_start();
  $action=(new ReflectionClass('Action'))->newInstanceWithoutConstructor();
  $property=new ReflectionProperty('Action','db');$property->setAccessible(true);
  $property->setValue($action,new class {public function close(){}});`;
for(const entry of ['dispatch','method']) {
  test(`GET ${entry} cannot log out even with a valid CSRF token`,()=>{
    const response=run(session,`$_SERVER['REQUEST_METHOD']='GET'; $_POST=['csrf_token'=>'logout-test'];
      ${entry==='dispatch'?"require_action_access('logout');":action+' $action->logout(); unset($action);'}
      echo 'LOGGED_OUT';`);
    assert.equal(response.status,405);
    assert.match(response.body,/Use POST/);
    assert.doesNotMatch(response.body,/LOGGED_OUT/);
  });
  for(const token of [null,'','wrong',['logout-test']]) {
    test(`POST ${entry} rejects CSRF ${JSON.stringify(token)}`,()=>{
      const response=run(session,`$_SERVER['REQUEST_METHOD']='POST';$_POST=['csrf_token'=>json_decode(${literal(JSON.stringify(token))},true)];
        ${entry==='dispatch'?"require_action_access('logout');":action+' $action->logout(); unset($action);'}
        echo 'LOGGED_OUT';`);
      assert.equal(response.status,403);
      assert.doesNotMatch(response.body,/LOGGED_OUT/);
    });
  }
}
for(const role of [1,2]) {
  test(`valid logout for role ${role} destroys session, clears its data and redirects`,()=>{
    const response=run({...session,login_type:role},`${action}
      $_SERVER['REQUEST_METHOD']='POST';$_POST=['csrf_token'=>'logout-test'];
      $action->logout();unset($action);
      echo json_encode(['session'=>$_SESSION,'active'=>session_status()===PHP_SESSION_ACTIVE,'loggedIn'=>isset($_SESSION['login_id'])]);`);
    assert.equal(response.status,303);
    assert.deepEqual(JSON.parse(response.body),{session:[],active:false,loggedIn:false});
  });
}
test('anonymous logout is rejected before dispatch',()=>{
  assert.equal(run({},"$_SERVER['REQUEST_METHOD']='POST';require_action_access('logout');").status,401);
});
test('topbar renders a POST logout form with a token and preserves Manage Account',()=>{
  const response=run(session,"include 'topbar.php';");
  assert.equal(response.status,200);
  assert.match(response.body,/<form action="ajax\.php\?action=logout" method="post"/);
  assert.match(response.body,/type="hidden" name="csrf_token" value="logout-test"/);
  assert.match(response.body,/<button type="submit" class="dropdown-item">/);
  assert.match(response.body,/id="manage_my_account"/);
  assert.doesNotMatch(response.body,/href="ajax\.php\?action=logout"/);
});
