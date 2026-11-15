import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

function isolated(kind,code){return JSON.parse(run({login_id:2,login_type:1,csrf_token:'catalog-version'},`
 require 'tests/helpers/membership-read-db.php';
 with_membership_read_database(function($db,$schema){
   $GLOBALS['auth_connection']=$db;
   $db->query("ALTER TABLE packages MODIFY id INT NOT NULL AUTO_INCREMENT, ADD description TEXT NOT NULL DEFAULT ''");
   $db->query("ALTER TABLE trainers MODIFY id INT NOT NULL AUTO_INCREMENT, ADD email VARCHAR(100) DEFAULT '', ADD contact VARCHAR(100) DEFAULT ''");
   $table='${kind==='package'?'packages':'trainers'}';$column='${kind==='package'?'amount':'rate'}';
   $post=${kind==='package'?"['id'=>'1','package'=>'Basic','description'=>'Original','amount'=>'30.00','version'=>'1','csrf_token'=>'catalog-version']":"['id'=>'2','name'=>'Trainer','email'=>'trainer@example.test','contact'=>'0123456789','rate'=>'60.00','version'=>'1','csrf_token'=>'catalog-version']"};
   function catalog_snapshot($db){return [
     $db->query('SELECT * FROM packages ORDER BY id')->fetch_all(MYSQLI_ASSOC),
     $db->query('SELECT * FROM trainers ORDER BY id')->fetch_all(MYSQLI_ASSOC)
   ];}
   ${code}
 });`).body);}

for(const kind of ['package','trainer']){
  test(`${kind}: stale form cannot revert latest price; reviewed edit succeeds without changing membership history`,()=>{
    const data=isolated(kind,`$history=membership_snapshot($db);$first=new_membership_for_test($db,$post,'save_${kind}');
      $winner=catalog_snapshot($db);$post[$column]='${kind==='package'?'20.00':'10.00'}';
      $post['${kind==='package'?'description':'contact'}']='${kind==='package'?'Changed description':'0199999999'}';
      $stale=new_membership_for_test($db,$post,'save_${kind}');$afterStale=catalog_snapshot($db);
      $post['version']='2';$post[$column]='${kind==='package'?'30.00':'60.00'}';
      $reviewed=new_membership_for_test($db,$post,'save_${kind}');$after=catalog_snapshot($db);$afterHistory=membership_snapshot($db);
      echo json_encode(compact('history','first','winner','stale','afterStale','reviewed','after','afterHistory'));`);
    assert.equal(data.first.result,1);assert.equal(data.stale.status,409);assert.deepEqual(data.afterStale,data.winner);
    assert.match(JSON.parse(data.stale.result).error,/has changed/);assert.equal(data.reviewed.result,1);
    const rows=data.after[kind==='package'?0:1];assert.equal(Number(rows[0].version),3);
    assert.equal(rows[0][kind==='package'?'amount':'rate'],kind==='package'?'30.00':'60.00');
    assert.deepEqual(data.afterHistory,data.history);
  });

  for(const version of [null,'','0','-1','1.5',true,['1'],'2147483648']){
    test(`${kind}: invalid edit version ${JSON.stringify(version)} changes nothing`,()=>{
      const data=isolated(kind,`$post['version']=json_decode('${JSON.stringify(version)}',true);$before=catalog_snapshot($db);
        $result=new_membership_for_test($db,$post,'save_${kind}');$after=catalog_snapshot($db);echo json_encode(compact('before','result','after'));`);
      assert.equal(data.result.status,400);assert.deepEqual(data.after,data.before);
    });
  }

  test(`${kind}: missing edit version is rejected while creation ignores supplied version`,()=>{
    const data=isolated(kind,`unset($post['version']);$missing=new_membership_for_test($db,$post,'save_${kind}');
      $post['id']='';$post['version']='999';$created=new_membership_for_test($db,$post,'save_${kind}');
      $row=$db->query('SELECT * FROM '.$table.' ORDER BY id DESC LIMIT 1')->fetch_assoc();echo json_encode(compact('missing','created','row'));`);
    assert.equal(data.missing.status,400);assert.equal(data.created.result,1);assert.equal(Number(data.row.version),1);
  });

  test(`${kind}: simultaneous edits admit exactly one version update`,()=>{
    const data=isolated(kind,`$db->begin_transaction();$db->query('SELECT id FROM '.$table.' WHERE id='.(int)$post['id'].' FOR UPDATE');$workers=[];
      for($i=0;$i<3;$i++){
        $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start();'
          .'require "tests/helpers/membership-db.php";require "admin_class.php";'
          .'$_SESSION='.var_export($_SESSION,true).';$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db;'
          .'echo json_encode(new_membership_for_test($db,'.var_export($post,true).',"save_${kind}"));$db->close();';
        $process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
        if(!is_resource($process))throw new RuntimeException('Worker failed');fclose($pipes[0]);$workers[]=[$process,$pipes];
      }
      usleep(200000);$db->commit();$results=[];
      foreach($workers as [$process,$pipes]){
        $out=stream_get_contents($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
        if(proc_close($process)!==0||$error!=='')throw new RuntimeException($error);$results[]=json_decode($out,true);
      }
      $row=$db->query('SELECT version FROM '.$table.' WHERE id='.(int)$post['id'])->fetch_assoc();echo json_encode(compact('results','row'));`);
    assert.equal(data.results.filter(row=>row.result===1).length,1);assert.equal(data.results.filter(row=>row.status===409).length,2);
    assert.equal(Number(data.row.version),2);
  });
}

test('migration preserves catalog details and advanced versions when re-imported',()=>{
  const data=isolated('package',`$db->query('ALTER TABLE packages DROP COLUMN version');$db->query('ALTER TABLE trainers DROP COLUMN version');
    $before=catalog_snapshot($db);$history=membership_snapshot($db);
    $migrate=function()use($db){$db->multi_query(file_get_contents('database/migrations/012_package_trainer_versions.sql'));
      do{if($result=$db->store_result())$result->free();}while($db->more_results()&&$db->next_result());};
    $migrate();$legacy=catalog_snapshot($db);new_membership_for_test($db,$post,'save_package');$first=catalog_snapshot($db);
    $migrate();$after=catalog_snapshot($db);$afterHistory=membership_snapshot($db);echo json_encode(compact('before','legacy','history','first','after','afterHistory'));`);
  assert.deepEqual(data.legacy.map(rows=>rows.map(({version,...row})=>row)),data.before);
  assert.deepEqual(data.after,data.first);assert.deepEqual(data.afterHistory,data.history);
});
