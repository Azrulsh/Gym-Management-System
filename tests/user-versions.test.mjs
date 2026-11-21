import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

function isolated(code){return JSON.parse(run({login_id:2,login_type:1,csrf_token:'user-version'},`
 require 'tests/helpers/membership-read-db.php';
 with_membership_read_database(function($db,$schema){
  $GLOBALS['auth_connection']=$db;
  $post=['id'=>'3','version'=>'1','name'=>'Staff','username'=>'staff','type'=>'2','password'=>'','csrf_token'=>'user-version'];
  ${code}
 });`).body);}

test('stale Admin form cannot undo a role change; reviewed form succeeds',()=>{
 const d=isolated(`$history=membership_snapshot($db);$stale=$post;
  $post['type']='1';$first=new_membership_for_test($db,$post,'save_user');
  $stale['name']='Renamed';$second=new_membership_for_test($db,$stale,'save_user');
  $afterStale=$db->query('SELECT * FROM users WHERE id=3')->fetch_assoc();
  $stale['version']='2';$stale['type']='1';$reviewed=new_membership_for_test($db,$stale,'save_user');
  $after=$db->query('SELECT * FROM users WHERE id=3')->fetch_assoc();$historyAfter=membership_snapshot($db);
  echo json_encode(compact('first','second','afterStale','reviewed','after','history','historyAfter'));`);
 assert.equal(d.first.result,1);assert.equal(d.second.status,409);assert.equal(Number(d.afterStale.type),1);
 assert.equal(d.afterStale.name,'Staff');assert.equal(d.reviewed.result,1);assert.equal(d.after.name,'Renamed');
 assert.equal(Number(d.after.version),3);assert.equal(Number(d.after.auth_version),1);assert.deepEqual(d.historyAfter,d.history);
});

for(const firstMethod of ['save_user','save_account']){
 test(`${firstMethod} invalidates stale forms from both account edit paths`,()=>{
  const d=isolated(`$old=$db->query('SELECT * FROM users WHERE id=3')->fetch_assoc();
   ${firstMethod==='save_account'?"$_SESSION['login_id']=3;$_SESSION['login_type']=2;":""}
   $post['name']='Latest name';$first=new_membership_for_test($db,$post,'${firstMethod}');
   $_SESSION['login_id']=2;$_SESSION['login_type']=1;
   $post['name']='Stale admin';$admin=new_membership_for_test($db,$post,'save_user');
   $_SESSION['login_id']=3;$_SESSION['login_type']=2;
   $post['name']='Stale own';$own=new_membership_for_test($db,$post,'save_account');
   $after=$db->query('SELECT * FROM users WHERE id=3')->fetch_assoc();echo json_encode(compact('old','first','admin','own','after'));`);
  assert.equal(d.first.result,1);assert.equal(d.admin.status,409);assert.equal(d.own.status,409);
  assert.equal(d.after.name,'Latest name');assert.equal(Number(d.after.version),2);
  for(const field of ['password','type','auth_version'])assert.equal(d.after[field],d.old[field]);
 });
}

for(const method of ['save_user','save_account']){
 for(const version of [null,'','0','-1','1.5',true,['1'],'2147483648']){
  test(`${method} rejects invalid edit version ${JSON.stringify(version)}`,()=>{
   const d=isolated(`$before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    ${method==='save_account'?"$_SESSION['login_id']=3;$_SESSION['login_type']=2;":""}
    $post['version']=json_decode(${literal(JSON.stringify(version))},true);
    $result=new_membership_for_test($db,$post,'${method}');$after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    echo json_encode(compact('before','result','after'));`);
   assert.equal(d.result.status,400);assert.deepEqual(d.after,d.before);
  });
 }
 test(`${method} stale password edit changes neither hash nor authentication version`,()=>{
  const d=isolated(`$post['name']='Latest';$first=new_membership_for_test($db,$post,'save_user');
   $before=$db->query('SELECT * FROM users WHERE id=3')->fetch_assoc();
   ${method==='save_account'?"$_SESSION['login_id']=3;$_SESSION['login_type']=2;":""}
   $post['password']='new-password';$post['current_password']='staff';
   $result=new_membership_for_test($db,$post,'${method}');$after=$db->query('SELECT * FROM users WHERE id=3')->fetch_assoc();
   echo json_encode(compact('before','result','after'));`);
  assert.equal(d.result.status,409);assert.deepEqual(d.after,d.before);
 });
}

