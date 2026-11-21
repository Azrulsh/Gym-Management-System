import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

for (const page of ['events','manage_event','view_event']) {
 test(`anonymous cannot open ${page}`,()=>{
  const result=run({},`include '${page}.php';`);assert.equal(result.status,302);assert.equal(result.body,'');
 });
}
for (const action of ['save_event','delete_event','save_event_participant']) {
 test(`${action} rejects GET and incorrect CSRF before any event query`,()=>{
  for (const [method,token,status] of [['GET','events-token',405],['POST','wrong',403]]) {
   const r=run({login_id:1,login_type:1,csrf_token:'events-token'},`$_SERVER['REQUEST_METHOD']='${method}';$_POST=['csrf_token'=>'${token}'];$_GET=['action'=>${literal(action)}];include 'ajax.php';`);
   assert.equal(r.status,status);assert.doesNotMatch(r.body,/Fatal|Warning|SELECT|INSERT/);
  }
 });
}
