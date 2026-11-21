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
const schema='gym_attendance_test_'+randomBytes(8).toString('hex');
let folder,server,base,log='';
const admin=new Map(),staff=new Map();
function phpRun(source){const r=spawnSync(php,[...gdArgs,'-r',source],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(r.stderr,'');return r.stdout;}
function sql(source){return phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'',${literal(schema)});${source}`);}
async function request(url,options={},cookies=admin){const headers=new Headers(options.headers);if(cookies.size)headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));const r=await fetch(base+url,{...options,headers,redirect:'manual'});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}return r;}
async function login(user,cookies){const page=await request('login.php',{},cookies);const token=(await page.text()).match(/name="csrf_token" value="([a-f0-9]+)"/)[1];const r=await request('ajax.php?action=login',{method:'POST',body:new URLSearchParams({csrf_token:token,username:user,password:user})},cookies);assert.equal(await r.text(),'1');}
before(async()=>{
 folder=fs.mkdtempSync(path.join(os.tmpdir(),'gym-attendance-'));
 const app=path.join(folder,'app');fs.mkdirSync(app);for(const sub of ['sessions','uploads'])fs.mkdirSync(path.join(folder,sub));
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.php')))fs.copyFileSync(path.join(root,file),path.join(app,file));
 const required=new Set(['assets/img/gym-logo.svg','assets/img/img.jpg']);
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.php'))){const source=fs.readFileSync(path.join(root,file),'utf8');for(const match of source.matchAll(/filemtime\(__DIR__ \. '([^']+)'\)/g))required.add(match[1].replace(/^\//,''));}
 for(const relative of required){fs.mkdirSync(path.dirname(path.join(app,relative)),{recursive:true});fs.copyFileSync(path.join(root,relative),path.join(app,relative));}
 fs.writeFileSync(path.join(app,'db_connect.php'),`<?php require_once __DIR__.'/app_config.php';mysqli_report(MYSQLI_REPORT_ERROR|MYSQLI_REPORT_STRICT);$conn=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'', '${schema}');configure_database_timezone($conn);`);
 fs.writeFileSync(path.join(app,'router.php'),`<?php $path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);if($path==='/favicon.ico'){http_response_code(404);return;}if(str_starts_with($path,'/assets/')){$root=${literal(path.join(root,'assets'))};$file=realpath($root.substr($path,7));if(!$file||strpos($file,$root.DIRECTORY_SEPARATOR)!==0||!is_file($file)){http_response_code(404);return;}$types=['js'=>'application/javascript','css'=>'text/css','svg'=>'image/svg+xml','jpg'=>'image/jpeg','png'=>'image/png'];header('Content-Type: '.($types[pathinfo($file,PATHINFO_EXTENSION)]??'application/octet-stream'));readfile($file);return;}return false;`);
 phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'');$db->query('CREATE DATABASE ${schema}');$db->select_db('${schema}');$db->multi_query(file_get_contents('database/gym.sql'));do{if($r=$db->store_result())$r->free();}while($db->more_results()&&$db->next_result());`);
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}/`;
 server=spawn(php,[...gdArgs,'-d','session.save_path='+path.join(folder,'sessions'),'-d','upload_tmp_dir='+path.join(folder,'uploads'),'-S','127.0.0.1:'+port,'-t',app,path.join(app,'router.php')],{cwd:app,env:{...process.env,GYM_BRANDING_STORAGE:path.join(folder,'branding'),GYM_MEMBER_AVATAR_STORAGE:path.join(folder,'avatars')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 server.stderr.on('data',b=>{log+=b.toString()});server.stdout.on('data',b=>{log+=b.toString()});
 for(let i=0;i<100;i++){try{const r=await fetch(base+'login.php');if(r.status===200)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 await login('admin',admin);await login('staff',staff);
}, {timeout:30000});

after(async()=>{
 if(server){server.kill();await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r);setTimeout(r,2000).unref()});}
 if(!/^gym_attendance_test_[a-f0-9]{16}$/.test(schema))throw Error('Unsafe test schema');
 phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'');$db->query('DROP DATABASE IF EXISTS ${schema}');`);
 if(folder){assert.ok(folder.startsWith(path.join(os.tmpdir(),'gym-attendance-')));fs.rmSync(folder,{recursive:true,force:true});}
 assert.doesNotMatch(log,/Fatal error|Warning:|Uncaught /);
});

