import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

test('fresh demo has usable role logins, complete modern data and every documented scenario',()=>{
 const result=run({login_id:1,login_type:1,csrf_token:'demo'},`
 require 'tests/helpers/throttle-db.php';require 'passwords.php';require 'membership_read.php';
 with_throttle_database(function($db){
  $db->multi_query(file_get_contents('database/gym.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());
  $logins=[];foreach(['admin','staff','member','member_disabled'] as $name)$logins[$name]=throttle_test_login($db,$name,$name);
  $accounts=$db->query('SELECT u.username,p.member_id,p.enabled FROM users u JOIN member_portal_accounts p ON p.user_id=u.id ORDER BY u.id')->fetch_all(MYSQLI_ASSOC);
  $issues=[];foreach(membership_read_records($db) as $row)$issues=array_merge($issues,membership_read_state($row)['issues']);
  $invalid=$db->query("SELECT COUNT(*) FROM registration_info WHERE plan_months IS NULL OR plan_fee IS NULL OR package_fee IS NULL OR trainer_fee_snapshot IS NULL OR price_source<>'captured'")->fetch_row()[0];
  $unallocated=$db->query('SELECT COUNT(*) FROM payments WHERE plan_amount IS NULL OR request_key IS NULL OR plan_amount>amount OR plan_amount<0')->fetch_row()[0];
  $badHashes=0;foreach($db->query('SELECT password FROM users')->fetch_all(MYSQLI_ASSOC) as $u)if(!str_starts_with($u['password'],'$argon2id$'))$badHashes++;
  $eventConditions=$db->query("SELECT
   SUM(status='draft') AS draft,SUM(status='cancelled') AS cancelled,SUM(status='completed') AS completed,
   SUM(status='published' AND starts_at<=NOW() AND ends_at>NOW()) AS ongoing,
   SUM(status='published' AND ends_at<=NOW()) AS ended,
   SUM(status='published' AND starts_at>NOW() AND registration_closes_at<NOW()) AS deadline_closed,
   SUM(capacity IS NULL) AS unlimited FROM events")->fetch_assoc();
  $full=$db->query("SELECT COUNT(*) FROM events e WHERE e.status='published' AND e.starts_at>NOW() AND e.capacity=(SELECT COUNT(*) FROM event_registrations p WHERE p.event_id=e.id AND p.status IN ('registered','attended'))")->fetch_row()[0];
  $participants=$db->query('SELECT DISTINCT status FROM event_registrations ORDER BY status')->fetch_all(MYSQLI_ASSOC);
  $visits=$db->query('SELECT COUNT(*) AS total,SUM(open_member_id IS NOT NULL) AS inside,SUM(voided_at IS NOT NULL) AS voided FROM attendance_visits')->fetch_assoc();
  $own=$db->query('SELECT (SELECT COUNT(*) FROM payments p JOIN registration_info r ON r.id=p.registration_id WHERE r.member_id=7) AS payments,(SELECT COUNT(*) FROM schedules WHERE member_id=7) AS schedules,(SELECT COUNT(*) FROM attendance_visits WHERE member_id=7) AS visits,(SELECT COUNT(*) FROM event_registrations WHERE member_id=7) AS events')->fetch_assoc();
  echo json_encode(compact('logins','accounts','issues','invalid','unallocated','badHashes','eventConditions','full','participants','visits','own'));
 });`);
 const d=JSON.parse(result.body);
 assert.equal(d.logins.admin.result,1);assert.equal(d.logins.staff.result,1);assert.equal(d.logins.member.result,4);assert.equal(d.logins.member_disabled.authenticated,false);
 assert.deepEqual(d.accounts.map(a=>[a.username,Number(a.member_id),Number(a.enabled)]),[['member',7,1],['member_disabled',11,0]]);
 assert.deepEqual(d.issues,[]);assert.equal(Number(d.invalid),0);assert.equal(Number(d.unallocated),0);assert.equal(d.badHashes,0);
 for(const [name,count] of Object.entries(d.eventConditions))assert.ok(Number(count)>0,name);
 assert.equal(Number(d.full),1);assert.deepEqual(d.participants.map(p=>p.status).sort(),['attended','cancelled','no_show','registered']);
 assert.deepEqual(Object.fromEntries(Object.entries(d.visits).map(([k,v])=>[k,Number(v)])),{total:5,inside:1,voided:1});
 for(const [name,count] of Object.entries(d.own))assert.ok(Number(count)>0,'Member portal '+name);
});
