import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/plans.js', import.meta.url), 'utf8');
function ui(valid = true) {
  const state = { requests: [], disabled: false, stopped: 0, text: '', timers: [], toasts: [], fields: {} };
  state.labels = { '.plan-form-title': 'Add Plan', 'button[type="submit"]': 'Create', '.reset-plan': 'Clear' };
  const document = {};
  const handlers = {};
  const form = { dataset: {}, reportValidity: () => valid, reset() {
    state.fields = { id: '', plan: '', amount: '', version: '', csrf_token: 'plan-token' };
  } };
  form.reset();
  const edit = { attributes: { 'data-id': '2', 'data-plan': '6', 'data-amount': '120.50', 'data-version': '7' } };
  const message = {
    addClass() { return this; }, removeClass() { return this; },
    text(value) { state.text = value; return this; }, empty() { state.text = ''; return this; },
  };
  function $(target) {
    if (target === document) return { on(event, selector, handler) { handlers[selector] = handler; } };
    if (target === '#manage-plan') return { get() { return form; } };
    if (target === edit) return { attr(name) { return edit.attributes[name]; } };
    if (target === form) return {
      find(selector) {
        if (selector === '.plan-message') return message;
        if (!selector.startsWith('[name=')) return { text(value) { state.labels[selector] = value; } };
        const name = selector.match(/name="([^"]+)"/)[1];
        return { val(value) { state.fields[name] = value; }, trigger(event) { if (event === 'focus') state.focused = name; } };
      },
      attr() { return 'ajax.php?action=save_plan'; },
      serialize() { return new URLSearchParams(state.fields).toString(); },
    };
    return { prop(name, value) { state.disabled = value; } };
  }
  $.ajax = request => state.requests.push(request);
  const window = {
    start_load() {}, end_load() { state.stopped++; },
    alert_toast(text) { state.toasts.push(text); },
    setTimeout(callback) { state.timers.push(callback); }, location: { reload() {} },
  };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.submit = () => handlers['#manage-plan'].call(form, { preventDefault() {} });
  state.edit = () => handlers['.edit_plan'].call(edit);
  state.cancel = () => handlers['.reset-plan'].call({});
  return state;
}

test('Edit fills the selected plan and Cancel clears its ID while preserving CSRF', () => {
  const state = ui();
  assert.equal(state.labels['.plan-form-title'], 'Add Plan');
  state.edit();
  assert.equal(state.labels['.plan-form-title'], 'Edit Plan');
  assert.equal(state.labels['button[type="submit"]'], 'Update');
  assert.equal(state.labels['.reset-plan'], 'Cancel Edit');
  assert.equal(state.focused, 'plan');
  assert.deepEqual(state.fields, { id: '2', plan: '6', amount: '120.50', version: '7', csrf_token: 'plan-token' });
  state.cancel();
  assert.equal(state.labels['.plan-form-title'], 'Add Plan');
  assert.equal(state.labels['button[type="submit"]'], 'Create');
  assert.equal(state.labels['.reset-plan'], 'Clear');
  assert.deepEqual(state.fields, { id: '', plan: '', amount: '', version: '', csrf_token: 'plan-token' });
});

test('save posts selected fields and token once and prevents Edit/Cancel while submitting', () => {
  const state = ui();
  state.edit();
  state.submit(); state.submit(); state.cancel();
  assert.equal(state.requests.length, 1);
  assert.equal(state.fields.id, '2');
  assert.equal(state.disabled, true);
  const request = state.requests[0];
  assert.equal(request.url, 'ajax.php?action=save_plan');
  assert.equal(request.method, 'POST');
  assert.match(request.data, /id=2&plan=6&amount=120.50&version=7&csrf_token=plan-token/);
  request.success('1'); request.complete();
  assert.equal(state.stopped, 1);
  assert.equal(state.toasts[0], 'Plan successfully saved.');
  assert.equal(state.timers.length, 1);
  state.submit();
  assert.equal(state.requests.length, 1);
});

test('validation errors display as text, stop loading and allow correction', () => {
  const state = ui();
  state.submit();
  state.requests[0].error({ status: 400, responseJSON: { error: 'Amount is invalid. <test>' } });
  state.requests[0].complete();
  assert.equal(state.text, 'Amount is invalid. <test>');
  assert.equal(state.disabled, false);
  assert.equal(state.stopped, 1);
  state.submit();
  assert.equal(state.requests.length, 2);
});

test('network and unexpected HTML failures restore controls without leaking raw HTML', () => {
  for (const kind of ['network', 'html']) {
    const state = ui(); state.submit();
    const request = state.requests[0];
    if (kind === 'network') request.error({ status: 0 });
    else request.success('<b>Fatal error: SQL details</b>');
    request.complete();
    assert.equal(state.text, 'Unable to save plan. Please try again.');
    assert.equal(state.disabled, false);
    assert.equal(state.stopped, 1);
    assert.equal(state.timers.length, 0);
  }
});

test('invalid browser input never sends a request', () => {
  const state = ui(false); state.submit();
  assert.equal(state.requests.length, 0);
});

test("plans ui() state.submit() timeout restores controls and explains uncertain status", () => {
  const state=ui(); state.submit();
  const request=state.requests[0]; assert.equal(request.timeout,15000);
  request.error({responseText:'<b>Internal error</b>'},'timeout'); request.complete();
  assert.equal(state.disabled,false);
  assert.match(state.text,/status could not be confirmed/);
  assert.match(state.text,/Refresh/);
  assert.doesNotMatch(state.text,/<b>|Internal error/);
  assert.equal(state.requests.length,1);
  state.submit(); assert.equal(state.requests.length,2);
});
