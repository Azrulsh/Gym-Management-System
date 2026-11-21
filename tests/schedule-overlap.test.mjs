import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session={login_id:2,login_type:1,csrf_token:'overlap-test'};
const valid={version:'1',id:'',member_id:'11',date_from:'2026-11',date_to:'2026-11',time_from:'09:30',time_to:'10:30',dow:['1'],csrf_token:session.csrf_token};
function isolated(code) {
  return JSON.parse(run(session,`require 'tests/helpers/membership-db.php';
    with_membership_database(function($db,$schema){
      $db->query('CREATE TABLE schedules (id INT PRIMARY KEY AUTO_INCREMENT, member_id INT NOT NULL, dow TEXT NOT NULL, date_from DATE NOT NULL, date_to DATE NOT NULL, time_from TIME NOT NULL, time_to TIME NOT NULL, KEY member_id(member_id)) ENGINE=InnoDB');
      $db->query("INSERT INTO schedules VALUES (1,11,'1','2026-11-01','2026-11-30','09:00','10:00'),(2,10,'2','2026-11-01','2026-11-30','11:00','12:00')");
      $db->query(file_get_contents('tests/fixtures/legacy-schema/015_schedule_versions.sql'));
      ${code}
    });`).body);
}
for(const [label,changes] of [
  ['partial overlap',{}],
  ['identical schedule',{time_from:'09:00',time_to:'10:00'}],
  ['contained session',{time_from:'09:15',time_to:'09:45'}],
  ['containing session',{time_from:'08:00',time_to:'11:00'}],
  ['multiple weekdays with a shared Monday',{dow:['0','1','3']}],
  ['overlapping month ranges',{date_from:'2026-10',date_to:'2026-12'}],
  ['second precision overlap',{time_from:'09:59:59',time_to:'10:00:01'}],
  ['Edit moving another schedule to the conflicting member',{id:'2'}],
]) {
  test(`${label} is rejected with 409 and leaves all schedules and history intact`,()=>{
    const data=isolated(`$before=$db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $historyBefore=membership_snapshot($db);
      $result=new_membership_for_test($db,json_decode(${literal(JSON.stringify({...valid,...changes}))},true),'save_schedule');
      $after=$db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $historyAfter=membership_snapshot($db);echo json_encode(compact('before','after','historyBefore','historyAfter','result'));`);
    assert.equal(data.result.status,409);
    assert.match(JSON.parse(data.result.result).error,/overlapping schedule \(#1/);
    assert.deepEqual(data.after,data.before);assert.deepEqual(data.historyAfter,data.historyBefore);
  });
}
for(const [label,changes] of [
  ['session immediately after',{time_from:'10:00',time_to:'11:00'}],
  ['session immediately before',{time_from:'08:00',time_to:'09:00'}],
  ['different weekday',{dow:['2']}],
  ['different month',{date_from:'2026-12',date_to:'2026-12'}],
  ['different member',{member_id:'9'}],
  ['unchanged Edit of the same schedule',{id:'1',time_from:'09:00',time_to:'10:00'}],
  ['Edit changing time without a conflict',{id:'1',time_from:'10:00',time_to:'11:00'}],
  ['nonoverlapping seconds',{time_from:'10:00:01',time_to:'10:00:02'}],
]) {
  test(`${label} remains allowed`,()=>{
    const data=isolated(`$before=membership_snapshot($db);
      $result=new_membership_for_test($db,json_decode(${literal(JSON.stringify({...valid,...changes}))},true),'save_schedule');
      $after=membership_snapshot($db);echo json_encode(compact('before','after','result'));`);
    assert.equal(data.result.result,1);assert.deepEqual(data.before,data.after);
  });
}
for(const [date,expected] of [['2026-11-29',200],['2026-11-30',409]]) {
  test(`shared weekdays must actually occur in the overlapping legacy date range: ${date}`,()=>{
    const data=isolated(`$db->query("UPDATE schedules SET date_from='${date}',date_to='${date}' WHERE id=1");
      echo json_encode(new_membership_for_test($db,json_decode(${literal(JSON.stringify(valid))},true),'save_schedule'));`);
    assert.equal(data.status,expected);
  });
}
test('a conflict rolls back its transaction and a subsequent valid save succeeds',()=>{
  const data=isolated(`$post=json_decode(${literal(JSON.stringify(valid))},true);
    $first=new_membership_for_test($db,$post,'save_schedule');
    $post['time_from']='10:00';$post['time_to']='11:00';
    $second=new_membership_for_test($db,$post,'save_schedule');echo json_encode(compact('first','second'));`);
  assert.equal(data.first.status,409);assert.equal(data.second.result,1);
});
for(const edit of [false,true]) {
  test(`parallel Add and ${edit?'Edit':'Add'} for one member admit only one overlapping save`,()=>{
    const data=isolated(`
      $db->begin_transaction();$db->query('SELECT id FROM members WHERE id=9 FOR UPDATE');
      $workers=[];
      $posts=[
        ['id'=>'','member_id'=>'9','date_from'=>'2026-11','date_to'=>'2026-11','dow'=>['1'],'time_from'=>'09:00','time_to'=>'10:00','csrf_token'=>'overlap-test'],
        ['id'=>'${edit?'2':''}','version'=>'1','member_id'=>'9','date_from'=>'2026-11','date_to'=>'2026-11','dow'=>['1'],'time_from'=>'09:30','time_to'=>'10:30','csrf_token'=>'overlap-test']];
      foreach($posts as $post){
        $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;}); session_start(); '
          . 'require "tests/helpers/membership-db.php";require "admin_class.php"; '
          . '$_SESSION='.var_export($_SESSION,true).'; '
          . '$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db; '
          . 'echo json_encode(new_membership_for_test($db,'.var_export($post,true).',"save_schedule"));';
        $pipes=[];$process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Worker unavailable');
        fclose($pipes[0]);$workers[]=[$process,$pipes];
      }
      usleep(200000);$db->commit();$results=[];
      foreach($workers as [$process,$pipes]){
        $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        if(proc_close($process)!==0||$err!=='')throw new RuntimeException($err);
        $results[]=json_decode($out,true);
      }
      $rows=$db->query('SELECT * FROM schedules WHERE member_id=9')->fetch_all(MYSQLI_ASSOC);
      echo json_encode(compact('results','rows'));`);
    assert.deepEqual(data.results.map(result=>result.status).sort(),[200,409]);
    assert.equal(data.rows.length,1);
  });
}
