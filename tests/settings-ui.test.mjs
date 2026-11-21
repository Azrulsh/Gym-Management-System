import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/js/settings.js',import.meta.url),'utf8');
function ui(){
 const state={requests:[],starts:0,ends:0,reloads:0,revoked:[],created:[],valid:true};
 function control(name,disabled=false){return {name,disabled,value:'',checked:false,files:[],handlers:{},validity:'',addEventListener(e,f){this.handlers[e]=f},setCustomValidity(v){this.validity=v},reportValidity(){return true}};}
 const elements=[];for(const name of ['logo','cover','remove_logo','remove_cover','gym_name']){const c=control(name);elements.push(c);elements[name]=c;}
 const message={className:'settings-message',textContent:''};
 const images={};for(const kind of ['logo','cover'])images['preview-'+kind]={src:'old-'+kind,dataset:{currentSrc:'old-'+kind,defaultSrc:'default-'+kind}};
 const handlers={};const form={elements,action:'ajax.php?action=save_settings',handlers,addEventListener(e,f){handlers[e]=f},querySelector(){return message},reportValidity(){return state.valid}};
 const document={getElementById(id){return id==='settings-form'?form:images[id]}};
 const window={start_load(){state.starts++},end_load(){state.ends++},location:{reload(){state.reloads++}},addEventListener(){}};
 const $={ajax(request){state.requests.push(request)}};
 const URL={createObjectURL(file){const url='blob:'+file.name;state.created.push(url);return url},revokeObjectURL(url){state.revoked.push(url)}};
 class FormData {constructor(f){this.disabledAtCapture=f.elements.map(c=>c.disabled);}}
 vm.runInNewContext(source,{jQuery:$,document,window,URL,FormData});
 state.submit=()=>handlers.submit({preventDefault(){}});state.cancel=()=>handlers.reset({preventDefault(){state.resetPrevented=true}});
 state.select=(kind,file)=>{elements[kind].files=file?[file]:[];elements[kind].handlers.change()};
 state.remove=(kind,checked)=>{elements['remove_'+kind].checked=checked;elements['remove_'+kind].handlers.change()};
 return Object.assign(state,{elements,images,message});
}

test('Settings capture fields before disabling controls, prevent duplicate submission and reload only on success',()=>{
 const s=ui();s.submit();s.submit();assert.equal(s.requests.length,1);const r=s.requests[0];
 assert.equal(r.method,'POST');assert.equal(r.timeout,15000);assert.equal(r.contentType,false);assert.equal(r.processData,false);
 assert.ok(r.data.disabledAtCapture.every(v=>!v));assert.ok(s.elements.every(c=>c.disabled));
 r.success({saved:true});assert.equal(s.reloads,0);r.complete();assert.equal(s.reloads,1);assert.equal(s.ends,1);
});
for(const [status,errorStatus,error] of [[409,'error','Settings changed. Reload.'],[422,'error','Invalid image.'],[503,'error','Unavailable.'],[0,'error',null],[0,'timeout',null]]){
 test(`Settings ${status}/${errorStatus} restores controls and preserves unsaved values`,()=>{
  const s=ui();s.elements.gym_name.value='Unsaved';s.elements.logo.disabled=true;s.submit();const r=s.requests[0];
  r.error({status,responseJSON:error?{error}:null,responseText:'<script>private</script>'},errorStatus);r.complete();
  assert.equal(s.reloads,0);assert.equal(s.ends,1);assert.equal(s.elements.logo.disabled,true);assert.equal(s.elements.gym_name.disabled,false);assert.equal(s.elements.gym_name.value,'Unsaved');
  assert.doesNotMatch(s.message.textContent,/private|<script>/);assert.match(s.message.textContent,error?new RegExp(error.replace('.','\\.')):/status could not be confirmed/);
  s.submit();assert.equal(s.requests.length,2);
 });
}
test('server error text is displayed as text without HTML interpretation',()=>{
 const s=ui();s.submit();s.requests[0].error({status:422,responseJSON:{error:'<script>probe</script>'}},'error');assert.equal(s.message.textContent,'<script>probe</script>');
});
test('preview, replacement, remove and Cancel release object URLs and restore saved branding',()=>{
 const s=ui();const file=name=>({name,type:'image/png',size:10});
 s.select('logo',file('one'));assert.equal(s.images['preview-logo'].src,'blob:one');
 s.select('logo',file('two'));assert.deepEqual(s.revoked,['blob:one']);
 s.remove('logo',true);assert.deepEqual(s.revoked,['blob:one','blob:two']);assert.equal(s.images['preview-logo'].src,'default-logo');
 s.select('cover',file('cover'));s.cancel();assert.equal(s.images['preview-cover'].src,'old-cover');assert.ok(s.revoked.includes('blob:cover'));
});
test('invalid images fail client validation and Cancel clears the error',()=>{
 const s=ui();s.select('logo',{name:'bad',type:'image/svg+xml',size:10});assert.ok(s.elements.logo.validity);assert.equal(s.created.length,0);
 s.select('cover',{name:'large',type:'image/png',size:2097153});assert.ok(s.elements.cover.validity);s.cancel();assert.equal(s.elements.cover.validity,'');
});
test('invalid form sends no request and Cancel cannot reset during a save',()=>{
 const s=ui();s.valid=false;s.submit();assert.equal(s.requests.length,0);s.valid=true;s.submit();s.cancel();assert.equal(s.resetPrevented,true);
});