test('migration is repeatable and both forms carry the current edit version',()=>{
 const d=isolated(`$db->query('UPDATE users SET version=7 WHERE id=2');
  $before=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);$history=membership_snapshot($db);
  $sql=file_get_contents('tests/fixtures/legacy-schema/016_user_versions.sql');$db->query($sql);$db->query($sql);
  $admin=render_membership_read_page($db,'manage_user.php',['id'=>'2']);
  $own=render_membership_read_page($db,'manage_user.php',['id'=>'2','mtype'=>'own']);
  $after=$db->query('SELECT * FROM users ORDER BY id')->fetch_all(MYSQLI_ASSOC);$historyAfter=membership_snapshot($db);
  echo json_encode(compact('before','after','history','historyAfter','admin','own'));`);
 assert.deepEqual(d.after,d.before);assert.deepEqual(d.historyAfter,d.history);
 assert.match(d.admin,/name="version" value="7"/);assert.match(d.own,/name="version" value="7"/);
});

test('simultaneous Admin and own-account edits admit one version',()=>{
 const d=isolated(`$before=$db->query('SELECT * FROM users WHERE id=3')->fetch_assoc();
  $db->begin_transaction();$db->query('SELECT id FROM users WHERE id=3 FOR UPDATE');$workers=[];
  foreach(['save_user','save_account'] as $method){
   $post['name']=$method;$actor=$method==='save_user'?2:3;$role=$method==='save_user'?1:2;
   $source='session_set_save_handler(function(){return true;},function(){return true;},function(){return "";},function(){return true;},function(){return true;},function(){return 0;});session_start();'
    .'require "tests/helpers/membership-db.php";require "admin_class.php";'
    .'$db=throttle_test_connection('.var_export($schema,true).');$GLOBALS["auth_connection"]=$db;'
    .'$_SESSION=["login_id"=>'.$actor.',"login_type"=>'.$role.',"login_auth_version"=>1,"csrf_token"=>"user-version"];'
    .'echo json_encode(new_membership_for_test($db,'.var_export($post,true).','.var_export($method,true).'));';
   $pipes=[];$process=proc_open([PHP_BINARY,'-r',$source],[['pipe','r'],['pipe','w'],['pipe','w']],$pipes);
   if(!is_resource($process))throw new RuntimeException('Worker unavailable');fclose($pipes[0]);$workers[]=[$process,$pipes];
  }
  usleep(300000);$db->commit();$results=[];
  foreach($workers as [$process,$pipes]){
   $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
   if(proc_close($process)!==0||$err!=='')throw new RuntimeException($err);$results[]=json_decode($out,true);
  }
  $after=$db->query('SELECT * FROM users WHERE id=3')->fetch_assoc();echo json_encode(compact('before','results','after'));`);
 assert.deepEqual(d.results.map(r=>r.status).sort(),[200,409]);assert.equal(Number(d.after.version),2);
 assert.equal(d.after.name,['save_user','save_account'][d.results.findIndex(r=>r.status===200)]);
 for(const field of ['password','type','auth_version'])assert.equal(d.after[field],d.before[field]);
});

test('both edit paths reject a missing version while Add ignores supplied version',()=>{
 const d=isolated(`unset($post['version']);$admin=new_membership_for_test($db,$post,'save_user');
  $_SESSION['login_id']=3;$_SESSION['login_type']=2;$own=new_membership_for_test($db,$post,'save_account');
  $_SESSION['login_id']=2;$_SESSION['login_type']=1;
  $db->query('ALTER TABLE users MODIFY id INT NOT NULL AUTO_INCREMENT');
  $post['id']='';$post['username']='new-account';$post['password']='new-password';$post['version']=['invalid'];
  $added=new_membership_for_test($db,$post,'save_user');
  $row=$db->query("SELECT version,auth_version FROM users WHERE username='new-account'")->fetch_assoc();
  echo json_encode(compact('admin','own','added','row'));`);
 assert.equal(d.admin.status,400);assert.equal(d.own.status,400);assert.equal(d.added.result,1);
 assert.equal(Number(d.row.version),1);assert.equal(Number(d.row.auth_version),1);
});
