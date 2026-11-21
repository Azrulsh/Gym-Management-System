import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../assets/js/events.js',import.meta.url),'utf8');
function ui({confirm=true}={}) {
 const state={requests:[],starts:0,ends:0,navigations:[],valid:true,controls:[{disabled:false},{disabled:true}],confirm};
 const message={className:'',textContent:'',scrollIntoView(){}};
 const handler={};
 const root={querySelector(selector){return selector==='.events-message'?message:null},querySelectorAll(){return state.controls},addEventListener(name,fn){handler[name]=fn}};
 const form={dataset:{},matches(){return true},reportValidity(){return state.valid},querySelector(){return null},getAttribute(){return 'ajax.php?action=save_event'}};
 const $={fn:{},ajax(options){state.requests.push(options)}};
 const window={confirm(){return state.confirm},start_load(){state.starts++},end_load(){state.ends++},location:{assign(url){state.navigations.push(url)}}};
 class FormData{constructor(){this.disabled=state.controls.map(c=>c.disabled)}}
 vm.runInNewContext(source,{jQuery:$,document:{getElementById(){return root}},window,FormData});
 return Object.assign(state,{message,form,submit(){handler.submit({target:form,preventDefault(){}})}});
}
test('Events captures enabled fields before disabling, prevents duplicate submit and navigates after cleanup',()=>{
 const s=ui();s.submit();s.submit();assert.equal(s.requests.length,1);const r=s.requests[0];
 assert.deepEqual([...r.data.disabled],[false,true]);assert.equal(r.timeout,15000);assert.equal(r.processData,false);assert.equal(r.contentType,false);
 r.success({saved:true,id:5});assert.equal(s.navigations.length,0);r.complete();assert.equal(s.ends,1);assert.deepEqual(s.navigations,['index.php?page=view_event&id=5']);assert.deepEqual(s.controls.map(c=>c.disabled),[false,true]);
});
for(const [status,text] of [[409,'error'],[422,'error'],[503,'error'],[0,'timeout'],[0,'error'],[401,'error'],[403,'error']])test(`Events ${status}/${text} restores controls, keeps form and permits retry`,()=>{
 const s=ui();s.submit();s.requests[0].error({status,responseText:'<script>private</script>'},text);s.requests[0].complete();
 assert.equal(s.navigations.length,0);assert.equal(s.ends,1);assert.deepEqual(s.controls.map(c=>c.disabled),[false,true]);assert.doesNotMatch(s.message.textContent,/private|<script>/);s.submit();assert.equal(s.requests.length,2);
});
test('Events server errors use textContent and malformed successes never navigate',()=>{
 const s=ui();s.submit();s.requests[0].error({status:422,responseJSON:{error:'<img onerror=probe>'}},'error');assert.equal(s.message.textContent,'<img onerror=probe>');
 s.requests[0].success({saved:true,id:'1;bad'});s.requests[0].complete();assert.equal(s.navigations.length,0);
});
test('Events delete confirmation and browser validity block requests',()=>{
 const s=ui({confirm:false});s.form.dataset.confirm='Delete?';s.submit();assert.equal(s.requests.length,0);s.confirm=true;s.valid=false;s.submit();assert.equal(s.requests.length,0);
});
test('Events delete redirects to event list after request cleanup',()=>{
 const s=ui();s.submit();s.requests[0].success({deleted:true});s.requests[0].complete();assert.deepEqual(s.navigations,['index.php?page=events']);
});
