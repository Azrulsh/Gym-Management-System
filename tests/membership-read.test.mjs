import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1, login_name: 'Test Admin', csrf_token: 'read-test-token' };
function isolated(code) {
  const response = run(session, `require 'tests/helpers/membership-read-db.php'; require 'membership_read.php';
    with_membership_read_database(function($db,$schema) { ${code} });`);
  return JSON.parse(response.body);
}

test('dashboard and list classify dates, closed history, missing references and duplicates consistently', () => {
  const data = isolated(`
    $db->query('INSERT INTO members (id,member_id) VALUES (12,10012),(13,10013),(14,10014),(15,10015),(16,10016),(17,10017)');
    $db->query('UPDATE registration_info SET start_date=CURDATE(),end_date=DATE_ADD(CURDATE(),INTERVAL 3 MONTH) WHERE id=9');
    $db->query("INSERT INTO registration_info VALUES
      (10,11,1,1,0,DATE_ADD(CURDATE(),INTERVAL 1 DAY),DATE_ADD(CURDATE(),INTERVAL 1 MONTH),1),
      (11,12,1,1,0,'2020-01-01','2020-04-01',1),
      (12,13,99,1,0,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 1 MONTH),1),
      (13,14,1,99,0,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 1 MONTH),1),
      (14,15,1,1,99,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 1 MONTH),1),
      (15,16,1,1,0,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 1 MONTH),0),
      (16,17,1,1,0,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 1 MONTH),1),
      (17,17,1,1,0,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 1 MONTH),1),
      (18,999,1,1,0,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 1 MONTH),1)");
    $before=membership_snapshot($db);
    $rows=membership_read_records($db);
    $states=[]; foreach($rows as $row) $states[$row['id']]=membership_read_state($row);
    $summary=membership_read_summary($db,$rows);
    $list=render_membership_read_page($db,'registered_members.php');
    $home=render_membership_read_page($db,'home.php');
    $after=membership_snapshot($db);
    echo json_encode(compact('states','summary','list','home','before','after'));
  `);
  assert.equal(data.summary.active_members, 1);
  assert.equal(data.summary.total_members, 9);
  assert.equal(data.summary.needs_attention, 6);
  for (const [id, label] of [[8, 'Closed'], [9, 'Active'], [10, 'Scheduled'], [11, 'Expired'], [12, 'Needs attention'], [13, 'Needs attention'], [14, 'Needs attention'], [15, 'Closed'], [16, 'Needs attention'], [17, 'Needs attention'], [18, 'Needs attention']]) {
    assert.equal(data.states[id].label, label);
    assert.match(data.list, new RegExp(`data-membership-id="${id}"`));
  }
  assert.match(data.home, /9 member profiles total/);
  assert.match(data.home, /6 open membership record\(s\) need attention/);
  assert.doesNotMatch(data.list + data.home, /Warning|Fatal error|Exprired/);
  assert.deepEqual(data.after, data.before, 'viewing must never change or clean up historical data');
});

