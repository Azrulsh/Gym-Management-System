import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page=readFileSync(new URL('../index.php',import.meta.url),'utf8');
const source=page.slice(page.indexOf('window.uni_modal ='),page.indexOf('window._conf ='));
function ui(abortable=true) {
  const state={events:[],requests:[],alerts:[],classes:'modal-dialog modal-md'};
  const elements={
    '#uni_modal .modal-title':{text(value){state.title=value;}},
    '#uni_modal .modal-body':{html(value){if(state.failRender)throw Error('private render error');state.body=value;if(state.onRender)state.onRender();},empty(){state.body='';}},
    '#uni_modal .modal-dialog':{addClass(value){state.classes+=' '+value;return this;},removeAttr(){state.classes='';return this;}},
    '#uni_modal':{modal(value){state.events.push(typeof value==='string'?value:'show');}},
  };
  const $=selector=>elements[selector];$.ajax=options=>{
    state.requests.push(options);
    if(!abortable)return;
    return {abort(){state.events.push('abort');options.error({status:0},'abort');options.complete();}};
  };
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

test('late success from a replaced request cannot overwrite the latest modal',()=>{
  const state=ui();state.open('Member A','a');state.open('Member B','b');
  assert.deepEqual(state.events,['start','abort']);
  state.requests[1].success('<p>Member B</p>');state.requests[1].complete();
  state.requests[0].success('<p>Member A</p>');state.requests[0].complete();
  assert.equal(state.title,'Member B');assert.equal(state.body,'<p>Member B</p>');
  assert.deepEqual(state.events,['start','abort','show','end']);assert.deepEqual(state.alerts,[]);
});

test('old completion or timeout cannot stop the latest loading indicator or display an error',()=>{
  const state=ui();state.open('Member A','a');state.open('Member B','b');
  state.requests[0].error({status:0},'timeout');state.requests[0].complete();
  state.requests[0].success('');state.requests[0].complete();
  assert.deepEqual(state.events,['start','abort']);assert.deepEqual(state.alerts,[]);
  state.requests[1].error({status:503},'error');state.requests[1].complete();
  assert.deepEqual(state.events,['start','abort','end','alert']);
  state.open('Member C','c');state.requests[2].success('<form>Member C</form>');state.requests[2].complete();
  assert.equal(state.title,'Member C');assert.equal(state.body,'<form>Member C</form>');
});

test('request generation guard still works when the transport cannot abort',()=>{
  const state=ui(false);state.open('A','a');state.open('B','b');
  state.requests[1].success('<p>B</p>');state.requests[1].complete();
  state.requests[0].success('<p>A</p>');state.requests[0].complete();
  assert.equal(state.title,'B');assert.equal(state.body,'<p>B</p>');
  assert.deepEqual(state.events,['start','show','end']);
});

test('modal scripts that start another load cannot let the older callback show or finish it',()=>{
  const state=ui();state.open('A','a');
  state.onRender=()=>{state.onRender=null;state.open('B','b');};
  state.requests[0].success('<p>A</p>');state.requests[0].complete();
  assert.deepEqual(state.events,['start','abort']);
  state.requests[1].success('<p>B</p>');state.requests[1].complete();
  assert.equal(state.title,'B');assert.equal(state.body,'<p>B</p>');
  assert.deepEqual(state.events,['start','abort','show','end']);
});
