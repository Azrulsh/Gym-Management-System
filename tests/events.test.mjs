import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

function isolated(code,options={}) {
 return JSON.parse(run({login_id:1,login_type:1,csrf_token:'events-test'},`
 require 'tests/helpers/throttle-db.php'; require 'events_service.php';
 with_throttle_database(function($db,$schema) {
  $db->multi_query(file_get_contents('database/gym.sql'));
  do {if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());
  $repository=new EventsRepository($db); $service=new EventsService($db);
  $post=['title'=>"O'Neil <script>event</script>",'description'=>"Plain text\n<script>example</script>",'location'=>'Main Studio',
   'starts_at'=>date('Y-m-d',strtotime('+1 day')).'T12:00','ends_at'=>date('Y-m-d',strtotime('+1 day')).'T14:00',
   'capacity'=>'2','status'=>'published','request_key'=>str_repeat('e',64)];
  $register=function($id,$member,$changes=[])use($repository,$service){return $service->participant(array_merge(['id'=>(string)$id,'version'=>(string)$repository->find($id)['version'],'member_id'=>(string)$member,'participant_status'=>'registered'],$changes),2,1);};
  $edit=function($id,$changes=[])use($repository){$e=$repository->find($id);foreach(['starts_at','ends_at','registration_closes_at'] as $f)$e[$f]=$e[$f]===null?'':str_replace(' ','T',substr($e[$f],0,16));foreach(['id','version','capacity']as$f)$e[$f]=$e[$f]===null?'':(string)$e[$f];return array_merge($e,$changes);};
  $attempt=function($work){try{return ['ok'=>$work()];}catch(EventRequestException $e){return ['status'=>$e->status,'error'=>$e->getMessage()];}};
  ${code}
 });`,options).body);
}

