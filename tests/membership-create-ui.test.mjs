import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/membership-create.js', import.meta.url), 'utf8');
function ui(valid = true) {
  const state = { requests: [], disabled: false, stopped: 0, text: '', timers: [] };
  const document = {};
  const form = { dataset: {}, reportValidity: () => valid };
  const message = {
    addClass() { return this; }, removeClass() { return this; },
    text(value) { state.text = value; return this; }, empty() { state.text = ''; return this; },
  };
  let submit;
  function $(target) {
    if (target === document) return { on(event, selector, handler) { assert.equal(selector, '#manage-member'); submit = handler; } };
    if (target === '#uni_modal #submit') return { prop(name, value) { state.disabled = value; } };
    return {
      find: () => message, attr: () => 'ajax.php?action=save_membership',
      serialize: () => 'member_id=9&plan_id=1&package_id=1&trainer_id=&csrf_token=token',
    };
  }
  $.ajax = options => state.requests.push(options);
  const window = {
    start_load() {}, end_load() { state.stopped++; }, alert_toast() { state.success = true; },
    setTimeout(callback) { state.timers.push(callback); }, location: { reload() {} },
  };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.submit = () => submit.call(form, { preventDefault() {} });
  return state;
}

test('membership submits once with CSRF and disables the modal Save button', () => {
  const state = ui(); state.submit(); state.submit();
  assert.equal(state.requests.length, 1);
  const request = state.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'ajax.php?action=save_membership');
  assert.match(request.data, /csrf_token=token/);
  assert.equal(state.disabled, true);
  request.success('1'); request.complete();
  assert.equal(state.success, true);
  assert.equal(state.stopped, 1);
  assert.equal(state.timers.length, 1);
  state.submit();
  assert.equal(state.requests.length, 1);
});

test('stale form conflict explains why it failed and restores the Save button', () => {
  const state = ui(); state.submit();
  const request = state.requests[0];
  request.error({ status: 409, responseJSON: { error: 'This member already has an active membership. Refresh the page before continuing.' } });
  request.complete();
  assert.match(state.text, /already has an active membership/);
  assert.equal(state.disabled, false);
  assert.equal(state.stopped, 1);
  assert.equal(state.timers.length, 0);
  state.submit();
  assert.equal(state.requests.length, 2);
});

test('network and raw server failures stop loading without exposing HTML', () => {
  for (const kind of ['network', 'html']) {
    const state = ui(); state.submit();
    const request = state.requests[0];
    if (kind === 'network') request.error({ status: 0, responseText: '<b>SQL details</b>' });
    else request.success('<b>SQL details</b>');
    request.complete();
    assert.equal(state.text, 'Unable to save membership. Please try again.');
    assert.equal(state.disabled, false);
    assert.equal(state.stopped, 1);
  }
});

test('invalid browser input never submits', () => {
  const state = ui(false); state.submit();
  assert.equal(state.requests.length, 0);
});
