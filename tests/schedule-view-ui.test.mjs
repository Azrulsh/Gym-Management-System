import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source=readFileSync(new URL('../view_schedule.php',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0];
function ui(){
 const state={requests:[],events:[],text:'',disabled:false,hidden:true},handlers={};
 const message={removeClass(){return this;},addClass(){return this;},empty(){state.text='';return this;},text(v){state.text=v;return this;}};
 const confirmation={removeClass(){state.hidden=false;},addClass(){state.hidden=true;},hasClass(){return state.hidden;}};
 const view={attr(n){return n==='data-id'?'1':'csrf-test';},find(selector){
  if(selector==='.schedule-view-message')return message;
  if(selector==='.schedule-view-confirm')return confirmation;
  return {on(event,fn){handlers[selector]=fn;},prop(n,v){state.disabled=v;}};
 }};
 const $=()=>view;$.ajax=request=>state.requests.push(request);
 const window={delete_schedule:'existing handler',start_load(){state.events.push('start');},end_load(){state.events.push('end');},
  alert_toast(){state.events.push('toast');},setTimeout(fn){state.reload=fn;},location:{reload(){state.events.push('reload');}},
  uni_modal(title,url){state.edit=url;}};
 vm.runInNewContext(source,{jQuery:$,window});
 state.click=selector=>handlers[selector]();state.window=window;return state;
}
test('details keeps scoped Edit and never replaces shared delete handler',()=>{
 const s=ui();s.click('#edit');assert.equal(s.edit,'manage_schedule.php?id=1');assert.equal(s.window.delete_schedule,'existing handler');
});
test('Delete requires confirmation; cancel sends nothing; confirmed request carries ID and CSRF once',()=>{
 const s=ui();s.click('.confirm-view-delete');assert.equal(s.requests.length,0);
 s.click('#delete_schedule');s.click('.cancel-view-delete');s.click('.confirm-view-delete');assert.equal(s.requests.length,0);
 s.click('#delete_schedule');s.click('.confirm-view-delete');s.click('.confirm-view-delete');
 assert.equal(s.requests.length,1);const r=s.requests[0];assert.equal(r.data.id,1);assert.equal(r.data.csrf_token,'csrf-test');
 assert.equal(r.method,'POST');assert.equal(r.url,'ajax.php?action=delete_schedule');assert.equal(r.timeout,15000);
 s.click('#edit');assert.equal(s.edit,undefined);
 r.success('1');r.complete();s.click('.confirm-view-delete');assert.equal(s.requests.length,1);
 assert.deepEqual(s.events,['start','end','toast']);s.reload();assert.equal(s.events.at(-1),'reload');
});
for(const kind of ['timeout','network','missing','unexpected']){
 test(`${kind} safely restores controls and loading without claiming deletion or automatically retrying`,()=>{
  const s=ui();s.click('#delete_schedule');s.click('.confirm-view-delete');const r=s.requests[0];
  if(kind==='unexpected')r.success('<b>SQL failure</b>');
  else r.error(kind==='missing'?{status:404,responseJSON:{error:'Schedule no longer exists.'}}:{responseText:'<b>SQL failure</b>'},kind);
  r.complete();assert.equal(s.disabled,false);assert.deepEqual(s.events,['start','end']);assert.equal(s.requests.length,1);
  assert.doesNotMatch(s.text,/SQL failure|<b>/);assert.match(s.text,kind==='timeout'?/could not be confirmed/:kind==='missing'?/no longer exists/:/Unable to delete/);
  s.click('.confirm-view-delete');assert.equal(s.requests.length,2);
 });
}