test('Events create safely, escape output, record actor and replay create without duplicates',()=>{
 const d=isolated(`$a=$service->save($post,1,1);$b=$service->save($post,1,1);echo json_encode(['a'=>$a,'b'=>$b,'event'=>$repository->find($a['id']),'escaped'=>event_escape($post['title']),'total'=>count($repository->listing())]);`);
 assert.equal(d.a.id,d.b.id);assert.equal(d.total,5);assert.equal(Number(d.event.created_by),1);
 assert.equal(d.event.title,"O'Neil <script>event</script>");assert.equal(d.escaped,'O&#039;Neil &lt;script&gt;event&lt;/script&gt;');
});
for(const [field,value] of [['title',''],['title','x'.repeat(151)],['title',[]],['location','bad\nlocation'],['description','a'.repeat(5001)],['capacity','-1'],['capacity','0'],['capacity','1.5'],['capacity',[]],['starts_at','2026-02-30T12:00'],['starts_at','abc'],['ends_at','1000-01-01T00:00'],['registration_closes_at','9999-01-01T00:00'],['status','invalid'],['status','completed'],['request_key','bad']]) {
 test(`invalid event ${field}: ${JSON.stringify(value).slice(0,25)} cannot write`,()=>{
  const d=isolated(`$post[${literal(field)}]=json_decode(${literal(JSON.stringify(value))},true);echo json_encode(['result'=>$attempt(fn()=>$service->save($post,1,1)),'count'=>count($repository->listing())]);`);
  assert.equal(d.result.status,422);assert.equal(d.count,4);
 });
}
test('unlimited capacity, optional deadline and stale edit conflict',()=>{
 const d=isolated(`$post['capacity']='';$id=$service->save($post,1,1)['id'];$a=$edit($id);$b=$a;$a['title']='New title';$service->save($a,1,1);echo json_encode(['result'=>$attempt(fn()=>$service->save($b,1,1)),'event'=>$repository->find($id)]);`);
 assert.equal(d.result.status,409);assert.equal(d.event.title,'New title');assert.equal(d.event.capacity,null);
});
test('Staff, demoted actor and changed auth version are denied inside write transaction',()=>{
 const d=isolated(`$a=$attempt(fn()=>$service->save($post,2,1));$b=$attempt(fn()=>$service->save($post,1,2));$db->query('UPDATE users SET type=2 WHERE id=1');$c=$attempt(fn()=>$service->save($post,1,1));echo json_encode([$a,$b,$c]);`);
 assert.deepEqual(d.map(x=>x.status),[403,403,403]);
});
test('capacity, duplicate membership, inactive membership and stale participant form are enforced',()=>{
 const d=isolated(`$id=$service->save($post,1,1)['id'];$register($id,1);$duplicate=$attempt(fn()=>$register($id,1,['participant_version'=>'1']));$inactive=$attempt(fn()=>$register($id,3));$register($id,5);$full=$attempt(fn()=>$register($id,7));$stale=$attempt(fn()=>$register($id,7,['version'=>'1']));echo json_encode(compact('duplicate','inactive','full','stale')+['counts'=>$repository->counts($id)]);`);
 assert.equal(d.duplicate.status,409);assert.equal(d.inactive.status,422);assert.equal(d.full.status,409);assert.equal(d.stale.status,409);assert.equal(Number(d.counts.occupied),2);
});
test('cancel frees a place, re-register keeps one history record and delete member is restricted',()=>{
 const d=isolated(`$id=$service->save($post,1,1)['id'];$register($id,1);$register($id,1,['participant_status'=>'cancelled','participant_version'=>'1']);$empty=$repository->counts($id);$register($id,1,['participant_version'=>'2']);$restricted=false;try{$db->query('DELETE FROM members WHERE id=1');}catch(mysqli_sql_exception $e){$restricted=$e->getCode()===1451;}echo json_encode(['empty'=>$empty,'counts'=>$repository->counts($id),'restricted'=>$restricted]);`);
 assert.equal(Number(d.empty.occupied),0);assert.equal(Number(d.counts.history),1);assert.equal(Number(d.counts.occupied),1);assert.equal(d.restricted,true);
});
test('capacity reduction and time change without confirmation preserve event',()=>{
 const d=isolated(`$id=$service->save($post,1,1)['id'];$register($id,1);$register($id,5);$small=$attempt(fn()=>$service->save($edit($id,['capacity'=>'1']),1,1));$move=$attempt(fn()=>$service->save($edit($id,['location'=>'Other']),1,1));$service->save($edit($id,['location'=>'Other','confirm_changes'=>'1']),1,1);echo json_encode(['small'=>$small,'move'=>$move,'event'=>$repository->find($id)]);`);
 assert.equal(d.small.status,409);assert.equal(d.move.status,422);assert.equal(d.event.location,'Other');
});
test('moving event cannot invalidate existing participant membership',()=>{
 const d=isolated(`$id=$service->save($post,1,1)['id'];$register($id,1);echo json_encode($attempt(fn()=>$service->save($edit($id,['starts_at'=>'2099-01-01T12:00','ends_at'=>'2099-01-01T14:00','confirm_changes'=>'1']),1,1)));`);
 assert.equal(d.status,409);assert.match(d.error,/membership/);
});
test('registration deadline, event cancellation and early attendance are enforced',()=>{
 const d=isolated(`$id=$service->save($post,1,1)['id'];$register($id,1);$early=$attempt(fn()=>$register($id,1,['participant_status'=>'attended','participant_version'=>'1']));$service->save($edit($id,['registration_closes_at'=>date('Y-m-d',strtotime('-1 day')).'T12:00']),1,1);$closed=$attempt(fn()=>$register($id,5));$service->save($edit($id,['status'=>'cancelled']),1,1);$cancelled=$attempt(fn()=>$register($id,1,['participant_status'=>'cancelled','participant_version'=>'1']));echo json_encode(compact('early','closed','cancelled')+['counts'=>$repository->counts($id)]);`);
 assert.equal(d.early.status,409);assert.equal(d.closed.status,409);assert.equal(d.cancelled.status,409);assert.equal(Number(d.counts.history),1);
});
test('only a Draft without participant history can be deleted',()=>{
 const d=isolated(`$published=$attempt(fn()=>$service->delete(['id'=>'1','version'=>'1'],1,1));$deleted=$service->delete(['id'=>'2','version'=>'1'],1,1);$missing=$attempt(fn()=>$service->delete(['id'=>'2','version'=>'1'],1,1));echo json_encode(compact('published','deleted','missing'));`);
 assert.equal(d.published.status,409);assert.equal(d.deleted.deleted,true);assert.equal(d.missing.status,404);
});
test('attendance supports completed events, corrections, and rejects unknown or cancelled participants',()=>{
 const d=isolated(`$register(3,9,['participant_status'=>'no_show','participant_version'=>'1']);$corrected=$register(3,9,['participant_status'=>'attended','participant_version'=>'2']);$unknown=$attempt(fn()=>$register(3,6,['participant_status'=>'attended']));$closed=$attempt(fn()=>$service->save($edit(3,['title'=>'Changed']),1,1));echo json_encode(compact('corrected','unknown','closed')+['participants'=>$repository->participants(3)]);`);
 assert.equal(d.corrected.saved,true);assert.equal(d.unknown.status,409);assert.equal(d.closed.status,409);assert.equal(d.participants[0].status,'attended');
});
test('started events lock details but can complete after end',()=>{
 const d=isolated(`$db->query("UPDATE events SET status='published' WHERE id=3");$changed=$attempt(fn()=>$service->save($edit(3,['location'=>'Other']),1,1));$done=$service->save($edit(3,['status'=>'completed']),1,1);echo json_encode(compact('changed','done')+['event'=>$repository->find(3)]);`);
 assert.equal(d.changed.status,409);assert.equal(d.done.saved,true);assert.equal(d.event.status,'completed');
});
test('participant insert failure rolls back both participant and event version',()=>{
 const d=isolated(`$id=$service->save($post,1,1)['id'];$before=$repository->find($id);$db->query("CREATE TRIGGER deny_event BEFORE UPDATE ON events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture failure'");try{$register($id,1);}catch(mysqli_sql_exception $e){}echo json_encode(['before'=>$before,'after'=>$repository->find($id),'counts'=>$repository->counts($id),'transaction'=>$db->query('SELECT @@in_transaction AS n')->fetch_assoc()['n']]);`);
 assert.deepEqual(d.before,d.after);assert.equal(Number(d.counts.history),0);assert.equal(Number(d.transaction),0);
});
test('additive install is repeatable and preserves all existing events and memberships',()=>{
 const d=isolated(`$before=$repository->listing();$db->multi_query(file_get_contents('database/add_events.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());echo json_encode(['before'=>$before,'after'=>$repository->listing(),'memberships'=>$db->query('SELECT COUNT(*) AS n FROM registration_info')->fetch_assoc()['n']]);`);
 assert.deepEqual(d.before,d.after);assert.equal(Number(d.memberships),13);
});