test('orphaned membership stays visible, can be ended, releases dropdown and allows a new valid plan', () => {
  const data = isolated(`
    $db->query('DELETE FROM plans WHERE id=1');
    $db->query('DELETE FROM packages WHERE id=1');
    $db->query('INSERT INTO plans (id,plan,amount) VALUES (4,1,50)');
    $db->query("INSERT INTO packages (id,package,amount) VALUES (4,'New Package',10)");
    $before=membership_snapshot($db);
    $listBefore=render_membership_read_page($db,'registered_members.php');
    $detailsBefore=render_membership_read_page($db,'view_pdetails.php',['id'=>'9']);
    $historyBefore=render_membership_read_page($db,'view_member.php',['id'=>'10']);
    $paymentBefore=render_membership_read_page($db,'payment.php',['rid'=>'9']);
    $formBefore=render_membership_read_page($db,'manage_membership.php');
    $post=['member_id'=>'10','plan_id'=>'4','package_id'=>'4','trainer_id'=>'','csrf_token'=>$_SESSION['csrf_token']];
    $blocked=new_membership_for_test($db,$post);
    $ended=new_membership_for_test($db,['rid'=>'9','csrf_token'=>$_SESSION['csrf_token']],'end_membership');
    $detailsAfterEnd=render_membership_read_page($db,'view_pdetails.php',['id'=>'9']);
    $formAfterEnd=render_membership_read_page($db,'manage_membership.php');
    $created=new_membership_for_test($db,$post);
    $formAfterCreate=render_membership_read_page($db,'manage_membership.php');
    $rows=membership_read_records($db);
    $summary=membership_read_summary($db,$rows);
    $after=membership_snapshot($db);
    echo json_encode(compact('before','listBefore','detailsBefore','historyBefore','paymentBefore','formBefore','blocked','ended','detailsAfterEnd','formAfterEnd','created','formAfterCreate','summary','after'));
  `);
  assert.match(data.listBefore, /data-membership-id="9"/);
  assert.match(data.detailsBefore, /Plan missing \(ID 1\)/);
  assert.match(data.detailsBefore, /Package missing \(ID 1\)/);
  assert.match(data.detailsBefore, /Unavailable/);
  assert.match(data.detailsBefore, /end-membership"[^>]*data-registration-id="9"/);
  assert.doesNotMatch(data.detailsBefore, /mr-2 renew-membership/);
  assert.match(data.historyBefore, /Plan missing/);
  assert.match(data.paymentBefore, /Payment history is kept/);
  assert.match(data.paymentBefore, /200\.00/);
  assert.doesNotMatch(data.paymentBefore, /id="manage_payment"/);
  assert.doesNotMatch(data.formBefore, /<option value="10"/);
  assert.equal(data.blocked.status, 409);
  assert.equal(data.ended.result, 1);
  assert.match(data.detailsAfterEnd, /badge-secondary">Closed/);
  assert.doesNotMatch(data.detailsAfterEnd, /mr-2 end-membership|mr-2 renew-membership/);
  assert.match(data.formAfterEnd, /<option value="10"/);
  assert.equal(data.created.result, 1);
  assert.doesNotMatch(data.formAfterCreate, /<option value="10"/);
  assert.equal(data.summary.active_members, 1);
  assert.deepEqual(data.after.payments, data.before.payments);
  assert.equal(Number(data.after.memberships[1].status), 0);
  assert.equal(data.after.memberships.length, data.before.memberships.length + 1);
});

test('the empty member dropdown explains open records and becomes eligible only after all duplicates end', () => {
  const data = isolated(`
    $db->query("INSERT INTO registration_info VALUES
      (10,9,1,1,0,'2020-01-01','2020-04-01',1),
      (11,9,1,1,0,'2020-01-01','2020-04-01',1),
      (12,11,99,1,0,'2020-01-01','2020-04-01',1)");
    $empty=render_membership_read_page($db,'manage_membership.php');
    new_membership_for_test($db,['rid'=>'10','csrf_token'=>$_SESSION['csrf_token']],'end_membership');
    $afterOne=render_membership_read_page($db,'manage_membership.php');
    new_membership_for_test($db,['rid'=>'11','csrf_token'=>$_SESSION['csrf_token']],'end_membership');
    $afterAll=render_membership_read_page($db,'manage_membership.php');
    echo json_encode(compact('empty','afterOne','afterAll'));
  `);
  assert.match(data.empty, /No eligible members are available/);
  assert.match(data.empty, /Review Membership Validity/);
  assert.doesNotMatch(data.afterOne, /<option value="9"/);
  assert.match(data.afterAll, /<option value="9"/);
});

for (const [label, setup] of [
  ['missing member', 'DELETE FROM members WHERE id=10'],
  ['missing plan', 'DELETE FROM plans WHERE id=1'],
  ['missing package', 'DELETE FROM packages WHERE id=1'],
  ['missing trainer', 'DELETE FROM trainers WHERE id=2'],
]) {
  test(`${label} keeps payment history visible and backend refuses a new payment`, () => {
    const data = isolated(`
      $db->query(${literal(setup)});
      $before=membership_snapshot($db);
      $page=render_membership_read_page($db,'payment.php',['rid'=>'9']);
      $saved=new_membership_for_test($db,['registration_id'=>'9','amount'=>'10.25','remarks'=>"Member's payment",'csrf_token'=>$_SESSION['csrf_token']],'save_payment');
      $after=membership_snapshot($db);
      echo json_encode(compact('before','page','saved','after'));
    `);
    assert.match(data.page, /200\.00/);
    assert.match(data.page, /Payment history is kept/);
    assert.doesNotMatch(data.page, /id="manage_payment"|Warning|Fatal error/);
    assert.equal(data.saved.status, 409);
    assert.deepEqual(data.after, data.before);
  });
}

test('missing profiles do not disappear from list and can be ended without inventing a profile', () => {
  const data = isolated(`
    $db->query('DELETE FROM members WHERE id=10');
    $list=render_membership_read_page($db,'registered_members.php');
    $details=render_membership_read_page($db,'view_pdetails.php',['id'=>'9']);
    $ended=new_membership_for_test($db,['rid'=>'9','csrf_token'=>$_SESSION['csrf_token']],'end_membership');
    $summary=membership_read_summary($db,membership_read_records($db));
    echo json_encode(compact('list','details','ended','summary'));
  `);
  assert.match(data.list, /data-membership-id="9"/);
  assert.match(data.details, /Member profile missing/);
  assert.match(data.details, /end-membership"[^>]*data-registration-id="9"/);
  assert.equal(data.ended.result, 1);
  assert.equal(data.summary.total_members, 2);
});

test('renewable expiry and current dates use the same boundaries on dashboard and details', () => {
  const data = isolated(`
    $db->query('UPDATE registration_info SET start_date=DATE_SUB(CURDATE(),INTERVAL 1 MONTH),end_date=CURDATE() WHERE id=9');
    $row=membership_read_records($db,null,9)[0];
    $today=membership_read_state($row);
    $summary=membership_read_summary($db,membership_read_records($db));
    $db->query('UPDATE registration_info SET end_date=DATE_SUB(CURDATE(),INTERVAL 1 DAY) WHERE id=9');
    $expired=membership_read_state(membership_read_records($db,null,9)[0]);
    echo json_encode(compact('today','summary','expired'));
  `);
  assert.equal(data.today.label, 'Active');
  assert.equal(data.today.can_renew, false);
  assert.equal(data.summary.active_members, 1);
  assert.equal(data.expired.label, 'Expired');
  assert.equal(data.expired.can_renew, true);
});

test('malformed detail IDs fail before database access', () => {
  for (const page of ['view_pdetails.php','view_member.php']) {
    const response = run(session, `$_GET['id']='9 OR 1=1'; include ${literal(page)};`);
    assert.equal(response.status, 400);
    assert.doesNotMatch(response.body, /Warning|Fatal error|<script/);
  }
});

test('invalid date ranges are Needs attention and cannot be renewed through a direct request', () => {
  const data = isolated(`
    $db->query("UPDATE registration_info SET start_date='2026-11-01', end_date='2020-01-01' WHERE id=9");
    $row=membership_read_records($db,null,9)[0];
    $state=membership_read_state($row);
    $before=membership_snapshot($db);
    $renewed=new_membership_for_test($db,['rid'=>'9','csrf_token'=>$_SESSION['csrf_token']],'renew_membership');
    $after=membership_snapshot($db);
    echo json_encode(compact('state','before','renewed','after'));
  `);
  assert.equal(data.state.label, 'Needs attention');
  assert.equal(data.state.can_renew, false);
  assert.equal(data.renewed.status, 409);
  assert.deepEqual(data.after, data.before);
});
