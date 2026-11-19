import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

function isolated(code){return JSON.parse(run({login_id:2,login_type:1,csrf_token:'duration-limit'},`
 require 'tests/helpers/membership-read-db.php';
 with_membership_read_database(function($db){
  $db->query('ALTER TABLE plans MODIFY id INT NOT NULL AUTO_INCREMENT');
  $max=membership_max_months(new DateTimeImmutable('today'));
  $post=['id'=>'1','version'=>'1','plan'=>(string)$max,'amount'=>'100.00','csrf_token'=>'duration-limit'];
  ${code}
 });`).body);}

for(const id of ['', '1']){
 test(`${id?'Edit':'Add'} rejects an unusable duration without changing catalog or history`,()=>{
  const d=isolated(`$post['id']='${id}';$before=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);$history=membership_snapshot($db);
   $results=[];foreach([$max+1,100000,2147483647] as $months){$post['plan']=(string)$months;$results[]=new_membership_for_test($db,$post,'save_plan');}
   $after=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);$historyAfter=membership_snapshot($db);
   echo json_encode(compact('results','before','after','history','historyAfter'));`);
  for(const result of d.results){assert.equal(result.status,400);assert.match(JSON.parse(result.result).error,/year 9999/);}
  assert.deepEqual(d.after,d.before);assert.deepEqual(d.historyAfter,d.history);
 });
}

test('largest supported duration saves and can be used for Add and Renew',()=>{
 const d=isolated(`$history=membership_snapshot($db);$saved=new_membership_for_test($db,$post,'save_plan');
  $created=new_membership_for_test($db,['member_id'=>'9','plan_id'=>'1','package_id'=>'1','trainer_id'=>'','csrf_token'=>'duration-limit']);
  $added=$db->query('SELECT * FROM registration_info ORDER BY id DESC LIMIT 1')->fetch_assoc();
  $db->query("UPDATE registration_info SET start_date=DATE_SUB(CURDATE(),INTERVAL 4 MONTH),end_date=DATE_SUB(CURDATE(),INTERVAL 1 DAY) WHERE id=9");
  $renewed=new_membership_for_test($db,['rid'=>'9','csrf_token'=>'duration-limit'],'renew_membership');
  $renewal=$db->query('SELECT * FROM registration_info ORDER BY id DESC LIMIT 1')->fetch_assoc();
  $payments=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
  echo json_encode(compact('max','saved','created','added','renewed','renewal','history','payments'));`);
 assert.equal(d.saved.result,1);assert.equal(d.created.result,1);assert.equal(d.renewed.status,200);
 for(const row of [d.added,d.renewal]){assert.equal(row.end_date.slice(0,7),'9999-12');assert.equal(Number(row.plan_months),d.max);}
 assert.deepEqual(d.payments,d.history.payments);
});

test('Plan form uses the same current duration limit as the backend',()=>{
 const d=isolated(`$GLOBALS['auth_connection']=$db;$html=render_membership_read_page($db,'plans.php');echo json_encode(compact('max','html'));`);
 assert.match(d.html,new RegExp('<input(?=[^>]*name="plan")(?=[^>]*max="'+d.max+'")[^>]*>'));
});

test('duration ceiling follows the starting month, including year 9999',()=>{
 const d=JSON.parse(run({},`require 'membership_dates.php';echo json_encode([
 membership_max_months(new DateTimeImmutable('2026-01-31')),
 membership_max_months(new DateTimeImmutable('2026-02-01')),
 membership_max_months(new DateTimeImmutable('9999-11-30')),
 membership_max_months(new DateTimeImmutable('9999-12-01'))]);`).body);
 assert.deepEqual(d,[(9999-2026)*12+11,(9999-2026)*12+10,1,0]);
});
