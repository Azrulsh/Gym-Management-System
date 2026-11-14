import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page=readFileSync(new URL('../index.php',import.meta.url),'utf8');
const source=page.slice(page.indexOf('window.uni_modal ='),page.indexOf('window._conf ='));
function ui() {
  const state={events:[],requests:[],alerts:[],classes:'modal-dialog modal-md'};
  const elements={
    '#uni_modal .modal-title':{text(value){state.title=value;}},
    '#uni_modal .modal-body':{html(value){if(state.failRender)throw Error('private render error');state.body=value;},empty(){state.body='';}},
    '#uni_modal .modal-dialog':{addClass(value){state.classes+=' '+value;return this;},removeAttr(){state.classes='';return this;}},
    '#uni_modal':{modal(value){state.events.push(typeof value==='string'?value:'show');}},
  };
  const $=selector=>elements[selector];$.ajax=options=>state.requests.push(options);
  const window={alert(message){state.alerts.push(message);state.events.push('alert');}};
  vm.runInNewContext(source,{$,window,start_load(){state.events.push('start');},end_load(){state.events.push('end');}});
  state.open=(title='Details',url='view_pdetails.php?id=9',size='')=>window.uni_modal(title,url,size);
  return state;
}

test('normal HTML opens the modal and stops loading without changing form contents',()=>{
  const state=ui();state.open('New Member','manage_member.php','large');
  const request=state.requests[0];assert.equal(request.method,'GET');assert.equal(request.dataType,'html');assert.equal(request.timeout,15000);
  assert.equal(request.url,'manage_member.php');
  const html='<form id="manage-member"><input name="csrf_token" value="token"></form>';
  request.success(html);request.complete();
  assert.equal(state.title,'New Member');assert.equal(state.body,html);assert.match(state.classes,/large/);
  assert.deepEqual(state.events,['start','show','end']);assert.deepEqual(state.alerts,[]);
});

for(const value of ['', '   \r\n', null, undefined]){
  test(`empty/unexpected response ${JSON.stringify(value)} stops loading and allows retry`,()=>{
    const state=ui();state.open();state.requests[0].success(value);state.requests[0].complete();
    assert.deepEqual(state.events,['start','end','alert']);assert.match(state.alerts[0],/No details/);
    state.open();state.requests[1].success('<p>Details loaded</p>');state.requests[1].complete();
    assert.equal(state.body,'<p>Details loaded</p>');assert.equal(state.events.at(-1),'end');
  });
}

for(const [status,reason] of [[0,'error'],[0,'timeout'],[500,'error'],[503,'error']]){
  test(`request failure ${status}/${reason} stops loading before a safe error message`,()=>{
    const state=ui();state.open();state.requests[0].error({status,responseText:'<b>SQL private details</b>'},reason);state.requests[0].complete();
    assert.deepEqual(state.events,['start','end','alert']);
    assert.match(state.alerts[0],reason==='timeout'?/too long/:/Unable to load/);assert.doesNotMatch(state.alerts[0],/SQL|<b>/);
  });
}

for(const status of [401,403]){
  test(`${status} preserves global authentication handling without duplicate alerts`,()=>{
    const state=ui();state.open();state.requests[0].error({status},'error');state.requests[0].complete();
    assert.deepEqual(state.events,['start','end']);assert.deepEqual(state.alerts,[]);
  });
}

test('render failure removes partial content, stops loading and lets another modal open',()=>{
  const state=ui();state.failRender=true;state.open();state.requests[0].success('<form>Broken</form>');state.requests[0].complete();
  assert.equal(state.body,'');assert.deepEqual(state.events,['start','hide','end','alert']);
  assert.match(state.alerts[0],/Unable to display/);
  state.failRender=false;state.open();state.requests[1].success('<form>Ready</form>');state.requests[1].complete();
  assert.equal(state.body,'<form>Ready</form>');
});
