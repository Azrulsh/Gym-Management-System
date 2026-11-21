import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {literal} from './helpers/php.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const php=process.env.GYM_TEST_PHP||(process.platform==='win32'?'C:/xampp/php/php.exe':'php');
const gdProbe=spawnSync(php,['-r',"echo extension_loaded('gd') ? '1' : '0';"],{encoding:'utf8'});
const gdArgs=gdProbe.stdout==='1'?[]:['-d','extension=gd'];
const schema='gym_settings_test_'+randomBytes(8).toString('hex');
let folder,server,base,log='',png,largePng,jpeg;
const admin=new Map(),staff=new Map();
function phpRun(source){const r=spawnSync(php,[...gdArgs,'-r',source],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(r.stderr,'');return r.stdout;}
function sql(source){return phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'',${literal(schema)});${source}`);}
const snapshot=()=>JSON.parse(sql("echo json_encode($db->query('SELECT * FROM system_settings')->fetch_assoc());"));
function storageFiles(){const directory=path.join(folder,'branding');return fs.existsSync(directory)?fs.readdirSync(directory).sort():[];}
async function request(url,options={},cookies=admin){const headers=new Headers(options.headers);if(cookies.size)headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));const r=await fetch(base+url,{...options,headers,redirect:'manual'});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}return r;}
async function login(user,cookies){const page=await request('login.php',{},cookies);const token=(await page.text()).match(/name="csrf_token" value="([a-f0-9]+)"/)[1];const r=await request('ajax.php?action=login',{method:'POST',body:new URLSearchParams({csrf_token:token,username:user,password:user})},cookies);assert.equal(await r.text(),'1');}
async function form(values={},files={},cookies=admin){const page=await request('settings.php',{},cookies);assert.equal(page.status,200);const html=await page.text();const token=html.match(/name="csrf_token" value="([a-f0-9]+)"/)[1];const version=html.match(/name="version" value="(\d+)"/)[1];const data=new FormData();for(const [k,v] of Object.entries({csrf_token:token,version,gym_name:'HTTP Demo Gym',email:'contact@example.test',contact:'+60 3-0000 0000',address:'Demo address',about:'Demo about',...values}))data.set(k,v);for(const [key,file] of Object.entries(files))data.set(key,new Blob([file.bytes],{type:file.type||'image/png'}),file.name||'demo.png');return data;}
async function save(values={},files={}){return request('ajax.php?action=save_settings',{method:'POST',body:await form(values,files)});}

before(async()=>{
 folder=fs.mkdtempSync(path.join(os.tmpdir(),'gym-settings-'));
 const app=path.join(folder,'app');fs.mkdirSync(app);for(const sub of ['sessions','uploads'])fs.mkdirSync(path.join(folder,sub));
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.php')))fs.copyFileSync(path.join(root,file),path.join(app,file));
 const required=new Set(['assets/img/gym-logo.svg','assets/img/img.jpg']);
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.php'))){const source=fs.readFileSync(path.join(root,file),'utf8');for(const match of source.matchAll(/filemtime\(__DIR__ \. '([^']+)'\)/g))required.add(match[1].replace(/^\//,''));}
 for(const relative of required){fs.mkdirSync(path.dirname(path.join(app,relative)),{recursive:true});fs.copyFileSync(path.join(root,relative),path.join(app,relative));}
 fs.writeFileSync(path.join(app,'db_connect.php'),`<?php require_once __DIR__.'/app_config.php';mysqli_report(MYSQLI_REPORT_ERROR|MYSQLI_REPORT_STRICT);$conn=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'', '${schema}');configure_database_timezone($conn);`);
 fs.writeFileSync(path.join(app,'router.php'),`<?php $path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);if(str_starts_with($path,'/assets/')){$root=${literal(path.join(root,'assets'))};$file=realpath($root.substr($path,7));if(!$file||strpos($file,$root.DIRECTORY_SEPARATOR)!==0||!is_file($file)){http_response_code(404);return;}$types=['js'=>'application/javascript','css'=>'text/css','svg'=>'image/svg+xml','jpg'=>'image/jpeg','png'=>'image/png'];header('Content-Type: '.($types[pathinfo($file,PATHINFO_EXTENSION)]??'application/octet-stream'));readfile($file);return;}return false;`);
 phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'');$db->query('CREATE DATABASE ${schema}');$db->select_db('${schema}');$db->multi_query(file_get_contents('database/gym.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());`);
 png=Buffer.from(phpRun(`$image=imagecreatetruecolor(20,20);imagefill($image,0,0,imagecolorallocate($image,0,180,80));ob_start();imagepng($image);echo base64_encode(ob_get_clean());`),'base64');
 largePng=Buffer.from(phpRun(`$image=imagecreatetruecolor(1800,1200);imagefill($image,0,0,imagecolorallocate($image,0,180,80));ob_start();imagepng($image);echo base64_encode(ob_get_clean());`),'base64');
 jpeg=Buffer.from(phpRun(`$image=imagecreatetruecolor(20,20);ob_start();imagejpeg($image);echo base64_encode(ob_get_clean());`),'base64');
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/`;
 server=spawn(php,[...gdArgs,'-d','session.save_path='+path.join(folder,'sessions'),'-d','upload_tmp_dir='+path.join(folder,'uploads'),'-S','127.0.0.1:'+port,'-t',app,path.join(app,'router.php')],{cwd:app,env:{...process.env,GYM_BRANDING_STORAGE:path.join(folder,'branding')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{log+=b.toString()});server.stdout.on('data',b=>{log+=b.toString()});
 for(let i=0;i<100;i++){try{const r=await fetch(base+'login.php');if(r.status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 await login('admin',admin);await login('staff',staff);
}, {timeout:30000});

after(async()=>{
 if(server){server.kill();await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r);setTimeout(r,2000).unref()});}
 if(!/^gym_settings_test_[a-f0-9]{16}$/.test(schema))throw Error('Unsafe test schema');
 phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'');$db->query('DROP DATABASE IF EXISTS ${schema}');`);
 if(folder){assert.ok(folder.startsWith(path.join(os.tmpdir(),'gym-settings-')));fs.rmSync(folder,{recursive:true,force:true});}
 assert.doesNotMatch(log,/Fatal error|Warning:|Uncaught /);
});

