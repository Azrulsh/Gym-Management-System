import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

function isolated(code,options={}) {
 return JSON.parse(run({login_id:1,login_type:1,csrf_token:'portal-test'},`
 require 'tests/helpers/throttle-db.php'; require 'member_portal_service.php'; require 'events_service.php';
 with_throttle_database(function($db,$schema) {
  $db->multi_query(file_get_contents('database/gym.sql'));
  do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());
  // Activation tests start with unprovisioned profiles, independently of demo accounts.
  $db->query('DELETE FROM member_portal_accounts');$db->query('DELETE FROM member_portal_audit');
  $db->query('DELETE FROM users WHERE type=3');$db->query('ALTER TABLE users AUTO_INCREMENT=4');
  $service=new MemberPortalService($db);$sql=new EventsRepository($db);$repository=new MemberPortalRepository($db);
  $attempt=function($work){try{return ['ok'=>$work()];}catch(EventRequestException|SettingsRequestException $e){return ['status'=>$e->status,'error'=>$e->getMessage()];}};
  $invite=function($member,$purpose='activate')use($service){$link=$service->invite(['member_id'=>(string)$member,'purpose'=>$purpose],1,1);return explode('#token=',$link['activation_path'])[1];};
  $activate=function($member,$username)use($service,$invite){$token=$invite($member);$service->activate(['token'=>$token,'username'=>$username,'password'=>'A long unique passphrase!','password_confirm'=>'A long unique passphrase!'],'192.0.2.1');return ['token'=>$token,'user_id'=>(int)$GLOBALS['portal_test_db']->query("SELECT user_id FROM member_portal_accounts WHERE member_id=".(int)$member)->fetch_assoc()['user_id']];};
  $GLOBALS['portal_test_db']=$db;
  ${code}
 });`,options).body);
}

