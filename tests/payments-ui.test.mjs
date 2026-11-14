import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/payments.js', import.meta.url), 'utf8');
function ui(valid = true) {
  const state = { requests: [], events: [], disabled: false, text: '' };
  const document = {};
  const form = { dataset: {}, reportValidity: () => valid };
  let submit;
  const message = {
    addClass() { return this; }, removeClass() { return this; },
    text(value) { state.text = value; return this; }, empty() { state.text = ''; return this; },
  };
  const button = { prop(name, value) { state.disabled = value; } };
  function $(target) {
    if (target === document) return { on(event, selector, handler) { assert.equal(selector, '#manage_payment'); submit = handler; } };
    return {
      find(selector) { return selector === '.payment-message' ? message : selector.startsWith('[name=') ? { val: () => '9' } : button; },
      attr: () => 'ajax.php?action=save_payment',
      serialize: () => 'registration_id=9&amount=10.25&remarks=Test&csrf_token=token',
    };
  }
  $.ajax = options => state.requests.push(options);
  const window = {
    start_load() { state.events.push('start'); }, end_load() { state.events.push('end'); },
    alert_toast() { state.events.push('toast'); },
    uni_modal(title, url, size) { state.events.push('modal'); state.modal = { title, url, size }; },
  };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.submit = () => submit.call(form, { preventDefault() {} });
  return state;
}

test('payment posts once with token and refreshes the same modal only after stopping loading', () => {
  const state = ui(); state.submit(); state.submit();
  assert.equal(state.requests.length, 1);
  assert.equal(state.disabled, true);
  const request = state.requests[0];
  assert.equal(request.url, 'ajax.php?action=save_payment');
  assert.equal(request.method, 'POST');
  assert.match(request.data, /csrf_token=token/);
  request.success('1'); request.complete();
  assert.deepEqual(state.events, ['start', 'end', 'toast', 'modal']);
  assert.deepEqual(state.modal, { title: 'Payments', url: 'payment.php?rid=9', size: 'large' });
  state.submit();
  assert.equal(state.requests.length, 1);
});

test('server validation errors are shown as text and allow correction', () => {
  const state = ui(); state.submit();
  state.requests[0].error({ status: 400, responseJSON: { error: 'Invalid amount. <test>' } });
  state.requests[0].complete();
  assert.equal(state.text, 'Invalid amount. <test>');
  assert.equal(state.disabled, false);
  assert.deepEqual(state.events, ['start', 'end']);
  state.submit();
  assert.equal(state.requests.length, 2);
});

test('network failures and raw SQL errors stop loading without leaking HTML', () => {
  for (const mode of ['network', 'html']) {
    const state = ui(); state.submit();
    if (mode === 'network') state.requests[0].error({ status: 0, responseText: '<b>Fatal error: SQL</b>' });
    else state.requests[0].success('<b>Fatal error: SQL</b>');
    state.requests[0].complete();
    assert.equal(state.text, 'Unable to save payment. Please try again.');
    assert.equal(state.disabled, false);
    assert.deepEqual(state.events, ['start', 'end']);
  }
});

test('invalid browser input cannot submit', () => {
  const state = ui(false); state.submit();
  assert.equal(state.requests.length, 0);
});
