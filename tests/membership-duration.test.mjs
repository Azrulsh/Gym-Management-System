import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

function isolated(code){
  return JSON.parse(run({login_id:2,login_type:1,csrf_token:'duration'},`
    require 'tests/helpers/membership-read-db.php';require 'membership_read.php';
    with_membership_read_database(function($db,$schema){
      $GLOBALS['auth_connection']=$db;
      function subscribe($db,$member){
        $result=new_membership_for_test($db,['member_id'=>(string)$member,'plan_id'=>'1','package_id'=>'1','trainer_id'=>'','plan_months'=>'999','csrf_token'=>'duration']);
        $id=(int)$db->query('SELECT LAST_INSERT_ID()')->fetch_row()[0];return [$result,$id];
      }
      ${code}
    });`).body);
}

test('catalog duration edits never relabel existing memberships; new subscriptions capture current months',()=>{
  const data=isolated(`[$first,$id]=subscribe($db,9);$before=membership_read_records($db,null,$id)[0];
    $db->query('UPDATE plans SET plan=12 WHERE id=1');$after=membership_read_records($db,null,$id)[0];
    [$second,$newId]=subscribe($db,11);$new=membership_read_records($db,null,$newId)[0];
    $view=render_membership_read_page($db,'view_pdetails.php',['id'=>$id]);
    $list=render_membership_read_page($db,'registered_members.php');echo json_encode(compact('first','second','before','after','new','view','list'));`);
  assert.equal(data.first.result,1);assert.equal(data.second.result,1);
  assert.equal(Number(data.after.plan),3);assert.equal(Number(data.new.plan),12);
  assert.deepEqual(data.after,data.before);
  assert.match(data.view,/Plan: <b>3 month\(s\)<\/b>/);
  assert.match(data.list,/3 month\(s\)/);assert.match(data.list,/12 month\(s\)/);
});

test('Renew captures current months and preserves the old duration, dates, fees and payments',()=>{
  const data=isolated(`$before=membership_snapshot($db);$db->query('UPDATE plans SET plan=12 WHERE id=1');
    $result=new_membership_for_test($db,['rid'=>'9','plan_months'=>'999','csrf_token'=>'duration'],'renew_membership');
    $after=membership_snapshot($db);echo json_encode(compact('before','result','after'));`);
  assert.equal(data.result.status,200);assert.equal(Number(data.after.memberships.at(-1).plan_months),12);
  const old=data.after.memberships.slice(0,2);old[1].status=data.before.memberships[1].status;
  assert.deepEqual(old,data.before.memberships);assert.deepEqual(data.after.payments,data.before.payments);
});

test('migration leaves original duration unknown and preserves existing fields on repeat import',()=>{
  const data=isolated(`$db->query('ALTER TABLE registration_info DROP COLUMN plan_months');$before=membership_snapshot($db);
    $db->query(file_get_contents('tests/fixtures/legacy-schema/010_membership_duration_snapshots.sql'));$legacy=membership_snapshot($db);
    $db->query('UPDATE plans SET plan=12 WHERE id=1');
    $row=membership_read_records($db,null,9)[0];$state=membership_read_state($row);
    $view=render_membership_read_page($db,'view_pdetails.php',['id'=>9]);
    [$saved,$id]=subscribe($db,9);$first=membership_snapshot($db);
    $db->query(file_get_contents('tests/fixtures/legacy-schema/010_membership_duration_snapshots.sql'));$after=membership_snapshot($db);
    echo json_encode(compact('before','legacy','row','state','view','saved','first','after'));`);
  assert.ok(data.legacy.memberships.every(row=>row.plan_months===null));
  assert.deepEqual(data.legacy.memberships.map(({plan_months,...row})=>row),data.before.memberships);
  assert.deepEqual(data.legacy.payments,data.before.payments);assert.equal(data.row.plan,null);
  assert.equal(data.state.can_renew,true);assert.equal(data.state.can_pay,true);
  assert.match(data.view,/Original duration not recorded; see start\/end dates/);
  assert.equal(data.saved.result,1);assert.deepEqual(data.after,data.first);
});

test('unknown legacy duration does not prevent renewal at the current catalog duration',()=>{
  const data=isolated(`$db->query('UPDATE registration_info SET plan_months=NULL WHERE id=9');
    $before=membership_snapshot($db);$result=new_membership_for_test($db,['rid'=>'9','csrf_token'=>'duration'],'renew_membership');
    $after=membership_snapshot($db);echo json_encode(compact('before','result','after'));`);
  assert.equal(data.result.status,200);assert.equal(data.after.memberships[1].plan_months,null);
  assert.equal(Number(data.after.memberships.at(-1).plan_months),3);
  assert.deepEqual(data.after.payments,data.before.payments);
});

for(const [label,setup,expected] of [
  ['unknown legacy duration','UPDATE registration_info SET plan_months=NULL WHERE id=9','Original duration not recorded; see start/end dates'],
  ['recorded duration despite catalog edits','UPDATE plans SET plan=12 WHERE id=1','3 month(s)'],
  ['missing plan','DELETE FROM plans WHERE id=1','Plan missing (ID 1)'],
]){
  test(`member history consistently labels ${label} without changing membership or payments`,()=>{
    const data=isolated(`$db->query('${setup}');$before=membership_snapshot($db);
      $view=render_membership_read_page($db,'view_member.php',['id'=>'10']);
      $details=render_membership_read_page($db,'view_pdetails.php',['id'=>'9']);
      $list=render_membership_read_page($db,'registered_members.php');
      $after=membership_snapshot($db);echo json_encode(compact('view','details','list','before','after'));`);
    for(const html of [data.view,data.details,data.list])assert.ok(html.includes(expected));
    assert.doesNotMatch(data.view,/0 month\(s\)|Warning|Fatal error/);
    assert.deepEqual(data.after,data.before);
  });
}

test('invalid current catalog duration cannot change existing membership state or enable a new registration',()=>{
  const data=isolated(`$before=membership_read_records($db,null,9)[0];$db->query('UPDATE plans SET plan=0 WHERE id=1');
    $after=membership_read_records($db,null,9)[0];$state=membership_read_state($after);
    $snapshot=membership_snapshot($db);[$result,$id]=subscribe($db,9);$afterWrite=membership_snapshot($db);
    echo json_encode(compact('before','after','state','snapshot','result','afterWrite'));`);
  assert.deepEqual(data.after,data.before);assert.equal(data.state.label,'Expired');
  assert.equal(data.result.status,400);assert.deepEqual(data.afterWrite,data.snapshot);
});
