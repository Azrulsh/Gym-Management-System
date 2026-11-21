import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './helpers/php.mjs';

function isolated(code) {
  return JSON.parse(run({login_id:2,login_type:1,csrf_token:'allocation'}, `
    require 'tests/helpers/membership-read-db.php'; require 'payment_read.php';
    with_membership_read_database(function($db,$schema) {
      $GLOBALS['auth_connection']=$db;
      function allocate($db,$total,$plan) {
        return new_membership_for_test($db,['registration_id'=>'9','amount'=>$total,'plan_amount'=>$plan,'remarks'=>'test','csrf_token'=>'allocation'],'save_payment');
      }
      ${code}
    });`).body);
}

test('partial Plan allocations leave the true remaining balance, other payments never pay the Plan',()=>{
  const data=isolated(`
    $legacy=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $first=allocate($db,'1.00','1.00');$balance=payment_plan_balance($db,9,'100.00');
    $view=render_membership_read_page($db,'payment.php',['rid'=>9]);
    $monthly=allocate($db,'30.00','0.00');$afterMonthly=payment_plan_balance($db,9,'100.00');
    $final=allocate($db,'129.00','99.00');$paidView=render_membership_read_page($db,'payment.php',['rid'=>9]);
    $after=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('legacy','first','balance','view','monthly','afterMonthly','final','paidView','after'));`);
  assert.equal(data.first.result,1);assert.equal(data.balance,9900);
  assert.match(data.view,/Plan Fee Remaining:.*99\.00/);assert.doesNotMatch(data.view,/Paid Already/);
  assert.equal(data.monthly.result,1);assert.equal(data.afterMonthly,9900);
  assert.equal(data.final.result,1);assert.match(data.paidView,/Paid Already/);
  assert.match(data.view,/Unallocated \(legacy\)/);assert.match(data.view,/Check the original receipts/);
  assert.deepEqual(data.after.slice(0,2),data.legacy);
  assert.deepEqual(data.after.slice(2).map(p=>p.plan_amount),['1.00','0.00','99.00']);
});

for (const value of ['-1','1.001','1e2','abc',['1'],true,null]) {
  test(`invalid allocation ${JSON.stringify(value)} writes nothing`,()=>{
    const encoded=JSON.stringify(value).replaceAll("'","\\'");
    const data=isolated(`$before=membership_snapshot($db);$result=allocate($db,'100.00',json_decode('${encoded}',true));$after=membership_snapshot($db);echo json_encode(compact('before','result','after'));`);
    assert.equal(data.result.status,400);assert.deepEqual(data.after,data.before);
  });
}

test('allocation cannot exceed payment total or remaining Plan fee, including a stale form',()=>{
  const data=isolated(`$tooLarge=allocate($db,'1.00','2.00');
    $first=allocate($db,'100.00','100.00');$before=membership_snapshot($db);
    $stale=allocate($db,'100.00','100.00');$after=membership_snapshot($db);
    $other=allocate($db,'30.00','0.00');echo json_encode(compact('tooLarge','first','before','stale','after','other'));`);
  assert.equal(data.tooLarge.status,400);assert.equal(data.first.result,1);
  assert.equal(data.stale.status,409);assert.deepEqual(data.after,data.before);assert.equal(data.other.result,1);
});

test('allocation migration preserves legacy payments and remains safe to re-import after new payments',()=>{
  const data=isolated(`$db->query('ALTER TABLE payments DROP COLUMN plan_amount');
    $before=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query(file_get_contents('tests/fixtures/legacy-schema/008_payment_plan_allocation.sql'));
    $legacy=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    allocate($db,'10.25','0.25');$first=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query(file_get_contents('tests/fixtures/legacy-schema/008_payment_plan_allocation.sql'));
    $after=$db->query('SELECT * FROM payments ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('before','legacy','first','after'));`);
  assert.deepEqual(data.legacy.map(({plan_amount,...old})=>old),data.before);
  assert.ok(data.legacy.every(p=>p.plan_amount===null));assert.deepEqual(data.after,data.first);
});

test('parallel payments cannot over-allocate the same remaining Plan fee',()=>{
  const data=isolated(`
    $post=['registration_id'=>'9','amount'=>'100.00','plan_amount'=>'100.00','csrf_token'=>'allocation'];
    $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start();'
      .'require "tests/helpers/membership-db.php";require "admin_class.php";'
      .'$_SESSION='.var_export($_SESSION,true).';'
      .'$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db;'
      .'echo json_encode(new_membership_for_test($db,'.var_export($post,true).',"save_payment"));$db->close();';
    $db->begin_transaction();$db->query('SELECT id FROM registration_info WHERE id=9 FOR UPDATE');
    $workers=[];
    for($i=0;$i<3;$i++){
      $process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
      if(!is_resource($process))throw new RuntimeException('Worker failed');
      fclose($pipes[0]);$workers[]=[$process,$pipes];
    }
    usleep(200000);$db->commit();$results=[];
    foreach($workers as [$process,$pipes]){
      $out=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);
      fclose($pipes[1]);fclose($pipes[2]);
      if(proc_close($process)!==0||$error!=='')throw new RuntimeException($error);
      $results[]=json_decode($out,true);
    }
    $balance=payment_plan_balance($db,9,'100.00');echo json_encode(compact('results','balance'));`);
  assert.equal(data.results.filter(p=>p.result===1).length,1);
  assert.equal(data.results.filter(p=>p.status===409).length,2);
  assert.equal(data.balance,0);
});

test('cent allocations retain exact balances through large prices',()=>{
  const data=isolated(`$db->query('UPDATE registration_info SET plan_fee=9999999999.99 WHERE id=9');
    $first=allocate($db,'9999999999.98','9999999999.98');$balance=payment_plan_balance($db,9,'9999999999.99');
    $last=allocate($db,'0.01','0.01');$final=payment_plan_balance($db,9,'9999999999.99');
    echo json_encode(compact('first','balance','last','final'));`);
  assert.equal(data.first.result,1);assert.equal(data.balance,1);
  assert.equal(data.last.result,1);assert.equal(data.final,0);
});
