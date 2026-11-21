import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {run,literal} from './helpers/php.mjs';

function render(get,role=1){return run({login_id:role===1?2:3,login_type:role},`
 $_GET=json_decode(${literal(JSON.stringify(get))},true);include 'navbar.php';`);}
function active(html){
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);
 const selected=[],window={};
 const $=selector=>({click(){},addClass(name){assert.equal(name,'active');selected.push(selector);}});
 vm.runInNewContext(scripts[0][1],{$,window});
 assert.equal(window.__navbarProbe,undefined);assert.equal(selected.length,1);return selected[0];
}

for(const role of [1,2]){
 const pages=role===1?['home','members','registered_members','schedule','plans','packages','trainer','users','settings']:['home','members','registered_members','schedule'];
 for(const page of pages){
  test(`role ${role} highlights ${page} normally`,()=>{
   const d=render({page},role);assert.equal(d.status,200);assert.equal(active(d.body),'.nav-'+page);
   assert.ok(d.body.includes('href="index.php?page='+page+'"'));
  });
 }
 for(const page of ["');window.__navbarProbe=1;//",'</script><script>window.__navbarProbe=1</script><script>',
  'home, body','home\n','../../admin_class','unknown','',null,['home'],{page:'home'},true]){
  test(`role ${role} rejects unsafe navigation value ${JSON.stringify(page)}`,()=>{
   const d=render({page},role);assert.equal(d.status,200);assert.equal(active(d.body),'.nav-home');
   assert.doesNotMatch(d.body,/__navbarProbe|Warning|Fatal error/);
  });
 }
 test(`role ${role} defaults to Home with no page parameter`,()=>{
  assert.equal(active(render({},role).body),'.nav-home');
 });
}
for(const page of ['plans','packages','trainer','users']){
 test(`Staff cannot highlight or receive the ${page} Admin link`,()=>{
  const d=render({page},2);assert.equal(active(d.body),'.nav-home');
  assert.ok(!d.body.includes('href="index.php?page='+page+'"'));
 });
}
test('anonymous direct navbar access still stops before rendering',()=>{
 const d=run({},"$_GET=['page'=>'home'];include 'navbar.php';");
 assert.equal(d.status,302);assert.equal(d.body,'');
});
