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
const schema='gym_portal_test_'+randomBytes(8).toString('hex');
let folder,server,base,log='';
const admin=new Map(),staff=new Map();
function phpRun(source){const r=spawnSync(php,[...gdArgs,'-r',source],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);assert.equal(r.stderr,'');return r.stdout;}
function sql(source){return phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'',${literal(schema)});${source}`);}
async function request(url,options={},cookies=admin){const headers=new Headers(options.headers);if(cookies.size)headers.set('Cookie',[...cookies].map(([k,v])=>k+'='+v).join('; '));const r=await fetch(base+url,{...options,headers,redirect:'manual'});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}return r;}
async function login(user,cookies){const page=await request('login.php',{},cookies);const token=(await page.text()).match(/name="csrf_token" value="([a-f0-9]+)"/)[1];const r=await request('ajax.php?action=login',{method:'POST',body:new URLSearchParams({csrf_token:token,username:user,password:user})},cookies);assert.equal(await r.text(),'1');}
before(async()=>{
 folder=fs.mkdtempSync(path.join(os.tmpdir(),'gym-portal-'));
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
 if(!/^gym_portal_test_[a-f0-9]{16}$/.test(schema))throw Error('Unsafe test schema');
 phpRun(`$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'');$db->query('DROP DATABASE IF EXISTS ${schema}');`);
 if(folder){assert.ok(folder.startsWith(path.join(os.tmpdir(),'gym-portal-')));fs.rmSync(folder,{recursive:true,force:true});}
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

test('Admin activates two members through single-use links; Member Login returns its dedicated redirect marker',async()=>{
 const first=await invite(1),second=await invite(5);
 assert.equal((await activate(first,'member_a')).status,200);assert.equal((await activate(second,'member_b')).status,200);
 assert.equal((await activate(first,'replay')).status,422);
 userA=Number(sql("echo $db->query('SELECT user_id FROM member_portal_accounts WHERE member_id=1')->fetch_assoc()['user_id'];"));
 userB=Number(sql("echo $db->query('SELECT user_id FROM member_portal_accounts WHERE member_id=5')->fetch_assoc()['user_id'];"));
 await memberLogin('member_a',memberA);await memberLogin('member_b',memberB);
 const loginPage=await request('login.php',{},memberA);assert.equal(loginPage.headers.get('location'),'member_portal.php');
});
test('all portal pages load for Member; operations and administration stay inaccessible',async()=>{
 for(const page of ['dashboard','profile','memberships','payments','schedule','events','security']){const r=await request('member_portal.php?page='+page,{},memberA);assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/Warning:|Fatal error|password_hash/);}
 for(const page of ['members.php','users.php','view_pdetails.php?id=1','payment.php?id=1','schedule.php','events.php','manage_user.php?id=1','portal_accounts.php','settings.php','index.php?page=home'])assert.equal((await request(page,{},memberA)).status,403,page);
 for(const page of ['member_portal.php','member_avatar.php'])assert.equal((await request(page,{},staff)).status,403);
});
test('changing URL IDs cannot reveal another member profile, agreements, payment or schedule',async()=>{
 sql(`$db->query("UPDATE payments SET remarks='PRIVATE_MEMBER_A' WHERE registration_id=1");$db->query("UPDATE payments SET remarks='PRIVATE_MEMBER_B' WHERE registration_id=5");`);
 for(const [cookies,own,other]of [[memberA,'PRIVATE_MEMBER_A','PRIVATE_MEMBER_B'],[memberB,'PRIVATE_MEMBER_B','PRIVATE_MEMBER_A']]){
  const r=await request('member_portal.php?page=payments&id=1&member_id=1&registration_id=1',{},cookies);assert.equal(r.status,200);const html=await r.text();assert.match(html,new RegExp(own));assert.doesNotMatch(html,new RegExp(other));
 }
 const profile=await request('member_portal.php?page=profile&member_id=5',{},memberA);assert.match(await profile.text(),/Ali\s+Ahmad/);
});
test('Member cannot invoke any operations mutation, change role or mark event attendance',async()=>{
 for(const action of ['save_user','delete_user','save_account','save_member','delete_member','save_membership','renew_membership','save_payment','save_schedule','save_settings','save_event','save_event_participant','portal_invite','portal_access']){
  const r=await request('ajax.php?action='+action,{method:'POST',body:new URLSearchParams({csrf_token:await csrf(memberA,'member_portal.php'),id:'1',member_id:'5',type:'1'})},memberA);assert.equal(r.status,403,action);
 }
 const r=await write('portal_event',{id:'1',version:'1',participant_status:'attended'},memberA,'member_portal.php');assert.equal(r.status,403);
});
test('portal mutations require POST and CSRF',async()=>{
 for(const action of ['portal_profile','portal_password','portal_event','portal_logout']){
  assert.equal((await request('ajax.php?action='+action,{},memberA)).status,405);
  const r=await request('ajax.php?action='+action,{method:'POST',body:new URLSearchParams({csrf_token:'wrong'})},memberA);assert.equal(r.status,403);
 }
 assert.equal((await request('ajax.php?action=portal_activate',{method:'POST',body:new URLSearchParams({token:'f'.repeat(64)})},new Map())).status,403);
});
test('private avatar upload is re-encoded and accessible only as the logged-in owner',async()=>{
 const png=Buffer.from(phpRun("$im=imagecreatetruecolor(40,40);ob_start();imagepng($im);echo base64_encode(ob_get_clean());"),'base64');
 const data=new FormData();for(const [k,v]of Object.entries({csrf_token:await csrf(memberA,'member_portal.php'),version:'1',contact:'0123456789',address:'Private address',member_id:'5',firstname:'FORGED',type:'1'}))data.set(k,v);
 data.set('avatar',new Blob([png,Buffer.from('<?php unsafe_marker ?>')],{type:'image/png'}),'avatar.png');
 const r=await request('ajax.php?action=portal_profile',{method:'POST',body:data},memberA);assert.equal(r.status,200);
 const image=await request('member_avatar.php?id='+userA,{},memberA);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('cache-control'),'no-store');assert.ok(!Buffer.from(await image.arrayBuffer()).includes(Buffer.from('unsafe_marker')));
 const other=await request('member_avatar.php?id='+userA,{},memberB);assert.equal(other.headers.get('content-type'),'image/svg+xml');
 assert.equal((await request('member_avatar.php',{},new Map())).status,302);
 assert.equal(sql("echo $db->query('SELECT firstname FROM members WHERE id=1')->fetch_assoc()['firstname'];"),'Ali');
 const stale=await write('portal_profile',{version:'1',contact:'0123456789',address:'Stale'},memberA,'member_portal.php');assert.equal(stale.status,409);
});
test('Member event ownership is derived from its account and participant lists remain private',async()=>{
 const event=JSON.parse(sql("echo json_encode($db->query('SELECT * FROM events WHERE id=1')->fetch_assoc());"));
 const r=await write('portal_event',{id:'1',version:event.version,member_id:'5',participant_version:'1',participant_status:'cancelled'},memberA,'member_portal.php');assert.equal(r.status,200);
 const statuses=JSON.parse(sql("echo json_encode($db->query('SELECT member_id,status FROM event_registrations WHERE event_id=1 ORDER BY member_id')->fetch_all(MYSQLI_ASSOC));"));
 assert.equal(statuses.find(p=>Number(p.member_id)===1).status,'cancelled');assert.equal(statuses.find(p=>Number(p.member_id)===5).status,'registered');
 const view=await request('member_portal.php?page=events',{},memberA);const html=await view.text();assert.doesNotMatch(html,/Fatin Hassan|Nutrition Workshop|Participants and attendance/);
});
test('disable revokes old sessions immediately; enable does not restore an old session',async()=>{
 const version=Number(sql(`echo $db->query('SELECT version FROM users WHERE id=${userB}')->fetch_assoc()['version'];`));
 assert.equal((await write('portal_access',{member_id:'5',version,enabled:'0'})).status,200);
 const denied=await request('ajax.php?action=portal_profile',{method:'POST',body:new URLSearchParams({csrf_token:'unused'})},memberB);assert.equal(denied.status,401);
 assert.equal((await write('portal_access',{member_id:'5',version:version+1,enabled:'1'})).status,200);
 assert.equal((await request('member_portal.php',{},memberB)).status,302);await memberLogin('member_b',memberB);
});
test('password change signs out current and other sessions; recovery consumes its link',async()=>{
 const secondSession=new Map();await memberLogin('member_a',secondSession);
 const next='A different unique passphrase!';const changed=await write('portal_password',{current_password:password,password:next,password_confirm:next},memberA,'member_portal.php');assert.equal(changed.status,200);
 assert.equal((await request('member_portal.php',{},secondSession)).status,302);
 await memberLogin('member_a',memberA,next);
 const recovery=await invite(1,'reset');const recovered=await activate(recovery,'');assert.equal(recovered.status,200);assert.equal((await activate(recovery,'')).status,422);
 assert.equal((await request('member_portal.php',{},memberA)).status,302);await memberLogin('member_a',memberA);
});
test('legacy methods and routes are gone, and Admin user forms cannot promote or delete Member accounts',async()=>{
 for(const method of ['login2','logout2','signup','update_account'])assert.equal(phpRun(`ini_set('session.save_path',${literal(path.join(folder,'sessions'))});require 'admin_class.php';echo method_exists('Action','${method}')?'yes':'no';`),'no');
 const r=await request('manage_user.php?id='+userA);assert.equal(r.status,409);
 const save=await write('save_user',{id:userA,version:'1',name:'Escalation',username:'member_a',password:'',type:'1'});assert.equal(save.status,409);
 const remove=await write('delete_user',{id:userA});assert.equal(remove.status,409);
 const users=await request('users.php');assert.doesNotMatch(await users.text(),/member_a|member_b|Alumnus/);
});

async function worker(code){
 const source=`require ${literal(path.join(root,'member_portal_service.php'))};require ${literal(path.join(root,'events_service.php'))};$db=new mysqli(getenv('GYM_TEST_DB_HOST')?:'localhost',getenv('GYM_TEST_DB_USER')?:'root',getenv('GYM_TEST_DB_PASSWORD')?:'',${literal(schema)});configure_database_timezone($db);try{${code};echo json_encode(['status'=>200]);}catch(EventRequestException $e){echo json_encode(['status'=>$e->status]);}`;
 const child=spawn(php,['-r',source],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);const [codeResult]=await once(child,'exit');assert.equal(codeResult,0,error+output);assert.equal(error,'');return JSON.parse(output);
}
test('concurrent activation consumes one token once and creates one linked account',async()=>{
 const token=await invite(9);const post=literal(JSON.stringify({token,username:'concurrent_member',password,password_confirm:password}));
 const code=`(new MemberPortalService($db))->activate(json_decode(${post},true),'192.0.2.101')`;
 const results=await Promise.all([worker(code),worker(code)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,422]);
 assert.equal(Number(sql("echo $db->query('SELECT COUNT(*) AS n FROM member_portal_accounts WHERE member_id=9')->fetch_assoc()['n'];")),1);
});
test('Member and Staff race for the same final event seat without oversubscription',async()=>{
 sql(`$db->query("UPDATE events SET capacity=1,status='published' WHERE id=2");`);
 const authVersion=Number(sql(`echo $db->query('SELECT auth_version FROM users WHERE id=${userA}')->fetch_assoc()['auth_version'];`));
 const first=`(new EventsService($db))->participant(['id'=>'2','version'=>'1','participant_status'=>'registered'],${userA},${authVersion},true)`;
 const second="(new EventsService($db))->participant(['id'=>'2','version'=>'1','member_id'=>'5','participant_status'=>'registered'],2,1)";
 const results=await Promise.all([worker(first),worker(second)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(Number(sql("echo $db->query('SELECT COUNT(*) AS n FROM event_registrations WHERE event_id=2')->fetch_assoc()['n'];")),1);
});

if(process.env.GYM_PORTAL_BROWSER_AUDIT==='1')test('real browser Member Portal smoke',{timeout:60000},async()=>{
 const {memberPortalBrowserSmoke}=await import('./helpers/member-portal-browser.mjs');
 assert.equal((await memberPortalBrowserSmoke(base,folder)).length,9);
});

