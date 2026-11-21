import assert from 'node:assert/strict';
import test from 'node:test';
import {run,literal} from './helpers/php.mjs';

const details={version:'1',gym_name:"O'Neil Fitness <Gym>",email:'hello@example.test',contact:'+60 3-0000 0000',address:'Demo address',about:'Plain text\n<script>example</script>'};
function isolated(code,options={}){
 return JSON.parse(run({login_id:2,login_type:1,csrf_token:'settings-test'},`
  require 'tests/helpers/throttle-db.php';require 'settings_service.php';
  with_throttle_database(function($db){
   $db->multi_query(file_get_contents('database/add_system_settings.sql'));
   do {if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());
   $service=new SettingsService($db,new SettingsImages());
   $post=json_decode(${literal(JSON.stringify(details))},true);
   ${code}
  });`,options).body);
}

test('Settings persist all fields, escape at output and record the acting Admin',()=>{
 const d=isolated(`$saved=$service->save($post,[],2);echo json_encode(['saved'=>$saved,'escaped'=>settings_escape($saved['gym_name'])]);`);
 assert.equal(d.saved.gym_name,details.gym_name);assert.equal(d.saved.about,details.about);
 assert.equal(Number(d.saved.version),2);assert.equal(Number(d.saved.updated_by),2);
 assert.equal(d.escaped,'O&#039;Neil Fitness &lt;Gym&gt;');
});
test('stale Settings cannot overwrite a newer save',()=>{
 const d=isolated(`$service->save($post,[],2);$post['gym_name']='Stale';try{$service->save($post,[],2);}catch(SettingsRequestException $e){echo json_encode(['status'=>$e->status,'saved'=>system_settings_read($db)]);}`);
 assert.equal(d.status,409);assert.equal(d.saved.gym_name,details.gym_name);
});
test('unmodified saves increment version and additive install preserves Settings',()=>{
 const d=isolated(`$post=system_settings_read($db);$post['version']=(string)$post['version'];$first=$service->save($post,[],2);
 $db->multi_query(file_get_contents('database/add_system_settings.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());echo json_encode(['first'=>$first,'after'=>system_settings_read($db)]);`);
 assert.equal(Number(d.first.version),2);assert.deepEqual(d.first,d.after);
});
for(const [name,value] of [['gym_name',''],['gym_name','x'.repeat(101)],['gym_name',['array']],['gym_name','bad\nname'],['email','bad@'],['contact','javascript:bad'],['address','a'.repeat(1001)],['about','a'.repeat(3001)],['version','0'],['version',[]],['remove_logo',true]]){
 test(`invalid Settings ${name} ${JSON.stringify(value).slice(0,25)} leave the record untouched`,()=>{
  const d=isolated(`$before=system_settings_read($db);$post[${literal(name)}]=json_decode(${literal(JSON.stringify(value))},true);try{$service->save($post,[],2);}catch(SettingsRequestException $e){echo json_encode(['status'=>$e->status,'before'=>$before,'after'=>system_settings_read($db)]);}`);
  assert.equal(d.status,422);assert.deepEqual(d.before,d.after);
 });
}
test('role change during a Settings request is rechecked before writing',()=>{
 const d=isolated(`$before=system_settings_read($db);$db->query('UPDATE users SET type=2 WHERE id=2');try{$service->save($post,[],2);}catch(SettingsRequestException $e){echo json_encode(['status'=>$e->status,'before'=>$before,'after'=>system_settings_read($db)]);}`);
 assert.equal(d.status,403);assert.deepEqual(d.before,d.after);
});
test('failed Settings update rolls back its transaction',()=>{
 const d=isolated(`$before=system_settings_read($db);$db->query("CREATE TRIGGER deny_settings BEFORE UPDATE ON system_settings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'");try{$service->save($post,[],2);}catch(mysqli_sql_exception $e){echo json_encode(['before'=>$before,'after'=>system_settings_read($db),'transaction'=>$db->query('SELECT @@in_transaction AS n')->fetch_assoc()['n']]);}`);
 assert.deepEqual(d.before,d.after);assert.equal(Number(d.transaction),0);
});
test('public branding falls back safely when Settings are unavailable',()=>{
 const d=isolated(`$db->query('DROP TABLE system_settings');echo json_encode(system_settings_branding($db));`,{expectedStderr:/Branding unavailable \(code 1146\)/});
 assert.equal(d.gym_name,'Gym Management System');assert.equal(d.logo_filename,null);
});
test('singleton rejects additional records',()=>{
 const d=isolated(`try{$db->query("INSERT INTO system_settings (id,about) VALUES (2,'')");}catch(mysqli_sql_exception $e){echo json_encode(['rejected'=>true]);}`);
 assert.equal(d.rejected,true);
});
test('upload rejects forged local paths, array fields and oversized PHP uploads before any file write',()=>{
 const response=run({},`require 'settings_images.php';$images=new SettingsImages();$results=[];foreach([
  ['error'=>0,'tmp_name'=>__FILE__],['error'=>0,'tmp_name'=>[]],['error'=>UPLOAD_ERR_INI_SIZE],['error'=>UPLOAD_ERR_PARTIAL],['error'=>[]]
 ] as $file){try{$images->store($file,'logo');}catch(SettingsRequestException $e){$results[]=$e->status;}}echo json_encode($results);`);
 assert.deepEqual(JSON.parse(response.body),[422,422,413,422,422]);
});
test('image paths and storage refuse traversal and in-webroot configuration',()=>{
 const d=JSON.parse(run({},`require 'settings_images.php';$image=new SettingsImages();putenv('GYM_BRANDING_STORAGE='.getcwd().'/assets/uploads');$invalid=$image->path('../../db_connect.php');try{$image->directory(true);}catch(RuntimeException $e){echo json_encode(['invalid'=>$invalid,'refused'=>true]);}`).body);
 assert.equal(d.invalid,null);assert.equal(d.refused,true);
});
