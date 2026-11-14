import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

for (const [start,months,end] of [
  ['2027-01-31',1,'2027-02-28'],
  ['2028-01-31',1,'2028-02-29'],
  ['2026-08-31',1,'2026-09-30'],
  ['2027-01-30',1,'2027-02-28'],
  ['2027-01-31',2,'2027-03-31'],
  ['2026-11-30',3,'2027-02-28'],
  ['2028-02-29',12,'2029-02-28'],
  ['2096-02-29',48,'2100-02-28'],
  ['2026-12-15',3,'2027-03-15'],
  ['2026-11-14',3,'2027-02-14'],
  ['9999-11-30',1,'9999-12-30'],
]) {
  test(`${start} plus ${months} months ends on ${end}`,()=>{
    const result=run({},`require 'membership_dates.php';$start=new DateTimeImmutable('${start}');
      echo json_encode([membership_end_date($start,${months}),$start->format('Y-m-d')]);`);
    assert.deepEqual(JSON.parse(result.body),[end,start]);
  });
}

for (const months of [0,-1,2147483647]) {
  test(`invalid duration ${months} is rejected`,()=>{
    assert.equal(run({},`require 'membership_dates.php';try {
      membership_end_date(new DateTimeImmutable('2027-01-31'),${months});echo 'accepted';
    } catch(InvalidArgumentException $e){echo 'rejected';}`).body,'rejected');
  });
}

for (const method of ['save_membership','renew_membership']) {
  test(`${method} persists a clamped February end date and preserves previous history`,()=>{
    // Fix the date only inside this isolated test process, without changing the server clock.
    const result=run({login_id:2,login_type:1,csrf_token:'dates'},`
      require 'tests/helpers/membership-db.php';
      $source=file_get_contents('admin_class.php');
      $source=str_replace("new DateTimeImmutable('today')", "new DateTimeImmutable('2027-01-31')",$source);
      $source=str_replace('__DIR__',var_export(getcwd(),true),$source);
      $source=str_replace('Class Action {','Class DateTestAction {',$source);
      eval('?>'.$source);
      with_membership_database(function($db,$schema){
        $GLOBALS['auth_connection']=$db;
        $db->query('UPDATE plans SET plan=1 WHERE id=1');
        $before=membership_snapshot($db);
        $post=${method === 'save_membership' ? "['member_id'=>'9','plan_id'=>'1','package_id'=>'1','trainer_id'=>'','csrf_token'=>'dates']" : "['rid'=>'9','csrf_token'=>'dates']"};
        ob_start();
        $action=(new ReflectionClass('DateTestAction'))->newInstanceWithoutConstructor();
        $property=new ReflectionProperty('DateTestAction','db');$property->setAccessible(true);$property->setValue($action,$db);
        $_SERVER['REQUEST_METHOD']='POST';$_POST=$post;http_response_code(200);
        $saved=['result'=>$action->{${literal(method)}}(),'status'=>http_response_code()];
        $property->setValue($action,new class {function close(){}});unset($action);
        $after=membership_snapshot($db);echo json_encode(compact('saved','before','after'));
      });`);
    const data=JSON.parse(result.body);
    assert.equal(data.saved.status,200);
    assert.equal(data.after.memberships.length,data.before.memberships.length+1);
    assert.equal(data.after.memberships.at(-1).start_date,'2027-01-31');
    assert.equal(data.after.memberships.at(-1).end_date,'2027-02-28');
    assert.deepEqual(data.after.payments,data.before.payments);
    const original=data.after.memberships.slice(0,-1);
    if(method==='renew_membership') original[1].status=data.before.memberships[1].status;
    assert.deepEqual(original,data.before.memberships);
  });
}