test('anonymous/Staff cannot read Settings or write Settings through HTTP',async()=>{
 assert.equal((await request('settings.php',{},new Map())).status,302);
 for(const url of ['settings.php','index.php?page=settings'])assert.equal((await request(url,{},staff)).status,403);
 assert.equal((await request('ajax.php?action=save_settings',{method:'POST'},new Map())).status,401);
 assert.equal((await request('ajax.php?action=save_settings',{method:'POST'},staff)).status,403);
 assert.equal((await request('ajax.php?action=save_settings')).status,405);
});
test('CSRF rejection leaves branding and disk untouched',async()=>{
 const before=snapshot();const data=await form({csrf_token:'wrong'});const r=await request('ajax.php?action=save_settings',{method:'POST',body:data});assert.equal(r.status,403);assert.deepEqual(snapshot(),before);assert.deepEqual(storageFiles(),[]);
});
test('safe text branding reaches Login and another existing Staff session',async()=>{
 const r=await save({gym_name:"O'Neil <script>probe</script>",about:'About <img onerror=probe>'});assert.equal(r.status,200);assert.equal((await r.json()).saved,true);
 const page=await request('login.php',{},new Map());const html=await page.text();assert.match(html,/O&#039;Neil &lt;script&gt;probe&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>probe<\/script>|<img onerror=probe>/);
 const staffPage=await request('index.php?page=home',{},staff);assert.match(await staffPage.text(),/O&#039;Neil &lt;script&gt;probe&lt;\/script&gt;/);
});
test('real JPEG/PNG upload is decoded, resized and re-encoded without appended code',async()=>{
 const bytes=Buffer.concat([largePng,Buffer.from('<?php echo "unsafe-marker"; ?>')]);const r=await save({}, {logo:{bytes}});assert.equal(r.status,200);
 const saved=snapshot();assert.match(saved.logo_filename,/^[a-f0-9]{64}\.png$/);assert.equal(storageFiles().length,1);
 const response=await request('branding_image.php?kind=logo',{},new Map());assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'no-store');
 const image=Buffer.from(await response.arrayBuffer());assert.ok(!image.includes(Buffer.from('unsafe-marker')));
 assert.equal(image.readUInt32BE(16),512);assert.ok(image.readUInt32BE(20)<=512);
});
test('cover upload and image replacement remove only the obsolete image after commit',async()=>{
 const old=snapshot().logo_filename;const r=await save({}, {logo:{bytes:png},cover:{bytes:png}});assert.equal(r.status,200);const saved=snapshot();assert.notEqual(saved.logo_filename,old);assert.equal(storageFiles().length,2);assert.ok(!storageFiles().includes(old));
});
test('JPEG images are re-encoded and served with the JPEG MIME type',async()=>{
 const r=await save({}, {cover:{bytes:jpeg,name:'cover.jpg',type:'image/jpeg'}});assert.equal(r.status,200);assert.match(snapshot().cover_filename,/\.jpg$/);
 const response=await request('branding_image.php?kind=cover',{},new Map());assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(Buffer.from(await response.arrayBuffer()).readUInt16BE(0),0xffd8);
});
for(const [label,file,status] of [
 ['PHP file',{bytes:Buffer.from('<?php echo 1;?>'),name:'shell.php'},422],
 ['SVG disguised as PNG',{bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')},422],
 ['wrong extension with real PNG',{bytes:Buffer.alloc(0),name:'photo.png.php'},422],
 ['oversized image',{bytes:Buffer.alloc(2097153)},413],
 ['truncated PNG',{bytes:Buffer.from([137,80,78,71,13,10,26,10])},422],
])test(`reject ${label} without replacing the saved image`,async()=>{
 const before=snapshot(),files=storageFiles();const r=await save({}, {logo:file});assert.equal(r.status,status);assert.deepEqual(snapshot(),before);assert.deepEqual(storageFiles(),files);
});
test('failed second upload cleans up the first upload and preserves both old images',async()=>{
 const before=snapshot(),files=storageFiles();const r=await save({}, {logo:{bytes:png},cover:{bytes:Buffer.from('bad')}});assert.equal(r.status,422);assert.deepEqual(snapshot(),before);assert.deepEqual(storageFiles(),files);
});
test('stale image forms cannot overwrite newer changes or leave uploaded files',async()=>{
 const a=await form({}, {logo:{bytes:png}}),b=await form({}, {logo:{bytes:png}});
 assert.equal((await request('ajax.php?action=save_settings',{method:'POST',body:a})).status,200);const files=storageFiles();
 assert.equal((await request('ajax.php?action=save_settings',{method:'POST',body:b})).status,409);assert.deepEqual(storageFiles(),files);
});
test('database failure rolls back metadata and cleans newly uploaded files',async()=>{
 const before=snapshot(),files=storageFiles();sql(`$db->query("CREATE TRIGGER deny_settings BEFORE UPDATE ON system_settings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture failure'");`);
 try{const r=await save({}, {logo:{bytes:png}});assert.equal(r.status,503);assert.deepEqual(snapshot(),before);assert.deepEqual(storageFiles(),files);}finally{sql("$db->query('DROP TRIGGER deny_settings');");}
});
test('remove restores defaults and deletes stored branding; endpoint accepts only logo/cover',async()=>{
 assert.equal((await save({remove_logo:'1',remove_cover:'1'})).status,200);assert.equal(snapshot().logo_filename,null);assert.deepEqual(storageFiles(),[]);
 const r=await request('branding_image.php?kind=logo',{},new Map());assert.equal(r.headers.get('content-type'),'image/svg+xml');assert.match(await r.text(),/^<svg/);
 assert.equal((await request('branding_image.php?kind=../../db_connect.php',{},new Map())).status,400);
});

// Optional browser smoke handoff: the driver uses this isolated app/database,
// then writes settings-browser-result.tmp.json before teardown removes the fixture.
if(process.env.GYM_SETTINGS_BROWSER_AUDIT==='1')test('browser Settings smoke on isolated fixture',{timeout:130000},async()=>{
 const statePath=path.join(root,'settings-browser-session.tmp.json');
 const resultPath=path.join(root,'settings-browser-result.tmp.json');
 fs.writeFileSync(path.join(folder,'browser-logo.png'),largePng);
 fs.writeFileSync(statePath,JSON.stringify({base,file:path.join(folder,'browser-logo.png')}));
 try{
  for(let i=0;i<1200;i++){
   if(fs.existsSync(resultPath)){
    const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));
    assert.equal(result.error,undefined,JSON.stringify(result));
    assert.ok(result.checks.length>=5);
    return;
   }
   await new Promise(r=>setTimeout(r,100));
  }
  throw Error('Browser smoke driver did not return a result');
 }finally{for(const file of [statePath,resultPath])if(fs.existsSync(file))fs.unlinkSync(file);}
});
