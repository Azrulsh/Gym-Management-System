import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

function isolated(code){return JSON.parse(run({login_id:2,login_type:1,csrf_token:'member-version'},`
 require 'tests/helpers/membership-read-db.php';
 with_membership_read_database(function($db){
  $old=$db->query('SELECT * FROM members WHERE id=9')->fetch_assoc();
  $post=$old;$post['version']=(string)$old['version'];$post['address']='Original address';$post['csrf_token']='member-version';
  ${code}
 });`).body);}

test('stale member form cannot undo newer contact; reviewed edit succeeds and history stays intact',()=>{
 const d=isolated(`$history=membership_snapshot($db);$stale=$post;
 $post['contact']='0199999999';$first=new_membership_for_test($db,$post,'save_member');
 $stale['address']='Changed address';$second=new_membership_for_test($db,$stale,'save_member');
 $afterStale=$db->query('SELECT * FROM members WHERE id=9')->fetch_assoc();
 $stale['version']=(string)$afterStale['version'];$stale['contact']=$afterStale['contact'];
 $reviewed=new_membership_for_test($db,$stale,'save_member');
 $after=$db->query('SELECT * FROM members WHERE id=9')->fetch_assoc();$historyAfter=membership_snapshot($db);
 echo json_encode(compact('first','second','afterStale','reviewed','after','history','historyAfter'));`);
 assert.equal(d.first.result,1);assert.equal(d.second.status,409);
 assert.match(JSON.parse(d.second.result).error,/Member has changed/);
 assert.equal(d.afterStale.contact,'0199999999');assert.equal(d.afterStale.address,'Original address');
 assert.equal(Number(d.afterStale.version),2);assert.equal(d.reviewed.result,1);
 assert.equal(d.after.contact,'0199999999');assert.equal(d.after.address,'Changed address');assert.equal(Number(d.after.version),3);
 assert.deepEqual(d.historyAfter,d.history);
});

for(const version of [null,'','0','-1','1.5',true,['1'],'2147483648']){
 test(`invalid member version ${JSON.stringify(version)} changes nothing`,()=>{
  const d=isolated(`$post['version']=json_decode(${literal(JSON.stringify(version))},true);
   $result=new_membership_for_test($db,$post,'save_member');$after=$db->query('SELECT * FROM members WHERE id=9')->fetch_assoc();
   echo json_encode(compact('old','result','after'));`);
  assert.equal(d.result.status,400);assert.deepEqual(d.after,d.old);
 });
}

test('member version migration is repeatable and preserves profiles and history',()=>{
 const d=isolated(`$before=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);$history=membership_snapshot($db);
 $sql=file_get_contents('database/migrations/014_member_versions.sql');$db->query($sql);$db->query($sql);
 $after=$db->query('SELECT * FROM members ORDER BY id')->fetch_all(MYSQLI_ASSOC);$historyAfter=membership_snapshot($db);
 echo json_encode(compact('before','after','history','historyAfter'));`);
 assert.deepEqual(d.after,d.before);assert.deepEqual(d.historyAfter,d.history);
});

test('Edit Member renders its version as a hidden field',()=>{
 const d=isolated(`$GLOBALS['auth_connection']=$db;$db->query('UPDATE members SET version=7 WHERE id=9');
 $html=render_membership_read_page($db,'manage_member.php',['id'=>'9']);echo json_encode(compact('html'));`);
 assert.match(d.html,/name="version" value="7"/);
});
