// Optional real-browser smoke; no npm dependencies. Uses an isolated Chromium profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

export async function eventsBrowserSmoke(base,folder,customSmoke=null) {
 const executable=process.env.GYM_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 assert.ok(fs.existsSync(executable),'Set GYM_TEST_BROWSER to a Chromium browser executable.');
 const profile=path.join(folder,'browser-profile');
 const browserProcess=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let socket;
 try {
  const portFile=path.join(profile,'DevToolsActivePort');
  let port;
  for(let i=0;i<200&&!port;i++) {
   try { const contents=fs.readFileSync(portFile,'utf8'); if(/^\d+\r?\n/.test(contents)) port=contents.split('\n')[0].trim(); }
   catch(error) { if(!['ENOENT','EBUSY'].includes(error.code)) throw error; }
   if(!port) await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(port,'Browser did not start.');
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
  const target=targets.find(t=>t.type==='page');assert.ok(target);
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let sequence=0;const pending=new Map();const browserErrors=[];
  socket.onmessage=event=>{const response=JSON.parse(event.data);if(response.method==='Runtime.exceptionThrown')browserErrors.push(response.params.exceptionDetails.text+': '+(response.params.exceptionDetails.exception?.description||''));if(response.method==='Network.responseReceived'&&(/login\.js|action=login/.test(response.params.response.url)))browserErrors.push(response.params.response.status+' '+response.params.response.url);const pair=pending.get(response.id);if(pair){pending.delete(response.id);response.error?pair.reject(Error(JSON.stringify(response.error))):pair.resolve(response.result)}};
  function command(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method+' '+JSON.stringify(params).slice(0,180)))},8000);pending.set(id,{resolve(value){clearTimeout(timer);resolve(value)},reject(error){clearTimeout(timer);reject(error)}});socket.send(JSON.stringify({id,method,params}))})}
  async function evaluate(expression){const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
  async function until(expression){for(let i=0;i<160;i++){try{if(await evaluate(expression))return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Browser condition failed: '+expression+'\n'+await evaluate('document.body.innerText')+'\n'+JSON.stringify(browserErrors)+'\n'+await evaluate("JSON.stringify({valid:document.querySelector('#login-form')?.checkValidity(),submitting:document.querySelector('#login-form')?.dataset.submitting,filled:Array.from(document.querySelectorAll('#login-form input')).map(i=>({name:i.name,filled:!!i.value,valid:i.validity.valid})),handlers:window.jQuery?Object.keys(jQuery._data(document,'events')||{}):[]})"));}
  async function navigate(url){await command('Page.navigate',{url:base+url});await until("document.readyState==='complete' && location.href==="+JSON.stringify(base+url));}
  async function login(user){await navigate('login.php');await until("typeof window.jQuery==='function' && !!document.querySelector('#login-form')");await evaluate(`document.querySelector('#username').value=${JSON.stringify(user)};document.querySelector('#password').value=${JSON.stringify(user)};document.querySelector('#login-form').requestSubmit()`);await until("location.search.includes('page=home') || (!!document.querySelector('#sidebar') && !location.pathname.endsWith('login.php'))");}
  await command('Page.enable');await command('Network.enable');await command('Runtime.enable');
  if(customSmoke) return await customSmoke({command,evaluate,until,navigate,login});
  await login('admin');await navigate('index.php?page=events');
  assert.equal(await evaluate("!!document.querySelector('a[href=\"index.php?page=manage_event\"]')"),true);
  await navigate('index.php?page=manage_event');
  const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  await evaluate(`document.querySelector('[name=title]').value="Browser Fitness Event";document.querySelector('[name=location]').value="Studio B";document.querySelector('[name=starts_at]').value=${JSON.stringify(date+'T12:00')};document.querySelector('[name=ends_at]').value=${JSON.stringify(date+'T14:00')};document.querySelector('[name=capacity]').value='2';document.querySelector('[name=status]').value='published';document.querySelector('form[data-event-editor]').requestSubmit()`);
  await until("location.search.includes('page=view_event') && document.body.innerText.includes('Browser Fitness Event')");
  const viewUrl=await evaluate("location.pathname.split('/').pop()+location.search");
  await until("!!document.querySelector('#event-member')");
  await evaluate("document.querySelector('#event-member').value='1';document.querySelector('#event-member').form.requestSubmit()");
  await until("!!document.querySelector('#event-participants tbody tr form') && document.body.innerText.includes('Ali')");
  assert.match(await evaluate("document.querySelector('#event-participants').innerText"),/Registered/);
  await evaluate("window.confirm=()=>true;document.querySelector('#event-participants tbody tr form').requestSubmit()");
  await until("document.querySelector('#event-participants').innerText.includes('Cancelled')");
  await evaluate("document.querySelector('#event-member').value='1';document.querySelector('#event-member').form.requestSubmit()");
  await until("document.querySelector('#event-participants').innerText.includes('Registered')");
  await navigate('index.php?page=events');
  await evaluate("document.querySelector('#event-filter').value='Draft';document.querySelector('#event-filter').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("$('#events-table').DataTable().rows({search:'applied'}).data().toArray().every(row=>row[3]==='Draft')"),true);
  await command('Network.clearBrowserCookies');await login('staff');await navigate(viewUrl);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('a')).some(a=>a.textContent==='Edit Event')"),false);
  assert.equal(await evaluate("!!document.querySelector('#event-member')"),true);
  await navigate('index.php?page=manage_event');assert.match(await evaluate('document.body.innerText'),/Access denied/);
  return ['Admin navigation','Create Event','Register member','Cancel and re-register','DataTables status filter','Staff participation view','Staff editor denied'];
 } finally {
  if(socket?.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify({id:999999,method:'Browser.close'}))}catch{}socket.close();}
  if(browserProcess.exitCode===null){await new Promise(resolve=>{browserProcess.once('exit',resolve);setTimeout(()=>{browserProcess.kill();resolve()},2000).unref()});}
 }
}
