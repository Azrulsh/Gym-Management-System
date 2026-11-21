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
import {once} from 'node:events';

const root=fileURLToPath(new URL('../',import.meta.url));
const php=process.env.GYM_TEST_PHP||(process.platform==='win32'?'C:/xampp/php/php.exe':'php');
const gdArgs=[];
const schema='gym_events_test_'+randomBytes(8).toString('hex');
let folder,server,base,log='';
const admin=new Map(),staff=new Map();
function phpRun(source){const r=spawnSync(php,[...gdArgs,'-r',source],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(r.stderr,'');return r.stdout;}
function sql(source){return phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'',${literal(schema)});${source}`);}
async function request(url,options={},cookies=admin){const headers=new Headers(options.headers);if(cookies.size)headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));const r=await fetch(base+url,{...options,headers,redirect:'manual'});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}return r;}
async function login(user,cookies){const page=await request('login.php',{},cookies);const token=(await page.text()).match(/name="csrf_token" value="([a-f0-9]+)"/)[1];const r=await request('ajax.php?action=login',{method:'POST',body:new URLSearchParams({csrf_token:token,username:user,password:user})},cookies);assert.equal(await r.text(),'1');}
before(async()=>{
 folder=fs.mkdtempSync(path.join(os.tmpdir(),'gym-events-'));
 const app=path.join(folder,'app');fs.mkdirSync(app);for(const sub of ['sessions','uploads'])fs.mkdirSync(path.join(folder,sub));
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.php')))fs.copyFileSync(path.join(root,file),path.join(app,file));
 const required=new Set(['assets/img/gym-logo.svg','assets/img/img.jpg']);
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.php'))){const source=fs.readFileSync(path.join(root,file),'utf8');for(const match of source.matchAll(/filemtime\(__DIR__ \. '([^']+)'\)/g))required.add(match[1].replace(/^\//,''));}
 for(const relative of required){fs.mkdirSync(path.dirname(path.join(app,relative)),{recursive:true});fs.copyFileSync(path.join(root,relative),path.join(app,relative));}
 fs.writeFileSync(path.join(app,'db_connect.php'),`<?php require_once __DIR__.'/app_config.php';mysqli_report(MYSQLI_REPORT_ERROR|MYSQLI_REPORT_STRICT);$conn=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'', '${schema}');configure_database_timezone($conn);`);
 fs.writeFileSync(path.join(app,'router.php'),`<?php $path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);if(str_starts_with($path,'/assets/')){$root=${literal(path.join(root,'assets'))};$file=realpath($root.substr($path,7));if(!$file||strpos($file,$root.DIRECTORY_SEPARATOR)!==0||!is_file($file)){http_response_code(404);return;}$types=['js'=>'application/javascript','css'=>'text/css','svg'=>'image/svg+xml','jpg'=>'image/jpeg','png'=>'image/png'];header('Content-Type: '.($types[pathinfo($file,PATHINFO_EXTENSION)]??'application/octet-stream'));readfile($file);return;}return false;`);
 phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'');$db->query('CREATE DATABASE ${schema}');$db->select_db('${schema}');$db->multi_query(file_get_contents('database/gym.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());`);
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/`;
 server=spawn(php,[...gdArgs,'-d','session.save_path='+path.join(folder,'sessions'),'-d','upload_tmp_dir='+path.join(folder,'uploads'),'-S','127.0.0.1:'+port,'-t',app,path.join(app,'router.php')],{cwd:app,env:{...process.env,GYM_BRANDING_STORAGE:path.join(folder,'branding')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{log+=b.toString()});server.stdout.on('data',b=>{log+=b.toString()});
 for(let i=0;i<100;i++){try{const r=await fetch(base+'login.php');if(r.status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 await login('admin',admin);await login('staff',staff);
}, {timeout:30000});

after(async()=>{
 if(server){server.kill();await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r);setTimeout(r,2000).unref()});}
 if(!/^gym_events_test_[a-f0-9]{16}$/.test(schema))throw Error('Unsafe test schema');
 phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'');$db->query('DROP DATABASE IF EXISTS ${schema}');`);
 if(folder){assert.ok(folder.startsWith(path.join(os.tmpdir(),'gym-events-')));fs.rmSync(folder,{recursive:true,force:true});}
 assert.doesNotMatch(log,/Fatal error|Warning:|Uncaught /);
});