const memberA=new Map(),memberB=new Map();
const password='A long unique passphrase!';
let userA,userB;
async function csrf(cookies=admin,url='portal_accounts.php'){
 const r=await request(url,{},cookies);assert.equal(r.status,200);return (await r.text()).match(/name="csrf_token" value="([a-f0-9]+)"/)[1];
}
async function write(action,fields,cookies=admin,url='portal_accounts.php'){
 const data=new FormData();data.set('csrf_token',await csrf(cookies,url));for(const [key,value]of Object.entries(fields))data.set(key,String(value));
 return request('ajax.php?action='+action,{method:'POST',body:data},cookies);
}
async function invite(member,purpose='activate'){
 const r=await write('portal_invite',{member_id:member,purpose});assert.equal(r.status,200);return (await r.json()).activation_path.split('#token=')[1];
}
async function activate(token,username){return write('portal_activate',{token,username,password,password_confirm:password},new Map(),'activate_member.php');}
async function memberLogin(username,cookies,pass=password){
 const token=await csrf(cookies,'login.php');const r=await request('ajax.php?action=login',{method:'POST',body:new URLSearchParams({csrf_token:token,username,password:pass})},cookies);assert.equal(await r.text(),'4');
}


test('Attendance pages reuse the operations shell and legacy lookup controls',async()=>{
 for(const page of ['index.php?page=home','index.php?page=attendance']){const r=await request(page,{},staff);assert.equal(r.status,200);const html=await r.text();assert.match(html,/id="tracking_id"/);assert.match(html,/id="manage-records"/);assert.match(html,/id="sidebar"/);assert.doesNotMatch(html,/action=get_pdetails|action=save_track/);}
 assert.equal((await request('manage_attendance.php?id=1',{},staff)).status,403);
});
test('Attendance requires POST, CSRF and operations roles',async()=>{
 for(const action of ['attendance_lookup','attendance_checkin','attendance_checkout','attendance_correct']){
 assert.equal((await request('ajax.php?action='+action)).status,405);
 assert.equal((await request('ajax.php?action='+action,{method:'POST',body:new URLSearchParams({csrf_token:'wrong'})})).status,403);
 }
 for(const action of ['get_pdetails','save_track'])assert.equal((await write(action,{},staff,'attendance.php')).status,403);
});
let visit;
test('Staff lookup, confirmed check-in, replay and expired-membership checkout work over HTTP',async()=>{
 const number=sql("echo $db->query('SELECT member_id FROM members WHERE id=1')->fetch_assoc()['member_id'];");
 const lookup=await write('attendance_lookup',{tracking_id:number},staff,'attendance.php');assert.equal(lookup.status,200);const person=await lookup.json();assert.equal(person.eligibility.allowed,true);assert.deepEqual(Object.keys(person.member).sort(),['id','member_id','name']);
 assert.equal((await write('attendance_lookup',{tracking_id:"1' OR 1=1"},staff,'attendance.php')).status,422);
 const fields={person_id:1,identity_confirmed:'1',request_key:'a'.repeat(64)};
 assert.equal((await write('attendance_checkin',{...fields,identity_confirmed:'0'},staff,'attendance.php')).status,422);
 let r=await write('attendance_checkin',fields,staff,'attendance.php');assert.equal(r.status,200);assert.equal((await r.json()).saved,true);
 assert.equal((await write('attendance_checkin',fields,staff,'attendance.php')).status,200);
 assert.equal((await write('attendance_checkin',{...fields,request_key:'b'.repeat(64)},staff,'attendance.php')).status,409);
 visit=Number(sql("echo $db->query('SELECT id FROM attendance_visits WHERE open_member_id=1')->fetch_assoc()['id'];"));
 sql("$db->query('UPDATE registration_info SET status=0 WHERE member_id=1');");
 r=await write('attendance_checkout',{visit_id:visit,version:1,request_key:'c'.repeat(64)},staff,'attendance.php');assert.equal(r.status,200);
 assert.equal((await write('attendance_checkout',{visit_id:visit,version:1,request_key:'c'.repeat(64)},staff,'attendance.php')).status,200);
 assert.equal(sql('echo $db->query("SELECT COUNT(*) FROM attendance_audit WHERE visit_id='+visit+' ")->fetch_row()[0];'),'2');
});
test('corrections are Admin-only, require a reason, retain history and reject stale versions',async()=>{
 const fields={visit_id:visit,version:2,mode:'void',reason:'Duplicate visit confirmed by administrator.'};
 assert.equal((await write('attendance_correct',fields,staff,'attendance.php')).status,403);
 assert.equal((await write('attendance_correct',{...fields,reason:'short'},admin,'attendance.php')).status,422);
 assert.equal((await write('attendance_correct',fields,admin,'attendance.php')).status,200);
 assert.equal((await write('attendance_correct',fields,admin,'attendance.php')).status,409);
 const r=await request('manage_attendance.php?id='+visit);assert.equal(r.status,200);assert.match(await r.text(),/Duplicate visit confirmed/);
});
test('Member sees only own readonly visits and cannot access operations or avatars',async()=>{
 const first=await invite(1),second=await invite(5);assert.equal((await activate(first,'member_a')).status,200);assert.equal((await activate(second,'member_b')).status,200);await memberLogin('member_a',memberA);await memberLogin('member_b',memberB);
 for(const cookies of [memberA,memberB]){assert.equal((await request('attendance.php',{},cookies)).status,403);assert.equal((await request('attendance_avatar.php?id=1',{},cookies)).status,403);for(const action of ['attendance_lookup','attendance_checkin','attendance_checkout','attendance_correct'])assert.equal((await write(action,{person_id:1},cookies,'member_portal.php')).status,403);}
 const own=await request('member_portal.php?page=attendance&member_id=9',{},memberA);assert.equal(own.status,200);assert.match(await own.text(),/Voided/);
 const other=await request('member_portal.php?page=attendance&member_id=1',{},memberB);assert.equal(other.status,200);assert.doesNotMatch(await other.text(),/Voided|Duplicate visit confirmed/);
});
test('concurrent desk requests admit one visit and retain one audit entry',async()=>{
 async function worker(actor,key){
  const source=`require ${literal(path.join(root,'attendance_service.php'))};$db=new mysqli('localhost','root','',${literal(schema)});configure_database_timezone($db);try{(new AttendanceService($db))->checkIn(['person_id'=>'10','identity_confirmed'=>'1','request_key'=>str_repeat('${key}',64)],${actor},1);echo '200';}catch(AttendanceRequestException $e){echo $e->status;}`;
  const child=spawn(php,['-r',source],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);const [code]=await once(child,'exit');assert.equal(code,0,error);assert.equal(error,'');return Number(output);
 }
 assert.deepEqual((await Promise.all([worker(1,'d'),worker(2,'e')])).sort(),[200,409]);
 assert.equal(sql("echo $db->query('SELECT COUNT(*) FROM attendance_visits WHERE open_member_id=10')->fetch_row()[0];"),'1');
});
if(process.env.GYM_ATTENDANCE_BROWSER_AUDIT==='1')test('real browser lookup, check-in and checkout preserve the existing UI',async()=>{
 const {eventsBrowserSmoke}=await import('./helpers/events-browser.mjs');
 await eventsBrowserSmoke(base,folder,async({login,navigate,evaluate,until})=>{
 await login('staff');await navigate('index.php?page=attendance');
 const number=sql("echo $db->query('SELECT member_id FROM members WHERE id=5')->fetch_assoc()['member_id'];");
 await evaluate('document.querySelector("#tracking_id").value='+JSON.stringify(number)+';window.attendanceAjax=jQuery.ajax;jQuery.ajax=function(o){window.attendancePending=o;};document.querySelector("#attendance-lookup").requestSubmit()');
 assert.equal(await evaluate('document.querySelector("#check").disabled'),true);
 await evaluate('attendancePending.error({status:0});attendancePending.complete();jQuery.ajax=window.attendanceAjax');
 assert.equal(await evaluate('document.querySelector("#check").disabled'),false);
 assert.match(await evaluate('document.querySelector("[data-attendance-message]").textContent'),/Reload/);
 await evaluate('document.querySelector("#tracking_id").value='+JSON.stringify(number)+';document.querySelector("#attendance-lookup").requestSubmit()');
 await until('!document.querySelector("#details").classList.contains("d-none")');
 await evaluate('document.querySelector("[name=identity_confirmed]").checked=true;document.querySelector("#manage-records").requestSubmit()');
 await until('document.querySelector("[data-attendance-message]")?.textContent || document.querySelector("#details")?.classList.contains("d-none")');
 await navigate('index.php?page=attendance');
 await evaluate('document.querySelector("#tracking_id").value='+JSON.stringify(number)+';document.querySelector("#attendance-lookup").requestSubmit()');
 await until('document.querySelector("[data-attendance-submit]").textContent==="Check Out"');
 await evaluate('document.querySelector("#manage-records").requestSubmit()');
 await until('document.querySelector("#details")?.classList.contains("d-none")');
 assert.equal(sql("echo $db->query('SELECT COUNT(*) FROM attendance_visits WHERE member_id=5 AND checked_out_at IS NOT NULL')->fetch_row()[0];"),'1');
 });
},{timeout:60000});
