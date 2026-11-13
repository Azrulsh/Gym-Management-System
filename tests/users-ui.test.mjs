import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/users.js', import.meta.url), 'utf8');

function ui(action = 'save_user', valid = true) {
  const state = { requests: [], messages: [], timers: [], disabled: false, stopped: 0, text: '' };
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
      assert.equal(selector, '#manage-user');
      submit = handler;
    } };
    if (target === form) return {
      find: () => message,
      attr: () => `ajax.php?action=${action}`,
      serialize: () => 'username=test&csrf_token=test-token',
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

for (const action of ['save_user', 'save_account']) {
  test(`${action} uses its own action URL, includes CSRF and prevents duplicate submission`, () => {
    const state = ui(action);
    state.submit();
    state.submit();
    assert.equal(state.requests.length, 1);
    const request = state.requests[0];
    assert.equal(request.url, `ajax.php?action=${action}`);
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
    assert.equal(state.requests.length, 1);
  });
}

test('server validation and duplicate errors are rendered as text and allow correction', () => {
  const state = ui();
  state.submit();
  const request = state.requests[0];
  request.error({ status: 409, responseJSON: { error: 'Username already exists. <test>' } });
  request.complete();
  assert.equal(state.text, 'Username already exists. <test>');
  assert.equal(state.disabled, false);
  assert.equal(state.stopped, 1);
  assert.equal(state.timers.length, 0);
  state.submit();
  assert.equal(state.requests.length, 2);
});

test('own-account numeric duplicate responses remain supported', () => {
  const state = ui('save_account');
  state.submit();
  state.requests[0].success('2');
  state.requests[0].complete();
  assert.equal(state.text, 'Username already exists.');
  assert.equal(state.disabled, false);
  assert.equal(state.timers.length, 0);
});

test('network errors and unexpected HTML responses stop loading without exposing raw output', () => {
  for (const mode of ['network', 'response']) {
    const state = ui();
    state.submit();
    const request = state.requests[0];
    if (mode === 'network') request.error({ status: 0 });
    else request.success('<b>Fatal error: SQL details</b>');
    request.complete();
    assert.match(state.text, /^Unable to save user\./);
    assert.doesNotMatch(state.text, /<b>|SQL details/);
    assert.equal(state.disabled, false);
    assert.equal(state.stopped, 1);
  }
});

test('invalid browser fields never start a save request', () => {
  const state = ui('save_user', false);
  state.submit();
  assert.equal(state.requests.length, 0);
});
