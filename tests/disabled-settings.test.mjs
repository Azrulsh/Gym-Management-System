import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

for(const role of [2]){
  for(const method of ['GET','POST']){
    test(`Staff cannot dispatch Settings using ${method}, even with CSRF and upload fields`,()=>{
      const response=run({login_id:2,login_type:role,csrf_token:'settings-test'},`
        $_GET=['action'=>'save_settings'];$_SERVER['REQUEST_METHOD']='${method}';
        $_POST=['csrf_token'=>'settings-test','name'=>'test','email'=>"test@example.test",'contact'=>'123','about'=>'test'];
        $_FILES=['img'=>['tmp_name'=>'must-not-be-opened','name'=>'test.php','error'=>0]];
        include 'ajax.php';echo 'DISPATCHED';`);
      assert.equal(response.status,403);
      assert.deepEqual(JSON.parse(response.body),{error:'You do not have permission to perform this action.'});
      assert.doesNotMatch(response.body,/Warning|Fatal error|DISPATCHED|system_settings|must-not-be-opened/);
    });
  }
}

test('anonymous Settings request still requires authentication',()=>{
  const response=run({},`$_GET=['action'=>'save_settings'];include 'ajax.php';`);
  assert.equal(response.status,401);assert.equal(JSON.parse(response.body).error,'Authentication required.');
});

test('unsafe Settings handler is no longer available for internal calls',()=>{
  assert.equal(run({},`require 'admin_class.php';echo method_exists('Action','save_settings')?'present':'removed';`).body,'removed');
});

for (const method of ['GET','POST']) {
 test('Admin Settings '+method+' checks request before database access',()=>{
  const response=run({login_id:2,login_type:1,csrf_token:'expected'},`$_GET=['action'=>'save_settings'];$_SERVER['REQUEST_METHOD']='${method}';$_POST=['csrf_token'=>'wrong'];include 'ajax.php';`);
  assert.equal(response.status,method==='GET'?405:403);
 });
}
