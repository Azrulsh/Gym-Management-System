import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/membership.js', import.meta.url), 'utf8');

function ui() {
  const state = { requests: [], confirmations: [], messages: [], timers: [], disabled: false, endedLoading: 0 };
  const document = {};
  let click;
  function $(target) {
    if (target === document) {
      return { on(event, selector, handler) {
        assert.equal(event, 'click');
        assert.equal(selector, '.end-membership');
        click = handler;
      } };
    }
    if (typeof target === 'object') return { attr: name => target[name] };
    return {
      prop(name, value) { state.disabled = value; },
      modal(action) { state.hidden = action === 'hide'; },
    };
  }
  $.ajax = options => state.requests.push(options);
  const window = {
    _conf: (...args) => state.confirmations.push(args),
    start_load() {},
    end_load() { state.endedLoading++; },
    alert_toast: (message, kind) => state.messages.push({ message, kind }),
    setTimeout: callback => state.timers.push(callback),
    location: { reload() {} },
  };
  vm.runInNewContext(source, { jQuery: $, document, window });
  state.click = (id, token = 'csrf-test') => click.call({ 'data-registration-id': id, 'data-csrf-token': token });
  state.confirm = id => window.end_membership(id);
  return state;
}

test('confirmation sends the selected registration ID to end_membership, never delete_member', () => {
  const state = ui();
  state.click('9');
  assert.equal(state.requests.length, 0, 'opening or cancelling confirmation must not send a request');
  assert.equal(state.confirmations[0][1], 'end_membership');
  assert.equal(state.confirmations[0][2][0], 9);
  state.confirm(9);
  state.confirm(9);
  assert.equal(state.requests.length, 1, 'prevent duplicate submits while the first request is running');
  const request = state.requests[0];
  assert.equal(request.url, 'ajax.php?action=end_membership');
  assert.equal(request.method, 'POST');
  assert.equal(request.data.rid, 9);
  assert.equal(request.data.csrf_token, 'csrf-test');
  assert.equal(request.data.id, undefined);
  assert.equal(state.disabled, true);
  request.success('1');
  request.complete();
  assert.equal(state.disabled, false);
  assert.equal(state.hidden, true);
  assert.equal(state.messages[0].kind, 'success');
  assert.equal(state.timers.length, 1);
});

test('a conflict displays an error and restores the confirmation button', () => {
  const state = ui();
  state.click('9');
  state.confirm(9);
  const request = state.requests[0];
  request.error({ status: 409 });
  request.complete();
  assert.equal(state.disabled, false);
  assert.equal(state.endedLoading, 1);
  assert.match(state.messages[0].message, /already ended/);
  assert.equal(state.messages[0].kind, 'danger');
  assert.equal(state.timers.length, 0);
});

test('invalid IDs and missing tokens cannot open a confirmation or submit', () => {
  const state = ui();
  for (const id of ['9 OR 1=1', '', '0', '-1']) state.click(id);
  state.click('9', '');
  state.confirm(9);
  assert.equal(state.confirmations.length, 0);
  assert.equal(state.requests.length, 0);
});

test("membership ui() state.click('9'); state.confirm(9) timeout restores controls and explains uncertain status", () => {
  const state=ui(); state.click('9'); state.confirm(9);
  const request=state.requests[0]; assert.equal(request.timeout,15000);
  request.error({responseText:'<b>Internal error</b>'},'timeout'); request.complete();
  assert.equal(state.disabled,false);
  assert.match(state.messages.at(-1).message,/status could not be confirmed/);
  assert.match(state.messages.at(-1).message,/Refresh/);
  assert.doesNotMatch(state.messages.at(-1).message,/<b>|Internal error/);
  assert.equal(state.requests.length,1);
  state.confirm(9); assert.equal(state.requests.length,2);
});
