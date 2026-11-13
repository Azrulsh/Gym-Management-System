import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/members.js', import.meta.url), 'utf8');

function ui(valid = true) {
  const state = { requests: [], messages: [], timers: [], stopped: 0, disabled: false, text: '' };
  const document = {};
  const form = { dataset: {}, reportValidity: () => valid };
  let submit;
  const message = {
    addClass() { return this; }, removeClass() { return this; },
    text(value) { state.text = value; return this; }, empty() { state.text = ''; return this; },
  };
  function $(target) {
    if (target === document) return { on(event, selector, handler) {
      assert.equal(event, 'submit');
      assert.equal(selector, '#manage-member-profile');
      submit = handler;
    } };
    if (target === form) return {
      find: () => message,
      serialize: () => 'firstname=Test&csrf_token=test-token',
    };
    return { prop(name, value) { state.disabled = value; } };
  }
  $.ajax = options => state.requests.push(options);
  const window = {
    start_load() {}, end_load() { state.stopped++; },
    alert_toast: (text, kind) => state.messages.push({ text, kind }),
    setTimeout: callback => state.timers.push(callback), location: { reload() {} },
  };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.submit = () => submit.call(form, { preventDefault() {} });
  return state;
}

test('profile form posts serialized fields and token once, then reloads on success', () => {
  const state = ui();
  state.submit();
  state.submit();
  assert.equal(state.requests.length, 1);
  const request = state.requests[0];
  assert.equal(request.url, 'ajax.php?action=save_member');
  assert.equal(request.method, 'POST');
  assert.match(request.data, /csrf_token=test-token/);
  assert.equal(state.disabled, true);
  request.success('1');
  request.complete();
  assert.equal(state.disabled, false);
  assert.equal(state.stopped, 1);
  assert.equal(state.messages[0].kind, 'success');
  assert.equal(state.timers.length, 1);
  state.submit();
  assert.equal(state.requests.length, 1, 'do not submit the saved form again before reload');
});

test('duplicate ID or validation errors are displayed as text and the form can be corrected', () => {
  const state = ui();
  state.submit();
  const request = state.requests[0];
  request.error({ status: 409, responseJSON: { error: 'ID No. already exists. <test>' } });
  request.complete();
  assert.equal(state.text, 'ID No. already exists. <test>');
  assert.equal(state.disabled, false);
  assert.equal(state.stopped, 1);
  assert.equal(state.timers.length, 0);
  state.submit();
  assert.equal(state.requests.length, 2);
});

test('network failures and unexpected responses stop loading without showing raw HTML', () => {
  for (const mode of ['network', 'response']) {
    const state = ui();
    state.submit();
    const request = state.requests[0];
    if (mode === 'network') request.error({ status: 0 });
    else request.success('<b>Fatal error: database details</b>');
    request.complete();
    assert.equal(state.text, 'Unable to save member. Please try again.');
    assert.equal(state.disabled, false);
    assert.equal(state.stopped, 1);
    assert.equal(state.timers.length, 0);
  }
});

test('invalid browser fields never start a save request', () => {
  const state = ui(false);
  state.submit();
  assert.equal(state.requests.length, 0);
  assert.equal(state.disabled, false);
});
