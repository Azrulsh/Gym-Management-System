import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../assets/js/schedules.js',import.meta.url),'utf8');
function ui() {
  const state={requests:[],events:[],text:'',hidden:true,disabled:false};
  const handlers={},document={},form={dataset:{}};
  const control={};
  const element={
    find(){return this;}, closest(){return [form];},
    attr(name){return name==='data-id'?'1':'token';},
    hasClass(){return state.cancel===true;},
    toggleClass(name,value){state.hidden=value;},
    removeClass(){return this;},addClass(){return this;},empty(){state.text='';return this;},
    text(value){state.text=value;return this;},prop(name,value){state.disabled=value;return this;},
  };
  function $(target){if(target===document)return {on(event,selector,callback){handlers[selector]=callback;}};return element;}
  $.ajax=request=>state.requests.push(request);
  const window={start_load(){state.events.push('start');},end_load(){state.events.push('end');},
    alert_toast(){state.events.push('toast');},setTimeout(callback){callback();},location:{reload(){state.events.push('reload');}}};
  vm.runInNewContext(source,{document,jQuery:$,window});
  state.open=()=>handlers['.request-schedule-delete, .cancel-schedule-delete'].call(control);
  state.close=()=>{state.cancel=true;state.open();state.cancel=false;};
  state.confirm=()=>handlers['.confirm-schedule-delete'].call(control);
  state.saving=value=>{form.dataset.submitting=value?'true':'false';};
  return state;
}
test('opening and cancelling confirmation never deletes anything',()=>{
  const state=ui();state.open();assert.equal(state.hidden,false);
  state.close();assert.equal(state.hidden,true);assert.equal(state.requests.length,0);
});
test('Confirm Delete sends ID and CSRF once even with invalid unsaved form fields',()=>{
  const state=ui();state.open();state.confirm();state.confirm();
  assert.equal(state.requests.length,1);
  assert.equal(state.requests[0].url,'ajax.php?action=delete_schedule');
  assert.equal(state.requests[0].method,'POST');
  assert.equal(state.requests[0].data.id,1);
  assert.equal(state.requests[0].data.csrf_token,'token');
  state.requests[0].success('1');state.requests[0].complete();state.confirm();
  assert.equal(state.requests.length,1);
  assert.deepEqual(state.events,['start','toast','reload','end']);
});
test('Delete cannot race an ongoing Save from the same form',()=>{
  const state=ui();state.saving(true);state.confirm();assert.equal(state.requests.length,0);
});

test('Delete timeout restores controls and asks user to verify the calendar without automatic retry',()=>{
  const state=ui();state.open();state.confirm();
  const request=state.requests[0];assert.equal(request.timeout,15000);
  request.error({responseText:'<b>Internal error</b>'},'timeout');request.complete();
  assert.equal(state.disabled,false);
  assert.match(state.text,/Delete status could not be confirmed/);
  assert.match(state.text,/check whether the schedule still exists/);
  assert.doesNotMatch(state.text,/<b>|Internal error/);
  assert.deepEqual(state.events,['start','end']);assert.equal(state.requests.length,1);
  state.confirm();assert.equal(state.requests.length,2);
});
for(const failure of ['missing','network','unexpected']) {
  test(`${failure} rejection restores controls, displays a safe message and allows retry`,()=>{
    const state=ui();state.open();state.confirm();
    if(failure==='unexpected')state.requests[0].success('<b>SQL failure</b>');
    else state.requests[0].error(failure==='missing'?{responseJSON:{error:'Schedule no longer exists. Refresh the calendar.'}}:{});
    state.requests[0].complete();assert.equal(state.disabled,false);
    assert.match(state.text,failure==='missing'?/no longer exists/:/Unable to delete/);
    assert.deepEqual(state.events,['start','end']);state.confirm();assert.equal(state.requests.length,2);
  });
}
