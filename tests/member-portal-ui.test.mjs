import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(new URL('../assets/js/member-portal.js',import.meta.url),'utf8');
function ui({activation=false,confirm=true}={}) {
 const state={calls:[],destinations:[],controls:[{disabled:false},{disabled:true}],valid:true,confirm};
 const message={className:'',textContent:'',children:[],appendChild(node){this.children.push(node)},scrollIntoView(){}};
 const token={value:''};const handlers={};
 const root={querySelector(s){return s==='[data-portal-message]'?message:activation?token:null},querySelectorAll(){return state.controls},addEventListener(name,fn){handlers[name]=fn}};
 const form={dataset:{},matches(){return true},reportValidity(){return state.valid},getAttribute(){return 'ajax.php?action=portal_profile'}};
 const window={location:{hash:'#token='+'a'.repeat(64),pathname:'/activate_member.php',href:'http://localhost/activate_member.php',assign(url){state.destinations.push(url)}},history:{replaceState(...args){state.history=args}},confirm(){return state.confirm}};
 class FormData{constructor(){this.disabled=state.controls.map(c=>c.disabled)}}
 const document={getElementById(){return root},createElement(){return {className:'',setAttribute(){},addEventListener(){},select(){}}}};
 let resolve,reject;
 const fetch=(url,options)=>{state.calls.push({url,options});return new Promise((a,b)=>{resolve=a;reject=b})};
 vm.runInNewContext(source,{window,document,FormData,fetch,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Error,TypeError,SyntaxError});
 return Object.assign(state,{message,token,form,submit(){return handlers.submit({target:form,preventDefault(){}})},respond(status,result){resolve({ok:status<400,json:async()=>result})},fail(error){reject(error)}});
}
test('activation token is read from URL fragment, scrubbed from address bar, and never requested in a query',()=>{
 const s=ui({activation:true});assert.equal(s.token.value,'a'.repeat(64));assert.equal(s.history[2],'/activate_member.php');assert.equal(s.calls.length,0);
});
test('portal form captures fields before disabling, sends CSRF body, prevents duplicate request and restores state',async()=>{
 const s=ui();const pending=s.submit();await s.submit();assert.equal(s.calls.length,1);assert.deepEqual([...s.calls[0].options.body.disabled],[false,true]);assert.equal(s.calls[0].options.credentials,'same-origin');
 s.respond(200,{saved:true});await pending;assert.deepEqual(s.controls.map(c=>c.disabled),[false,true]);assert.deepEqual(s.destinations,['http://localhost/activate_member.php']);
});
for(const status of [401,403,409,422,429,503])test(`portal HTTP ${status} preserves form and displays safe text`,async()=>{
 const s=ui();const pending=s.submit();s.respond(status,{error:'<script>safe-text</script>'});await pending;assert.equal(s.message.textContent,'<script>safe-text</script>');assert.deepEqual(s.controls.map(c=>c.disabled),[false,true]);assert.equal(s.destinations.length,0);
});
test('network interruption clears busy state and advises checking saved state before retry',async()=>{
 const s=ui();const pending=s.submit();s.fail(new TypeError('Network unavailable'));await pending;assert.match(s.message.textContent,/Reload to check/);assert.equal(s.controls[0].disabled,false);
});
test('invitation link is validated and displayed as a readonly value without interpreting HTML',async()=>{
 const s=ui();const pending=s.submit();s.respond(200,{saved:true,activation_path:'activate_member.php#token='+'b'.repeat(64),message:'Private link'});await pending;assert.equal(s.message.children.length,1);assert.equal(s.message.children[0].readOnly,true);assert.equal(s.destinations.length,0);
});
test('logout and password change accept only the fixed login redirect',async()=>{
 const s=ui();const pending=s.submit();s.respond(200,{saved:true,redirect:'login.php'});await pending;assert.deepEqual(s.destinations,['login.php']);
});
test('cancelled confirmation and invalid form send nothing',async()=>{
 const s=ui({confirm:false});s.form.dataset.confirm='Disable?';await s.submit();assert.equal(s.calls.length,0);s.confirm=true;s.valid=false;await s.submit();assert.equal(s.calls.length,0);
});
