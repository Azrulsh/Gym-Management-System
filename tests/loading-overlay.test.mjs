import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const page=readFileSync(new URL('../index.php',import.meta.url),'utf8');
const source=page.slice(page.indexOf('  (function () {'),page.indexOf('  window.uni_modal'));
function ui(){
 const state={overlays:[],animations:[]};
 function wrap(elements){return {
  length:elements.length,
  stop(){for(const job of state.animations)if(elements.includes(job.element))job.cancelled=true;return this;},
  show(){for(const element of elements)element.visible=true;return this;},
  fadeOut(speed,callback){for(const element of elements)state.animations.push({element,callback,cancelled:false});return this;},
  remove(){state.overlays=state.overlays.filter(element=>!elements.includes(element));return this;},
 };}
 function $(selector){
  if(selector==='body')return {prepend(html){assert.equal(html,'<div id="preloader2"></div>');state.overlays.unshift({visible:true});}};
  if(selector==='#preloader2')return wrap(state.overlays.slice(0,1));
  return wrap([selector]);
 }
 const window={};vm.runInNewContext(source,{$,window});
 state.start=()=>window.start_load();state.end=()=>window.end_load();
 state.flush=()=>{const jobs=state.animations.splice(0);for(const job of jobs)if(!job.cancelled){job.element.visible=false;job.callback.call(job.element);}};
 return state;
}
test('two concurrent loads use one overlay and remove it only after both finish',()=>{
 const s=ui();s.start();s.start();assert.equal(s.overlays.length,1);
 s.end();s.flush();assert.equal(s.overlays.length,1);assert.equal(s.overlays[0].visible,true);
 s.end();s.flush();assert.equal(s.overlays.length,0);
});
test('the reported two-start two-end sequence leaves no overlay',()=>{
 const s=ui();s.start();s.start();s.end();s.end();s.flush();assert.equal(s.overlays.length,0);
});
test('a new load during fade-out cancels removal and reuses the visible overlay',()=>{
 const s=ui();s.start();s.end();s.start();s.flush();assert.equal(s.overlays.length,1);assert.equal(s.overlays[0].visible,true);
 s.end();s.flush();assert.equal(s.overlays.length,0);
});
test('a stale animation callback cannot remove the overlay for a later generation',()=>{
 const s=ui();s.start();s.end();const old=s.animations[0];s.start();
 old.callback.call(old.element);assert.equal(s.overlays.length,1);
 s.end();old.callback.call(old.element);assert.equal(s.overlays.length,1);
 s.flush();assert.equal(s.overlays.length,0);
});
test('extra end calls do not make the counter negative or break the next load',()=>{
 const s=ui();s.end();s.start();s.end();s.end();s.flush();assert.equal(s.overlays.length,0);
 s.start();assert.equal(s.overlays.length,1);s.end();s.flush();assert.equal(s.overlays.length,0);
});
test('a finished animation permits a clean overlay on the next load',()=>{
 const s=ui();s.start();s.end();s.flush();s.start();assert.equal(s.overlays.length,1);
 s.end();s.flush();assert.equal(s.overlays.length,0);
});
test('global permission handling does not release another requests loading state',()=>{
 const header=readFileSync(new URL('../header.php',import.meta.url),'utf8');
 const handler=header.slice(header.indexOf('$(document).ajaxError'),header.indexOf('</script>',header.indexOf('$(document).ajaxError')));
 const events=[];let callback;vm.runInNewContext(handler,{
  document:{},$:()=>({ajaxError(fn){callback=fn;}}),
  window:{end_load(){events.push('end');},alert(){events.push('alert');},location:{replace(){events.push('redirect');}}},
 });
 callback({}, {status:403});assert.deepEqual(events,['alert']);
 callback({}, {status:401});assert.deepEqual(events,['alert','redirect']);
});
