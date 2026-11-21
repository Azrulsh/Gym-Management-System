import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../assets/js/media-viewer.js',import.meta.url),'utf8');
function ui(){
 const handlers={},timers=new Map(),images=[];let sequence=0;
 function element(){return {dataset:{},hidden:false,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},addEventListener(k,v){this[k]=v;}};}
 const content=element(),status=element(),title=element(),retry=element(),modal=element();
 content.replaceChildren=()=>{content.children=[];};content.append=i=>{content.children.push(i);};content.children=[];
 const nodes={'[data-media-content]':content,'#media-viewer-status':status,'#media-viewer-title':title,'[data-media-retry]':retry};modal.querySelector=s=>nodes[s];
 const trigger={isConnected:true,disabled:false,focus(){this.focused=true;}};
 const document={baseURI:'https://gym.test/Gym-Management-System/index.php',activeElement:trigger,getElementById:()=>modal,createElement(tag){assert.equal(tag,'img');const i=element();images.push(i);return i;},addEventListener(k,v){handlers[k]=v;}};
 const wrapper={modal(options){assert.equal(options.keyboard,true);assert.equal(options.backdrop,true);},on(name,callback){handlers[name]=callback;return this;}};
 const window={};vm.runInNewContext(source,{document,window,location:{origin:'https://gym.test'},URL,jQuery:()=>wrapper,setTimeout(fn){timers.set(++sequence,fn);return sequence;},clearTimeout(id){timers.delete(id);}});
 return {window,content,status,title,retry,images,handlers,timers,trigger};
}
test('legacy helper displays an authorized image after load, without parsing HTML',()=>{
 const s=ui();s.window.viewer_modal('attendance_avatar.php?id=9','<b>Identity</b>');
 assert.equal(s.title.textContent,'<b>Identity</b>');assert.equal(s.images[0].alt,'<b>Identity</b>');assert.equal(s.images[0].hidden,true);assert.match(s.status.textContent,/Loading/);
 s.images[0].onload();assert.equal(s.images[0].hidden,false);assert.equal(s.status.textContent,'');assert.equal(s.timers.size,0);
});
for(const url of ['https://evil.test/pic.jpg','//evil.test/a','javascript:alert(1)','data:image/svg+xml,unsafe','blob:https://gym.test/arbitrary','member_avatar.php?id=2','attendance_avatar.php?id=1&id=2','branding_image.php?kind=logo&v=1&extra=1','assets/img/../../login.php',"attendance_avatar.php?id=1' onerror='unsafe"]){
 test('rejects unapproved media source '+url,()=>{const s=ui();s.window.viewer_modal(url);assert.equal(s.images.length,0);assert.match(s.status.textContent,/unavailable/);assert.equal(s.retry.hidden,true);});
}
for(const url of ['member_avatar.php','attendance_avatar.php?id=1','branding_image.php?kind=cover&v=2','assets/img/gym-logo.svg','assets/img/img.jpg'])test('permits application source '+url,()=>{const s=ui();s.window.viewer_modal(url);assert.equal(s.images.length,1);});
test('failed image and timeout expose retry; retry starts a new isolated request',()=>{
 const s=ui();s.window.viewer_modal('member_avatar.php');s.images[0].onerror();assert.equal(s.content.children.length,0);assert.equal(s.retry.hidden,false);assert.match(s.status.textContent,/Unable/);
 s.retry.click();assert.equal(s.images.length,2);assert.equal(s.retry.hidden,true);[...s.timers.values()][0]();assert.match(s.status.textContent,/too long/);assert.equal(s.retry.hidden,false);
});
test('switching media rejects late callbacks and closing clears the image then restores focus',()=>{
 const s=ui();s.window.viewer_modal('member_avatar.php');const stale=s.images[0].onload;
 s.window.viewer_modal('assets/img/img.jpg');stale();assert.match(s.status.textContent,/Loading/);assert.equal(s.images[1].hidden,true);
 const late=s.images[1].onerror;s.handlers['hide.bs.modal']();late();assert.equal(s.content.children.length,0);assert.equal(s.status.textContent,'');assert.equal(s.timers.size,0);
 s.handlers['hidden.bs.modal']();assert.equal(s.trigger.focused,true);
});
test('Settings object URL must be registered and revoking it cancels its active preview',()=>{
 const s=ui(),url='blob:https://gym.test/selected-file';s.window.mediaViewerPreviews.register(url);s.window.viewer_modal(url);assert.equal(s.images.length,1);
 s.window.mediaViewerPreviews.release(url);assert.equal(s.content.children.length,0);assert.match(s.status.textContent,/preview changed/);assert.equal(s.retry.hidden,true);
 s.window.viewer_modal(url);assert.equal(s.images.length,1);
});
test('preview registration cannot authorize scripts or external URLs',()=>{
 const s=ui();for(const url of ['javascript:alert(1)','https://evil.test/image.png','blob:https://evil.test/image']){s.window.mediaViewerPreviews.register(url);s.window.viewer_modal(url);}
 assert.equal(s.images.length,0);
});
