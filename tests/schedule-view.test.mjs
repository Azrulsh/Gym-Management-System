import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

for(const get of [{},{id:'abc'},{id:'1 OR 1=1'},{id:"1'"},{id:'0'},{id:'2147483648'},{id:['1']},{id:true}]){
 test(`schedule details rejects ${JSON.stringify(get)} before opening a connection`,()=>{
  const d=run({login_id:2,login_type:1},`
   $_GET=json_decode(${literal(JSON.stringify(get))},true);
   $page=str_replace("include 'db_connect.php';","throw new RuntimeException('Unexpected connection');",file_get_contents('view_schedule.php'));
   $page=str_replace('__DIR__',var_export(getcwd(),true),$page);eval('?>'.$page);`);
  assert.equal(d.status,400);assert.match(d.body,/Invalid schedule ID/);assert.doesNotMatch(d.body,/Fatal error|Warning|<script>/);
 });
}

function render(id,setup='',role=1,options={}){return run({login_id:role===1?2:3,login_type:role},`
 require 'tests/helpers/membership-read-db.php';
 with_membership_read_database(function($db){
  $GLOBALS['auth_connection']=$db;
  $db->query('CREATE TABLE schedules(id INT PRIMARY KEY,member_id INT,time_from TIME,time_to TIME)');
  $db->query("INSERT INTO schedules VALUES(1,11,'09:00:15','10:30:00')");
  ${setup}
  echo render_membership_read_page($db,'view_schedule.php',['id'=>'${id}']);
 });`,options);}

for(const role of [1,2]){
 test(`role ${role} can view exact schedule details with escaped name and CSRF controls`,()=>{
  const d=render('1',`$db->query("UPDATE members SET firstname='<script>alert(1)</script>',lastname='Test' WHERE id=11");`,role);
  assert.equal(d.status,200);assert.match(d.body,/Schedule for:/);assert.match(d.body,/&lt;script&gt;/i);
  assert.doesNotMatch(d.body,/<script>alert\(1\)|Undefined|Warning|Fatal error/);
  assert.match(d.body,/09:00 AM/);assert.match(d.body,/10:30 AM/);
  assert.match(d.body,/data-id="1" data-csrf-token="[a-f0-9]{64}"/);
  assert.match(d.body,/Confirm Delete/);assert.match(d.body,/id="edit"/);
 });
}
test('missing schedule returns 404 with no controls',()=>{
 const d=render('999');assert.equal(d.status,404);assert.match(d.body,/Schedule not found/);assert.doesNotMatch(d.body,/<button|<script>/);
});
test('orphaned profile does not hide an existing schedule or leak warnings',()=>{
 const d=render('1',"$db->query('UPDATE schedules SET member_id=999 WHERE id=1');");
 assert.equal(d.status,200);assert.match(d.body,/Member profile missing \(ID 999\)/);assert.doesNotMatch(d.body,/Warning|Fatal error/);
});
test('query failure returns generic 503 without SQL or stack traces',()=>{
 const d=render('1',"$db->query('DROP TABLE schedules');",1,{expectedStderr:/Unable to load schedule details/});
 assert.equal(d.status,503);assert.match(d.body,/Unable to load schedule/);assert.doesNotMatch(d.body,/SELECT|mysqli|Stack trace|Fatal error/);
});
test('anonymous requests cannot view legacy schedule details',()=>{
 const d=run({},"$_GET=['id'=>'1'];include 'view_schedule.php';");assert.doesNotMatch(d.body,/Schedule for:|<button/);
});