const eventRow=id=>JSON.parse(sql(`echo json_encode($db->query('SELECT * FROM events WHERE id='.(int)${id})->fetch_assoc());`));
async function token(cookies=admin){const r=await request('index.php?page=events',{},cookies);assert.equal(r.status,200);return (await r.text()).match(/name="csrf_token" value="([a-f0-9]+)"/)[1];}
async function write(action,values,cookies=admin){return request('ajax.php?action='+action,{method:'POST',body:new URLSearchParams({csrf_token:await token(cookies),...values})},cookies);}
function editor(id,changes={}){const e=eventRow(id);for(const k of ['starts_at','ends_at','registration_closes_at'])e[k]=e[k]===null?'':e[k].slice(0,16).replace(' ','T');return {...e,...changes};}

test('Events pages are shared; editor and event mutations remain Admin-only',async()=>{
 assert.equal((await request('events.php',{},new Map())).status,302);
 for(const url of ['index.php?page=events','index.php?page=view_event&id=1','events.php','view_event.php?id=1']){const r=await request(url,{},staff);assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/New Event|Edit Event/);}
 for(const url of ['manage_event.php','index.php?page=manage_event'])assert.equal((await request(url,{},staff)).status,403);
 for(const action of ['save_event','delete_event'])assert.equal((await write(action,{id:'1',version:'1'},staff)).status,403);
});
test('each Event mutation rejects GET and invalid CSRF',async()=>{
 for(const action of ['save_event','delete_event','save_event_participant']){
  assert.equal((await request('ajax.php?action='+action)).status,405);
  const r=await request('ajax.php?action='+action,{method:'POST',body:new URLSearchParams({csrf_token:'wrong'})});assert.equal(r.status,403);
 }
});
test('invalid and nonexistent IDs produce controlled pages, not SQL errors',async()=>{
 for(const page of ['manage_event','view_event'])for(const [id,status]of [['abc',422],['1 OR 1=1',422],['999999',404],['-1',422]]){
  const r=await request('index.php?page='+page+'&id='+encodeURIComponent(id));assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/Fatal error|Warning:|SELECT \*/);
 }
});
let createdId;
test('real event form creates safely and its request key prevents duplicates',async()=>{
 const page=await request('manage_event.php');const html=await page.text();const key=html.match(/name="request_key" value="([a-f0-9]+)"/)[1];
 const template=editor(1,{id:'',version:'',title:"O'Neil <script>probe</script>",description:'<img onerror=probe>',request_key:key});
 const first=await write('save_event',template);assert.equal(first.status,200);createdId=(await first.json()).id;
 const second=await write('save_event',template);assert.equal(second.status,200);assert.equal((await second.json()).id,createdId);
 for(const url of ['events.php','manage_event.php?id='+createdId,'view_event.php?id='+createdId]){
  const r=await request(url);assert.equal(r.status,200);const html=await r.text();assert.match(html,/O&#039;Neil &lt;script&gt;probe&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>probe<\/script>|<img onerror=probe>/);
 }
});
test('Staff can register/cancel/re-register; duplicate and stale forms fail with JSON',async()=>{
 const row=eventRow(createdId);
 let r=await write('save_event_participant',{id:createdId,version:row.version,member_id:'1',participant_status:'registered'},staff);assert.equal(r.status,200);
 r=await write('save_event_participant',{id:createdId,version:row.version,member_id:'5',participant_status:'registered'},staff);assert.equal(r.status,409);
 r=await write('save_event_participant',{id:createdId,version:eventRow(createdId).version,member_id:'1',participant_version:'1',participant_status:'registered'},staff);assert.equal(r.status,409);
 r=await write('save_event_participant',{id:createdId,version:eventRow(createdId).version,member_id:'1',participant_version:'1',participant_status:'cancelled'},staff);assert.equal(r.status,200);
 const view=await request('view_event.php?id='+createdId,{},staff);assert.match(await view.text(),/data-version="2"/);
 r=await write('save_event_participant',{id:createdId,version:eventRow(createdId).version,member_id:'1',participant_version:'2',participant_status:'registered'},staff);assert.equal(r.status,200);
});
test('stale edits, protected delete and capacity bounds leave saved event intact',async()=>{
 const old=editor(createdId);assert.equal((await write('save_event',{...old,title:'Updated title'})).status,200);
 assert.equal((await write('save_event',{...old,title:'Stale title'})).status,409);assert.equal(eventRow(createdId).title,'Updated title');
 assert.equal((await write('save_event',editor(createdId,{capacity:'-1'}))).status,422);
 const r=await write('delete_event',{id:createdId,version:eventRow(createdId).version});assert.equal(r.status,409);assert.match((await r.json()).error,/Draft/);
});
test('two database connections cannot claim the final seat or create duplicate participants',async()=>{
 sql(`$db->query("UPDATE events SET capacity=1 WHERE id=2");$db->query("UPDATE events SET status='published' WHERE id=2");`);
 // The Draft seed is seven days away; keep both test members eligible on that date.
 const version=eventRow(2).version;
 async function child(actor,member){
  const source=`require ${literal(path.join(root,'events_service.php'))};$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'',${literal(schema)});configure_database_timezone($db);try{$result=(new EventsService($db))->participant(['id'=>'2','version'=>'${version}','member_id'=>'${member}','participant_status'=>'registered'],${actor},1);echo json_encode(['status'=>200]);}catch(EventRequestException $e){echo json_encode(['status'=>$e->status]);}`;
  const process=spawn(php,['-r',source],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';process.stdout.on('data',b=>output+=b);process.stderr.on('data',b=>error+=b);const [code]=await once(process,'exit');assert.equal(code,0,error+output);assert.equal(error,'');return JSON.parse(output);
 }
 const results=await Promise.all([child(1,1),child(2,5)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const count=Number(sql("echo $db->query('SELECT COUNT(*) AS n FROM event_registrations WHERE event_id=2')->fetch_assoc()['n'];"));assert.equal(count,1);
});
test('Delete Member explains event history protection without removing the profile',async()=>{
 // A member with event-only history exercises the FK branch beyond existing membership/schedule checks.
 sql(`$db->query("INSERT INTO event_registrations (event_id,member_id,status) VALUES (3,12,'cancelled')");`);
 const r=await request('ajax.php?action=delete_member',{method:'POST',body:new URLSearchParams({csrf_token:await token(),id:'12'})});assert.equal(r.status,409);assert.match((await r.json()).error,/event participation history/);
 assert.equal(Number(sql("echo $db->query('SELECT COUNT(*) AS n FROM members WHERE id=12')->fetch_assoc()['n'];")),1);
});
test('database failure is generic JSON and the participant transaction rolls back',async()=>{
 const before=eventRow(createdId);
 sql(`$db->query("CREATE TRIGGER deny_event BEFORE UPDATE ON events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='secret fixture failure'");`);
 try{
  const r=await write('save_event',editor(createdId,{title:'Should roll back'}));assert.equal(r.status,503);const body=await r.text();assert.doesNotMatch(body,/secret|SQLSTATE|SELECT|Fatal|Warning/);assert.deepEqual(eventRow(createdId),before);
 }finally{sql("$db->query('DROP TRIGGER deny_event');");}
});
test('missing Events table produces a controlled read failure without a partial form',async()=>{
 sql("$db->query('RENAME TABLE events TO events_unavailable');");
 try{for(const page of ['events.php','manage_event.php?id=1','view_event.php?id=1']){const r=await request(page);assert.equal(r.status,503);const html=await r.text();assert.match(html,/Unable to load Events/);assert.doesNotMatch(html,/<form|Fatal|Warning|SELECT/);}}
 finally{sql("$db->query('RENAME TABLE events_unavailable TO events');");}
});

if(process.env.GYM_EVENTS_BROWSER_AUDIT==='1')test('real browser Events smoke on isolated fixture',{timeout:60000},async()=>{
 const {eventsBrowserSmoke}=await import('./helpers/events-browser.mjs');
 const checks=await eventsBrowserSmoke(base,folder);assert.equal(checks.length,7);
});

