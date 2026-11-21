import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

function isolated(code){return JSON.parse(run({login_id:2,login_type:1,csrf_token:'version'},`
  require 'tests/helpers/membership-db.php';
  with_membership_database(function($db,$schema){
    $GLOBALS['auth_connection']=$db;
    $post=['id'=>'1','plan'=>'3','amount'=>'150.00','version'=>'1','csrf_token'=>'version'];
    ${code}
  });`).body);}

test('stale tab cannot overwrite the latest price and refreshed version permits a reviewed edit',()=>{
  const data=isolated(`$history=membership_snapshot($db);
    $first=new_membership_for_test($db,$post,'save_plan');
    $winner=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $post['plan']='6';$post['amount']='100.00';$stale=new_membership_for_test($db,$post,'save_plan');
    $afterStale=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $post['version']='2';$post['amount']='150.00';$reviewed=new_membership_for_test($db,$post,'save_plan');
    $after=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);$afterHistory=membership_snapshot($db);
    echo json_encode(compact('history','first','winner','stale','afterStale','reviewed','after','afterHistory'));`);
  assert.equal(data.first.result,1);assert.equal(data.stale.status,409);assert.deepEqual(data.afterStale,data.winner);
  assert.match(JSON.parse(data.stale.result).error,/Plan has changed/);
  assert.equal(data.reviewed.result,1);assert.equal(Number(data.after[0].version),3);
  assert.equal(data.after[0].amount,'150.00');assert.equal(Number(data.after[0].plan),6);
  assert.deepEqual(data.afterHistory,data.history);
});

for(const version of [null,'','0','-1','1.5',true,['1'],'2147483648']){
  test(`invalid edit version ${JSON.stringify(version)} cannot change a plan`,()=>{
    const data=isolated(`$post['version']=json_decode('${JSON.stringify(version)}',true);
      $before=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $result=new_membership_for_test($db,$post,'save_plan');$after=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      echo json_encode(compact('before','result','after'));`);
    assert.equal(data.result.status,400);assert.deepEqual(data.after,data.before);
  });
}

test('creation ignores a supplied version and a missing edit version is rejected',()=>{
  const data=isolated(`unset($post['version']);$missing=new_membership_for_test($db,$post,'save_plan');
    $post['id']='';$post['version']='999';$created=new_membership_for_test($db,$post,'save_plan');
    $row=$db->query('SELECT * FROM plans ORDER BY id DESC LIMIT 1')->fetch_assoc();echo json_encode(compact('missing','created','row'));`);
  assert.equal(data.missing.status,400);assert.equal(data.created.result,1);assert.equal(Number(data.row.version),1);
});

test('migration re-import preserves existing prices and already advanced versions',()=>{
  const data=isolated(`$before=$db->query('SELECT id,plan,amount FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query('ALTER TABLE plans DROP COLUMN version');
    $db->query(file_get_contents('tests/fixtures/legacy-schema/011_plan_versions.sql'));
    $prices=$db->query('SELECT id,plan,amount FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    new_membership_for_test($db,$post,'save_plan');$first=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    $db->query(file_get_contents('tests/fixtures/legacy-schema/011_plan_versions.sql'));$after=$db->query('SELECT * FROM plans ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('before','prices','first','after'));`);
  assert.deepEqual(data.prices,data.before);assert.deepEqual(data.after,data.first);assert.equal(Number(data.after[0].version),2);
});

test('simultaneous Plan edits with the same version admit one writer only',()=>{
  const data=isolated(`$db->begin_transaction();$db->query('SELECT id FROM plans WHERE id=1 FOR UPDATE');$workers=[];
    for($i=0;$i<3;$i++){
      $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start();'
        .'require "tests/helpers/membership-db.php";require "admin_class.php";'
        .'$_SESSION='.var_export($_SESSION,true).';$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db;'
        .'echo json_encode(new_membership_for_test($db,'.var_export($post,true).',"save_plan"));$db->close();';
      $process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
      if(!is_resource($process))throw new RuntimeException('Worker failed');fclose($pipes[0]);$workers[]=[$process,$pipes];
    }
    usleep(200000);$db->commit();$results=[];
    foreach($workers as [$process,$pipes]){
      $out=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
      if(proc_close($process)!==0||$error!=='')throw new RuntimeException($error);$results[]=json_decode($out,true);
    }
    $row=$db->query('SELECT * FROM plans WHERE id=1')->fetch_assoc();echo json_encode(compact('results','row'));`);
  assert.equal(data.results.filter(row=>row.result===1).length,1);
  assert.equal(data.results.filter(row=>row.status===409).length,2);
  assert.equal(Number(data.row.version),2);
});