test('invitation activation links one user to one existing profile and stores only token hash',()=>{
 const d=isolated(`$a=$activate(1,'member_a');$account=$repository->account($a['user_id']);$tokens=$sql->rows('SELECT * FROM member_portal_tokens');echo json_encode(['a'=>$a,'account'=>$account,'tokens'=>$tokens,'replay'=>$attempt(fn()=>$service->activate(['token'=>$a['token'],'password'=>'A long unique passphrase!','password_confirm'=>'A long unique passphrase!'],'192.0.2.1'))]);`);
 assert.equal(Number(d.account.type),3);assert.equal(Number(d.account.user_id),4);assert.equal(Number(d.account.profile_id),1);assert.equal(Number(d.account.member_id),100001);
 assert.ok(d.account.password.startsWith('$argon2id$'));assert.notEqual(d.tokens[0].token_hash,d.a.token);assert.ok(d.tokens[0].used_at);assert.equal(d.replay.status,422);
});
test('reissuing invitation revokes the old token and expiration is enforced',()=>{
 const d=isolated(`$first=$invite(1);$second=$invite(1);$post=['password'=>'A long unique passphrase!','password_confirm'=>'A long unique passphrase!','username'=>'member_a'];$old=$attempt(fn()=>$service->activate($post+['token'=>$first],'192.0.2.1'));$db->query('UPDATE member_portal_tokens SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND)');$expired=$attempt(fn()=>$service->activate($post+['token'=>$second],'192.0.2.1'));echo json_encode(compact('old','expired'));`);
 assert.equal(d.old.status,422);assert.equal(d.expired.status,422);
});
test('Staff and stale or demoted Admin cannot issue portal links',()=>{
 const d=isolated(`echo json_encode([$attempt(fn()=>$service->invite(['member_id'=>'1'],2,1)),$attempt(fn()=>$service->invite(['member_id'=>'1'],1,999))]);`);
 assert.deepEqual(d.map(x=>x.status),[403,403]);
});
test('activated profiles cannot receive activation twice and duplicate usernames roll back',()=>{
 const d=isolated(`$activate(1,'member_a');$token=$invite(5);$result=$attempt(fn()=>$service->activate(['token'=>$token,'username'=>'admin','password'=>'A long unique passphrase!','password_confirm'=>'A long unique passphrase!'],'192.0.2.1'));echo json_encode(['result'=>$result,'invite'=>$attempt(fn()=>$invite(1)),'count'=>count($sql->rows('SELECT * FROM member_portal_accounts')),'used'=>$sql->rows('SELECT used_at FROM member_portal_tokens WHERE member_id=5')[0]['used_at']]);`);
 assert.equal(d.result.status,409);assert.equal(d.invite.status,409);assert.equal(d.count,1);assert.equal(d.used,null);
});
for(const [field,value] of [['username','a'],['username','admin\n'],['username',[]],['password','short'],['password_confirm','different']])test(`activation validates ${field} before creating an account`,()=>{
 const d=isolated(`$token=$invite(1);$post=['token'=>$token,'username'=>'member_a','password'=>'A long unique passphrase!','password_confirm'=>'A long unique passphrase!'];$post[${literal(field)}]=json_decode(${literal(JSON.stringify(value))},true);echo json_encode(['result'=>$attempt(fn()=>$service->activate($post,'192.0.2.1')),'accounts'=>count($sql->rows('SELECT * FROM member_portal_accounts'))]);`);
 assert.equal(d.result.status,422);assert.equal(d.accounts,0);
});
test('Member A repository reads cannot include Member B agreements, payments or schedules',()=>{
 const d=isolated(`$a=$activate(1,'member_a');$b=$activate(5,'member_b');echo json_encode(['a'=>$repository->account($a['user_id']),'memberships'=>$repository->memberships(1),'payments'=>$repository->payments(1),'schedules'=>$repository->schedules(1),'events'=>$repository->events(1)]);`);
 assert.ok(d.memberships.every(r=>Number(r.member_id)===1));assert.ok(d.payments.every(p=>Number(p.registration_id)===1));assert.ok(d.schedules.every(s=>Number(s.member_id)===1));assert.ok(d.events.every(e=>e.status!=='draft'));assert.ok(!d.events.some(e=>'member_name' in e));
});
test('profile updates accept only contact/address and reject stale profile versions',()=>{
 const d=isolated(`$a=$activate(1,'member_a');$before=$repository->account($a['user_id']);$post=['version'=>'1','contact'=>'0123456789','address'=>'New address','member_id'=>'5','type'=>'1','firstname'=>'Intruder','email'=>'intruder@example.test'];$service->profile($post,[],$a['user_id'],1);echo json_encode(['before'=>$before,'after'=>$repository->account($a['user_id']),'other'=>$db->query('SELECT * FROM members WHERE id=5')->fetch_assoc(),'stale'=>$attempt(fn()=>$service->profile($post,[],$a['user_id'],1))]);`);
 assert.equal(d.after.contact,'0123456789');assert.equal(d.after.firstname,d.before.firstname);assert.equal(d.after.email,d.before.email);assert.equal(Number(d.after.type),3);assert.notEqual(d.other.address,'New address');assert.equal(d.stale.status,409);
});
test('disabled accounts and stale auth versions cannot write and access changes revoke links',()=>{
 const d=isolated(`$a=$activate(1,'member_a');$invite(1,'reset');$service->setAccess(['member_id'=>'1','version'=>'1','enabled'=>'0'],1,1);$profile=$attempt(fn()=>$service->profile(['version'=>'1','contact'=>'0123456789','address'=>''],[],$a['user_id'],1));$account=$repository->account($a['user_id']);echo json_encode(['profile'=>$profile,'account'=>$account,'links'=>$sql->rows("SELECT revoked_at FROM member_portal_tokens WHERE purpose='reset'")]);`);
 assert.equal(d.profile.status,403);assert.equal(Number(d.account.enabled),0);assert.equal(Number(d.account.auth_version),2);assert.ok(d.links[0].revoked_at);
});
test('recovery replaces password, invalidates sessions and consumes its token',()=>{
 const d=isolated(`$a=$activate(1,'member_a');$token=$invite(1,'reset');$service->activate(['token'=>$token,'password'=>'Another long unique passphrase!','password_confirm'=>'Another long unique passphrase!'],'192.0.2.1');$account=$repository->account($a['user_id']);echo json_encode(['new'=>gym_password_verify('Another long unique passphrase!',$account['password']),'old'=>gym_password_verify('A long unique passphrase!',$account['password']),'account'=>$account]);`);
 assert.equal(d.new,true);assert.equal(d.old,false);assert.equal(Number(d.account.auth_version),2);assert.equal(d.account.username,'member_a');
});
test('password changes verify current password, invalidate old sessions and audit safely',()=>{
 const d=isolated(`$a=$activate(1,'member_a');$post=['password'=>'Another long unique passphrase!','password_confirm'=>'Another long unique passphrase!','current_password'=>'wrong'];$wrong=$attempt(fn()=>$service->changePassword($post,$a['user_id'],1,'192.0.2.1'));$post['current_password']='A long unique passphrase!';$done=$service->changePassword($post,$a['user_id'],1,'192.0.2.1');echo json_encode(['wrong'=>$wrong,'done'=>$done,'account'=>$repository->account($a['user_id']),'audit'=>$sql->rows('SELECT * FROM member_portal_audit')]);`);
 assert.equal(d.wrong.status,422);assert.equal(d.done.logout,true);assert.equal(Number(d.account.auth_version),2);assert.ok(d.audit.some(a=>a.action==='password_changed'));assert.ok(d.audit.every(a=>!('password' in a)&&!('token' in a)));
});
test('Member self registration ignores forged owner and cannot record attendance or join Draft',()=>{
 const d=isolated(`$a=$activate(1,'member_a');$events=new EventsService($db);$event=$sql->find(1);$events->participant(['id'=>'1','version'=>(string)$event['version'],'member_id'=>'5','participant_version'=>'1','participant_status'=>'cancelled'],$a['user_id'],1,true);$attend=$attempt(fn()=>$events->participant(['id'=>'1','version'=>'2','participant_status'=>'attended'],$a['user_id'],1,true));$draft=$attempt(fn()=>$events->participant(['id'=>'2','version'=>'1','participant_status'=>'registered'],$a['user_id'],1,true));echo json_encode(['attend'=>$attend,'draft'=>$draft,'participants'=>$sql->participants(1)]);`);
 assert.equal(d.attend.status,403);assert.equal(d.draft.status,409);assert.equal(d.participants.find(p=>Number(p.member_id)===1).status,'cancelled');assert.equal(d.participants.find(p=>Number(p.member_id)===5).status,'registered');
});
test('inactive membership still permits an account and historical reads',()=>{
 const d=isolated(`$a=$activate(2,'expired_member');echo json_encode(['account'=>$repository->account($a['user_id']),'memberships'=>$repository->memberships(2)]);`);
 assert.equal(Number(d.account.enabled),1);assert.ok(d.memberships.length>0);
});
test('failed activation rolls back user, portal link, token consumption and audit',()=>{
 const d=isolated(`$token=$invite(1);$db->query("CREATE TRIGGER deny_portal BEFORE INSERT ON member_portal_accounts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture failure'");try{$service->activate(['token'=>$token,'username'=>'member_a','password'=>'A long unique passphrase!','password_confirm'=>'A long unique passphrase!'],'192.0.2.1');}catch(mysqli_sql_exception $e){}echo json_encode(['users'=>count($sql->rows('SELECT * FROM users')),'links'=>count($sql->rows('SELECT * FROM member_portal_accounts')),'token'=>$sql->rows('SELECT used_at FROM member_portal_tokens')[0]['used_at']]);`);
 assert.equal(d.users,3);assert.equal(d.links,0);assert.equal(d.token,null);
});
test('Member profile foreign keys protect existing records and additive import is repeatable',()=>{
 const d=isolated(`$a=$activate(1,'member_a');$before=$repository->account($a['user_id']);$db->multi_query(file_get_contents('tests/fixtures/legacy-schema/add_member_portal.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());$blocked=false;try{$db->query('DELETE FROM members WHERE id=1');}catch(mysqli_sql_exception $e){$blocked=$e->getCode()===1451;}echo json_encode(['before'=>$before,'after'=>$repository->account($a['user_id']),'blocked'=>$blocked]);`);
 assert.deepEqual(d.before,d.after);assert.equal(d.blocked,true);
});

test('repeated invalid activation tokens and current passwords are throttled',()=>{
 const d=isolated(`$invalid=[];for($i=0;$i<6;$i++)$invalid[]=$attempt(fn()=>$service->activate(['token'=>str_repeat('f',64)],'192.0.2.99'))['status'];$a=$activate(1,'member_a');$wrong=[];for($i=0;$i<6;$i++)$wrong[]=$attempt(fn()=>$service->changePassword(['current_password'=>'wrong','password'=>'Another long passphrase!','password_confirm'=>'Another long passphrase!'],$a['user_id'],1,'192.0.2.99'))['status'];echo json_encode(compact('invalid','wrong'));`);
 assert.deepEqual(d.invalid,[422,422,422,422,422,429]);assert.deepEqual(d.wrong,[422,422,422,422,422,429]);
});
