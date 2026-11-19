import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/user-delete.js', import.meta.url), 'utf8');
function ui(self = false) {
  const state = { requests: [], events: [], text: '', password: '', html: '', disabled: false };
  const document = {}, link = {};
  let click;
  const element = {
    removeClass() { return this; }, addClass() { return this; }, empty() { state.text = ''; return this; },
    text(value) { state.text = value; return this; }, append(value) { state.html += value; return this; },
    val(value) { if (value === undefined) return state.password; state.password = value; return this; },
    prop(name, value) { state.disabled = value; return this; }, modal() { state.events.push('hide'); },
  };
  function $(target) {
    if (target === document) return { on(event, selector, callback) { click = callback; } };
    if (target === link) return { attr(name) { return { 'data-id': '2', 'data-self': self ? '1' : '0', 'data-csrf-token': 'token' }[name]; } };
    return element;
  }
  $.ajax = request => state.requests.push(request);
  const window = {
    _conf() {}, start_load() { state.events.push('start'); }, end_load() { state.events.push('end'); },
    alert_toast() { state.events.push('toast'); }, setTimeout(callback) { callback(); },
    location: { replace(url) { state.events.push(url); }, reload() { state.events.push('reload'); } },
  };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.click = () => click.call(link);
  state.confirm = () => window.delete_user(2);
  return state;
}
test('self deletion shows a masked password field and requires input before submitting', () => {
  const state = ui(true); state.click(); state.confirm();
  assert.match(state.html, /type="password"/);
  assert.match(state.text, /current password/);
  assert.equal(state.requests.length, 0);
  state.password = 'correct'; state.confirm(); state.confirm();
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].data.password, 'correct');
  assert.equal(state.requests[0].data.csrf_token, 'token');
  state.requests[0].success({ deleted: true, self_deleted: true });
  state.requests[0].complete();
  assert.equal(state.password, '');
  assert.ok(state.events.includes('login.php'));
});
test('deleting another user posts CSRF and reloads after success', () => {
  const state = ui(); state.click(); state.confirm(); state.confirm();
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].method, 'POST');
  assert.equal(state.requests[0].url, 'ajax.php?action=delete_user');
  assert.equal(state.requests[0].data.csrf_token, 'token');
  state.requests[0].success('1'); state.requests[0].complete();
  assert.deepEqual(state.events, ['start', 'hide', 'toast', 'reload', 'end']);
});
for (const failure of ['last admin', 'network', 'unexpected']) {
  test(`${failure} rejection explains failure, stops loading and allows retry`, () => {
    const state = ui(); state.click(); state.confirm();
    if (failure === 'unexpected') state.requests[0].success('<b>SQL error</b>');
    else state.requests[0].error(failure === 'last admin' ? { responseJSON: { error: 'Cannot delete the last Admin.' } } : {});
    state.requests[0].complete();
    assert.match(state.text, failure === 'last admin' ? /last Admin/ : /Unable to delete/);
    assert.equal(state.disabled, false);
    assert.deepEqual(state.events, ['start', 'end']);
    state.confirm(); assert.equal(state.requests.length, 2);
  });
}

test("user-delete ui(false) state.click(); state.confirm() timeout restores controls and explains uncertain status", () => {
  const state=ui(false); state.click(); state.confirm();
  const request=state.requests[0]; assert.equal(request.timeout,15000);
  request.error({responseText:'<b>Internal error</b>'},'timeout'); request.complete();
  assert.equal(state.disabled,false);
  assert.match(state.text,/status could not be confirmed/);
  assert.match(state.text,/Refresh/);
  assert.doesNotMatch(state.text,/<b>|Internal error/);
  assert.equal(state.requests.length,1);
  state.confirm(); assert.equal(state.requests.length,2);
});

test("user-delete ui(true) state.click(); state.password='secret'; state.confirm() timeout restores controls and explains uncertain status", () => {
  const state=ui(true); state.click(); state.password='secret'; state.confirm();
  const request=state.requests[0]; assert.equal(request.timeout,15000);
  request.error({responseText:'<b>Internal error</b>'},'timeout'); request.complete();
  assert.equal(state.disabled,false);
  assert.match(state.text,/status could not be confirmed/);
  assert.match(state.text,/Refresh/);
  assert.doesNotMatch(state.text,/<b>|Internal error/);
  assert.equal(state.requests.length,1);
  state.password='secret'; state.confirm(); assert.equal(state.requests.length,2);
});
