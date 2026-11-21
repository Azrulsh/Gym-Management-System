import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

const session={login_id:2,login_type:1,csrf_token:'price-test'};
function isolated(code){return JSON.parse(run(session,`require 'tests/helpers/membership-read-db.php';require 'membership_read.php';
  function price_migration($db){$db->multi_query(file_get_contents('tests/fixtures/legacy-schema/007_membership_price_snapshots.sql'));
    do{if($result=$db->store_result())$result->free();}while($db->more_results()&&$db->next_result());}
  function price_create($db,$member,$trainer='2'){
    $result=new_membership_for_test($db,['member_id'=>(string)$member,'plan_id'=>'1','package_id'=>'1','trainer_id'=>$trainer,
      'plan_fee'=>'9999','package_fee'=>'9999','trainer_fee_snapshot'=>'9999','csrf_token'=>'price-test']);
    $id=(int)$db->query('SELECT LAST_INSERT_ID()')->fetch_row()[0];return [$result,$id];
  }
  with_membership_read_database(function($db,$schema){$GLOBALS['auth_connection']=$db;${code}});`).body);}
test('new and existing memberships retain agreed fees while new subscribers get edited catalog prices',()=>{
  const data=isolated(`[$created,$id]=price_create($db,9);
    $before=membership_read_records($db,null,$id)[0];
    $db->query('UPDATE plans SET amount=150.25 WHERE id=1');$db->query('UPDATE packages SET amount=30.50 WHERE id=1');$db->query('UPDATE trainers SET rate=15.75 WHERE id=2');
    $after=membership_read_records($db,null,$id)[0];
    [$newResult,$newId]=price_create($db,11);$new=membership_read_records($db,null,$newId)[0];
    $view=render_membership_read_page($db,'view_pdetails.php',['id'=>$id]);
    $payment=render_membership_read_page($db,'payment.php',['rid'=>$id]);
    echo json_encode(compact('created','before','after','newResult','new','view','payment'));`);
  assert.equal(data.created.result,1);assert.equal(data.newResult.result,1);
  assert.deepEqual([data.before.pamount,data.before.ppamount,data.before.trainer_fee],['100.00','20.00','10.00']);
  assert.deepEqual([data.after.pamount,data.after.ppamount,data.after.trainer_fee],['100.00','20.00','10.00']);
  assert.deepEqual([data.new.pamount,data.new.ppamount,data.new.trainer_fee],['150.25','30.50','15.75']);
  assert.equal(data.after.price_source,'captured');
  assert.match(data.view,/Plan Membership Fee: <b>100\.00/);
  assert.match(data.payment,/130\.00/);assert.doesNotMatch(data.payment,/150\.25|30\.50|15\.75/);
});
test('Renew captures latest fees and leaves closed membership prices and payment history intact',()=>{
  const data=isolated(`[$created,$id]=price_create($db,9);
    $db->query('UPDATE registration_info SET start_date=DATE_SUB(CURDATE(),INTERVAL 3 MONTH),end_date=DATE_SUB(CURDATE(),INTERVAL 1 DAY) WHERE id='.(int)$id);
    $before=membership_read_records($db,null,$id)[0];$paymentsBefore=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query('UPDATE plans SET amount=250 WHERE id=1');$db->query('UPDATE packages SET amount=40 WHERE id=1');$db->query('UPDATE trainers SET rate=25 WHERE id=2');
    $renewed=new_membership_for_test($db,['rid'=>(string)$id,'csrf_token'=>'price-test'],'renew_membership');
    $old=membership_read_records($db,null,$id)[0];$new=membership_read_records($db,null,$renewed['result'])[0];
    $paymentsAfter=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('renewed','before','old','new','paymentsBefore','paymentsAfter'));`);
  assert.equal(data.renewed.status,200);assert.equal(Number(data.old.status),0);
  for(const key of ['plan_fee','package_fee','trainer_fee_snapshot','prices_recorded_at','start_date','end_date'])assert.equal(data.old[key],data.before[key]);
  assert.deepEqual([data.new.pamount,data.new.ppamount,data.new.trainer_fee],['250.00','40.00','25.00']);
  assert.deepEqual(data.paymentsBefore,data.paymentsAfter);
});
test('no trainer captures zero rather than a mutable fee or missing price',()=>{
  const data=isolated(`[$result,$id]=price_create($db,9,'');$row=membership_read_records($db,null,$id)[0];echo json_encode(compact('result','row'));`);
  assert.equal(data.result.result,1);assert.equal(data.row.trainer_fee_snapshot,'0.00');
});
test('migration labels legacy baseline, freezes available fees and never overwrites them on re-import',()=>{
  const data=isolated(`$db->query("ALTER TABLE registration_info DROP COLUMN plan_fee,DROP COLUMN package_fee,DROP COLUMN trainer_fee_snapshot,DROP COLUMN price_source,DROP COLUMN prices_recorded_at");
    $before=membership_snapshot($db);price_migration($db);$first=membership_read_records($db,null,9)[0];
    $db->query('UPDATE plans SET amount=999 WHERE id=1');price_migration($db);
    $after=membership_read_records($db,null,9)[0];$paymentsAfter=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $view=render_membership_read_page($db,'view_pdetails.php',['id'=>9]);echo json_encode(compact('before','first','after','paymentsAfter','view'));`);
  assert.equal(data.first.price_source,'migration_baseline');assert.equal(data.first.pamount,'100.00');
  assert.equal(data.after.pamount,'100.00');assert.equal(data.after.prices_recorded_at,data.first.prices_recorded_at);
  assert.deepEqual(data.before.payments,data.paymentsAfter);
  assert.match(data.view,/original signup prices could not be verified/);
});
test('missing old catalog references stay NULL during migration rather than inventing historical prices',()=>{
  const data=isolated(`$db->query("UPDATE registration_info SET plan_fee=NULL,package_fee=NULL,trainer_fee_snapshot=NULL,price_source='legacy_unrecorded'");
    $db->query('DELETE FROM plans WHERE id=1');price_migration($db);$row=membership_read_records($db,null,9)[0];
    $state=membership_read_state($row);echo json_encode(compact('row','state'));`);
  assert.equal(data.row.pamount,null);assert.equal(data.state.can_pay,false);assert.equal(data.row.price_source,'migration_baseline');
});
test('expired membership with unrecorded fees may Renew at current known prices while old payments stay blocked',()=>{
  const data=isolated(`$db->query('UPDATE registration_info SET plan_fee=NULL WHERE id=9');
    $row=membership_read_records($db,null,9)[0];$state=membership_read_state($row);
    $renewed=new_membership_for_test($db,['rid'=>'9','csrf_token'=>'price-test'],'renew_membership');echo json_encode(compact('state','renewed'));`);
  assert.equal(data.state.can_pay,false);assert.equal(data.state.can_renew,true);assert.equal(data.renewed.status,200);
});
test('invalid catalog price is rejected without inserting or closing a membership',()=>{
  const data=isolated(`$db->query('UPDATE plans SET amount=-1 WHERE id=1');$before=membership_snapshot($db);
    [$created,$id]=price_create($db,9);$renewed=new_membership_for_test($db,['rid'=>'9','csrf_token'=>'price-test'],'renew_membership');
    $after=membership_snapshot($db);echo json_encode(compact('before','after','created','renewed'));`);
  assert.equal(data.created.status,400);assert.equal(data.renewed.status,400);assert.deepEqual(data.before,data.after);
});
