import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

function isolated(code){return JSON.parse(run({login_id:2,login_type:1,csrf_token:'schedule-version'},`
 require 'tests/helpers/membership-read-db.php';
 with_membership_read_database(function($db,$schema){
  $db->query('CREATE TABLE schedules (id INT PRIMARY KEY AUTO_INCREMENT, member_id INT NOT NULL, dow TEXT NOT NULL, date_from DATE NOT NULL, date_to DATE NOT NULL, time_from TIME NOT NULL, time_to TIME NOT NULL) ENGINE=InnoDB');
  $db->query("INSERT INTO schedules VALUES (1,11,'1','2026-11-01','2026-11-30','09:00','10:00')");
  $db->query(file_get_contents('tests/fixtures/legacy-schema/015_schedule_versions.sql'));
  $post=['id'=>'1','version'=>'1','member_id'=>'11','dow'=>['1'],'date_from'=>'2026-11','date_to'=>'2026-11','time_from'=>'09:00','time_to'=>'10:00','csrf_token'=>'schedule-version'];
  ${code}
 });`).body);}

test('stale schedule form cannot undo newer time; reviewed edit works without changing history',()=>{
 const d=isolated(`$history=membership_snapshot($db);$stale=$post;
  $post['time_from']='11:00';$post['time_to']='12:00';$first=new_membership_for_test($db,$post,'save_schedule');
  $stale['dow']=['2'];$second=new_membership_for_test($db,$stale,'save_schedule');
  $afterStale=$db->query('SELECT * FROM schedules WHERE id=1')->fetch_assoc();
  $stale['version']='2';$stale['time_from']='11:00';$stale['time_to']='12:00';
  $reviewed=new_membership_for_test($db,$stale,'save_schedule');
  $after=$db->query('SELECT * FROM schedules WHERE id=1')->fetch_assoc();$historyAfter=membership_snapshot($db);
  echo json_encode(compact('first','second','afterStale','reviewed','after','history','historyAfter'));`);
 assert.equal(d.first.result,1);assert.equal(d.second.status,409);
 assert.match(JSON.parse(d.second.result).error,/Schedule has changed/);
 assert.equal(d.afterStale.time_from,'11:00:00');assert.equal(d.afterStale.dow,'1');assert.equal(Number(d.afterStale.version),2);
 assert.equal(d.reviewed.result,1);assert.equal(d.after.time_from,'11:00:00');assert.equal(d.after.dow,'2');
 assert.equal(Number(d.after.version),3);assert.deepEqual(d.historyAfter,d.history);
});

for(const version of [null,'','0','-1','1.5',true,['1'],'2147483648']){
 test(`invalid schedule version ${JSON.stringify(version)} changes nothing`,()=>{
  const d=isolated(`$before=$db->query('SELECT * FROM schedules')->fetch_all(MYSQLI_ASSOC);
   $post['version']=json_decode(${literal(JSON.stringify(version))},true);
   $result=new_membership_for_test($db,$post,'save_schedule');$after=$db->query('SELECT * FROM schedules')->fetch_all(MYSQLI_ASSOC);
   echo json_encode(compact('before','result','after'));`);
  assert.equal(d.result.status,400);assert.deepEqual(d.after,d.before);
 });
}

test('unchanged edit increments version; missing version is rejected; Add ignores supplied version',()=>{
 const d=isolated(`$same=new_membership_for_test($db,$post,'save_schedule');
  unset($post['version']);$missing=new_membership_for_test($db,$post,'save_schedule');
  $post['id']='';$post['version']=['invalid'];$post['dow']=['3'];$added=new_membership_for_test($db,$post,'save_schedule');
  $after=$db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
  echo json_encode(compact('same','missing','added','after'));`);
 assert.equal(d.same.result,1);assert.equal(d.missing.status,400);assert.equal(d.added.result,1);
 assert.equal(Number(d.after[0].version),2);assert.equal(Number(d.after[1].version),1);
});

test('migration is repeatable and Edit form carries current version',()=>{
 const d=isolated(`$db->query('UPDATE schedules SET version=7 WHERE id=1');
  $before=$db->query('SELECT * FROM schedules')->fetch_all(MYSQLI_ASSOC);$history=membership_snapshot($db);
  $sql=file_get_contents('tests/fixtures/legacy-schema/015_schedule_versions.sql');$db->query($sql);$db->query($sql);
  $GLOBALS['auth_connection']=$db;$html=render_membership_read_page($db,'manage_schedule.php',['id'=>'1']);
  $after=$db->query('SELECT * FROM schedules')->fetch_all(MYSQLI_ASSOC);$historyAfter=membership_snapshot($db);
  echo json_encode(compact('before','after','history','historyAfter','html'));`);
 assert.deepEqual(d.after,d.before);assert.deepEqual(d.historyAfter,d.history);
 assert.match(d.html,/name="version" value="7"/);
});

test('concurrent edits to the same schedule admit exactly one version',()=>{
 const d=isolated(`$db->begin_transaction();$db->query('SELECT id FROM members WHERE id=11 FOR UPDATE');$workers=[];
  foreach(['11:00','13:00'] as $time){
   $post['time_from']=$time;$post['time_to']=substr($time,0,2).':30';
   $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start();'
    .'require "tests/helpers/membership-db.php";require "admin_class.php";'
    .'$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db;'
    .'$_SESSION=["login_id"=>2,"login_type"=>1,"login_auth_version"=>1,"csrf_token"=>"schedule-version"];'
    .'echo json_encode(new_membership_for_test($db,'.var_export($post,true).',"save_schedule"));';
   $pipes=[];$process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
   if(!is_resource($process))throw new RuntimeException('Worker unavailable');fclose($pipes[0]);$workers[]=[$process,$pipes];
  }
  usleep(300000);$db->commit();$results=[];
  foreach($workers as [$process,$pipes]){
   $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
   if(proc_close($process)!==0||$err!=='')throw new RuntimeException($err);$results[]=json_decode($out,true);
  }
  $after=$db->query('SELECT * FROM schedules WHERE id=1')->fetch_assoc();echo json_encode(compact('results','after'));`);
 assert.deepEqual(d.results.map(r=>r.status).sort(),[200,409]);assert.equal(Number(d.after.version),2);
 const winner=d.results.findIndex(r=>r.status===200);
 assert.equal(d.after.time_from,['11:00:00','13:00:00'][winner]);
});
