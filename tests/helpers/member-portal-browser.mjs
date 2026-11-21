import assert from 'node:assert/strict';
import {eventsBrowserSmoke} from './events-browser.mjs';

export async function memberPortalBrowserSmoke(base,folder) {
 return eventsBrowserSmoke(base,folder,async({command,evaluate,until,navigate,login})=>{
  await login('admin');await navigate('index.php?page=portal_accounts');
  await evaluate("window.confirm=()=>true;const form=Array.from(document.querySelectorAll('form[data-portal-form]')).find(f=>f.querySelector('[name=member_id]')?.value==='10' && f.querySelector('[name=purpose]')?.value==='activate');form.requestSubmit()");
  await until("!!document.querySelector('[aria-label=\"Private activation or recovery link\"]')");
  const activation=await evaluate("document.querySelector('[aria-label=\"Private activation or recovery link\"]').value");
  assert.match(activation,/activate_member\.php#token=[a-f0-9]{64}$/);
  await command('Network.clearBrowserCookies');
  await command('Page.navigate',{url:activation});
  await until("!!document.querySelector('[name=token]') && document.querySelector('[name=token]').value.length===64 && location.hash===''");
  const password='Browser member passphrase!';
  await evaluate(`document.querySelector('[name=username]').value='browser_member';document.querySelector('[name=password]').value=${JSON.stringify(password)};document.querySelector('[name=password_confirm]').value=${JSON.stringify(password)};document.querySelector('[data-portal-form]').requestSubmit()`);
  await until("location.pathname.endsWith('login.php') && !!document.querySelector('#login-form')");
  await evaluate(`document.querySelector('[name=username]').value='browser_member';document.querySelector('[name=password]').value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit()`);
  await until("location.pathname.endsWith('member_portal.php') && document.body.innerText.includes('Aina')");
  assert.equal(await evaluate("!!document.querySelector('#sidebar') && !!document.querySelector('main#view-panel') && !!document.querySelector('.navbar.fixed-top.bg-success')"),true);
  assert.equal(await evaluate("!!document.querySelector('#sidebar a[href*=\"index.php\"]')"),false);
  await evaluate("document.querySelector('#sidebar .nav-profile').click()");
  await until("location.search==='?page=profile' && !!document.querySelector('[name=contact]')");
  await evaluate("document.querySelector('[name=contact]').value='0123456789';document.querySelector('form[action*=portal_profile]').requestSubmit()");
  await until("!!document.querySelector('[name=version]') && document.querySelector('[name=version]').value==='2'");
  assert.equal(await evaluate("document.querySelector('[name=contact]').value"),'0123456789');
  await navigate('member_portal.php?page=payments');assert.doesNotMatch(await evaluate('document.body.innerText'),/PRIVATE_MEMBER_A|PRIVATE_MEMBER_B/);
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await navigate('member_portal.php?page=profile');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
  await navigate('index.php?page=home');assert.match(await evaluate('document.body.innerText'),/Access denied/);
  await navigate('member_portal.php');
  await evaluate("document.querySelector('#account_settings').click();document.querySelector('form[action*=portal_logout] button').click()");
  await until("location.pathname.endsWith('login.php') && !!document.querySelector('#login-form')");
  return ['Admin invitation','Fragment token scrubbed','Activation','Member login and shared shell','Sidebar and profile update','Payment ownership','Mobile layout','Operations denied','Topbar logout'];
 });
}
