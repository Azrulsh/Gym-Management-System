import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

function isolated(code){return JSON.parse(run({login_id:1,login_type:1,csrf_token:'attendance-test'},`
 require 'tests/helpers/throttle-db.php'; require 'attendance_service.php';
 with_throttle_database(function($db,$schema){
  $db->multi_query(file_get_contents('database/gym.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());
  $service=new AttendanceService($db);$repository=new AttendanceRepository($db);
  $post=['person_id'=>'1','identity_confirmed'=>'1','request_key'=>str_repeat('a',64)];
  $attempt=function($work){try{return ['ok'=>$work()];}catch(AttendanceRequestException $e){return ['status'=>$e->status,'error'=>$e->getMessage()];}};
  $checkout=function($id,$changes=[])use($service,$repository){return $service->checkOut(array_merge(['visit_id'=>(string)$id,'version'=>(string)$repository->visit($id)['version'],'request_key'=>str_repeat('b',64)],$changes),2,1);};
  ${code}
 });`).body);}

test('lookup uses member number and returns only identity, eligibility and open visit',()=>{
 const d=isolated(`echo json_encode(['active'=>$service->lookup(['tracking_id'=>'100001']),'inside'=>$service->lookup(['tracking_id'=>'100009']),'expired'=>$service->lookup(['tracking_id'=>'100002'])]);`);
 assert.equal(d.active.eligibility.allowed,true);assert.equal(Number(d.active.member.id),1);assert.equal(d.inside.open_visit.id,2);assert.equal(d.expired.eligibility.allowed,false);
 assert.deepEqual(Object.keys(d.active.member).sort(),['id','member_id','name']);assert.ok(!('password' in d.inside.open_visit));
});
for(const value of ['abc',"100001' OR 1=1",'0','-1','2147483648',[],null])test(`invalid lookup ${JSON.stringify(value)} is rejected`,()=>{
 const d=isolated(`echo json_encode($attempt(fn()=>$service->lookup(['tracking_id'=>json_decode(${literal(JSON.stringify(value))},true)])));`);assert.equal(d.status,422);
});
test('check-in captures staff, membership, server Malaysia time and audit; replay creates no duplicate',()=>{
 const d=isolated(`$before=date('Y-m-d H:i:s');$first=$service->checkIn($post,2,1);$again=$service->checkIn($post,2,1);$visit=$repository->visit($first['id']);echo json_encode(compact('before','first','again','visit')+['audit'=>$repository->rows('SELECT * FROM attendance_audit WHERE visit_id=?','i',[$first['id']])]);`);
 assert.equal(d.first.id,d.again.id);assert.equal(Number(d.visit.member_id),1);assert.equal(Number(d.visit.registration_id),1);assert.equal(Number(d.visit.checked_in_by),2);assert.ok(d.visit.checked_in_at>=d.before);assert.equal(d.audit.length,1);assert.equal(d.audit[0].action,'checkin');
});
test('second check-in is rejected and a database constraint also enforces one open visit',()=>{
 const d=isolated(`$id=$service->checkIn($post,2,1)['id'];$post['request_key']=str_repeat('c',64);$duplicate=$attempt(fn()=>$service->checkIn($post,1,1));$blocked=false;try{$db->query("INSERT INTO attendance_visits (member_id,registration_id,checked_in_by,updated_by,checkin_key) VALUES (1,1,2,2,REPEAT('d',64))");}catch(mysqli_sql_exception $e){$blocked=$e->getCode()===1062;}echo json_encode(compact('duplicate','blocked'));`);
 assert.equal(d.duplicate.status,409);assert.equal(d.blocked,true);
});
for(const member of [2,3,4,6])test(`member ${member} without a complete active membership cannot check in`,()=>{
 const d=isolated(`$post['person_id']='${member}';echo json_encode($attempt(fn()=>$service->checkIn($post,2,1)));`);assert.equal(d.status,409);
});
test('server rechecks membership after lookup and requires verified identity',()=>{
 const d=isolated(`$lookup=$service->lookup(['tracking_id'=>'100001']);$missing=$attempt(fn()=>$service->checkIn(array_merge($post,['identity_confirmed'=>'0']),2,1));$db->query('UPDATE registration_info SET status=0 WHERE id=1');$closed=$attempt(fn()=>$service->checkIn($post,2,1));echo json_encode(compact('missing','closed'));`);
 assert.equal(d.missing.status,422);assert.equal(d.closed.status,409);
});
test('checkout remains available after expiry/closure and replay does not add a second audit',()=>{
 const d=isolated(`$id=$service->checkIn($post,2,1)['id'];$db->query('UPDATE registration_info SET status=0 WHERE id=1');$first=$checkout($id);$again=$service->checkOut(['visit_id'=>(string)$id,'version'=>'1','request_key'=>str_repeat('b',64)],2,1);echo json_encode(['first'=>$first,'again'=>$again,'visit'=>$repository->visit($id),'audit'=>$repository->rows('SELECT action FROM attendance_audit WHERE visit_id=?','i',[$id])]);`);
 assert.equal(d.first.saved,true);assert.equal(d.again.saved,true);assert.ok(d.visit.checked_out_at);assert.equal(d.visit.open_member_id,null);assert.equal(d.audit.length,2);
});
test('stale checkout cannot overwrite corrections; multiple closed visits per day are allowed',()=>{
 const d=isolated(`$id=$service->checkIn($post,2,1)['id'];$checkout($id);$stale=$attempt(fn()=>$service->checkOut(['visit_id'=>(string)$id,'version'=>'1','request_key'=>str_repeat('c',64)],1,1));$post['request_key']=str_repeat('d',64);$second=$service->checkIn($post,2,1);echo json_encode(compact('stale','second'));`);
 assert.equal(d.stale.status,409);assert.equal(d.second.saved,true);
});
test('role changes, changed auth version and Member role cannot write Attendance',()=>{
 const d=isolated(`$badVersion=$attempt(fn()=>$service->checkIn($post,2,9));$db->query('UPDATE users SET type=3 WHERE id=2');$member=$attempt(fn()=>$service->checkIn($post,2,1));echo json_encode(compact('badVersion','member'));`);assert.equal(d.badVersion.status,403);assert.equal(d.member.status,403);
});
test('Admin corrections require reason, preserve the original and reject stale edits',()=>{
 const d=isolated(`$before=$repository->visit(1);$edit=['visit_id'=>'1','version'=>'1','mode'=>'correct','reason'=>'Corrected entry from desk register','checked_in_at'=>str_replace(' ','T',$before['checked_in_at']),'checked_out_at'=>str_replace(' ','T',$before['checked_out_at'])];$staff=$attempt(fn()=>$service->correct($edit,2,1));$service->correct($edit,1,1);$stale=$attempt(fn()=>$service->correct($edit,1,1));echo json_encode(['staff'=>$staff,'stale'=>$stale,'audit'=>$repository->rows("SELECT * FROM attendance_audit WHERE visit_id=1 AND action='correction'")]);`);
 assert.equal(d.staff.status,403);assert.equal(d.stale.status,409);assert.equal(d.audit.length,1);assert.ok(d.audit[0].before_state);assert.match(d.audit[0].reason,/desk register/);
});
for(const [field,value]of [['reason','short'],['checked_in_at','2026-02-30T12:00:00'],['checked_in_at','2099-01-01T00:00:00'],['checked_out_at','1000-01-01T00:00:00']])test(`invalid Admin correction ${field} cannot change visit`,()=>{
 const d=isolated(`$before=$repository->visit(1);$edit=['visit_id'=>'1','version'=>'1','mode'=>'correct','reason'=>'Corrected from register','checked_in_at'=>str_replace(' ','T',$before['checked_in_at']),'checked_out_at'=>str_replace(' ','T',$before['checked_out_at'])];$edit[${literal(field)}]=${literal(value)};echo json_encode(['result'=>$attempt(fn()=>$service->correct($edit,1,1)),'before'=>$before,'after'=>$repository->visit(1)]);`);
 assert.equal(d.result.status,422);assert.deepEqual(d.before,d.after);
});
test('corrections cannot overlap another visit and voided records stay locked',()=>{
 const d=isolated(`$first=$repository->visit(1);$open=$repository->visit(2);$edit=['visit_id'=>'1','version'=>'1','mode'=>'correct','reason'=>'Corrected from register','checked_in_at'=>str_replace(' ','T',$first['checked_in_at']),'checked_out_at'=>str_replace(' ','T',date('Y-m-d H:i:s'))];$overlap=$attempt(fn()=>$service->correct($edit,1,1));$void=['visit_id'=>'2','version'=>'1','mode'=>'void','reason'=>'Duplicate entry confirmed at desk'];$service->correct($void,1,1);$locked=$attempt(fn()=>$service->correct(array_merge($void,['version'=>'2']),1,1));echo json_encode(compact('overlap','locked')+['visit'=>$repository->visit(2)]);`);
 assert.equal(d.overlap.status,409);assert.equal(d.locked.status,409);assert.ok(d.visit.voided_at);assert.equal(d.visit.open_member_id,null);
});
test('audit insert failure rolls back the new visit and its open slot',()=>{
 const d=isolated(`$db->query("CREATE TRIGGER deny_attendance BEFORE INSERT ON attendance_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture failure'");try{$service->checkIn($post,2,1);}catch(mysqli_sql_exception $e){}echo json_encode(['open'=>$repository->openVisit(1),'count'=>$repository->rows('SELECT COUNT(*) AS n FROM attendance_visits')[0]['n'],'transaction'=>$db->query('SELECT @@in_transaction AS n')->fetch_assoc()['n']]);`);
 assert.equal(d.open,null);assert.equal(Number(d.count),3);assert.equal(Number(d.transaction),0);
});
test('reimport additive schema preserves visits, audit and membership records',()=>{
 const d=isolated(`$before=$repository->rows('SELECT * FROM attendance_visits ORDER BY id');$db->multi_query(file_get_contents('database/add_attendance.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());echo json_encode(['before'=>$before,'after'=>$repository->rows('SELECT * FROM attendance_visits ORDER BY id')]);`);assert.deepEqual(d.before,d.after);
});
