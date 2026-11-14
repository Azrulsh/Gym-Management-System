import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/schedules.js', import.meta.url), 'utf8');
function ui(values = {}) {
  const state = { requests: [], events: [], text: '', disabled: false };
  const document = {};
  const form = { dataset: {}, reportValidity: () => true, elements: {
    'dow[]': { selectedOptions: [1] }, date_from: { value: '2026-02' }, date_to: { value: '2026-02' },
    time_from: { value: '09:00' }, time_to: { value: '10:00' }, ...values,
  } };
  let handler;
  const message = {
    removeClass() { return this; }, addClass() { return this; },
    empty() { state.text = ''; return this; }, text(value) { state.text = value; return this; },
  };
  function $(target) {
    if (target === document) return { on(event, selector, callback) { if (event === 'submit') handler = callback; } };
    if (target === form) return { find: () => message, attr: () => 'ajax.php?action=save_schedule', serialize: () => 'form-data' };
    return { prop(name, value) { state.disabled = value; } };
  }
  $.ajax = request => state.requests.push(request);
  const window = {
    start_load() { state.events.push('start'); }, end_load() { state.events.push('end'); },
    alert_toast() { state.events.push('toast'); }, setTimeout(callback) { callback(); },
    location: { reload() { state.events.push('reload'); } },
  };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.submit = () => handler.call(form, { preventDefault() {} });
  return state;
}

for (const [name, fields, message] of [
  ['no days', { 'dow[]': { selectedOptions: [] } }, /at least one/],
  ['reversed months', { date_to: { value: '2026-01' } }, /Month To/],
  ['reversed times', { time_to: { value: '08:00' } }, /Time To/],
  ['equal times', { time_to: { value: '09:00:00' } }, /Time To/],
]) {
  test(`form explains ${name} before sending any request`, () => {
    const state = ui(fields); state.submit();
    assert.equal(state.requests.length, 0);
    assert.match(state.text, message);
    assert.deepEqual(state.events, []);
  });
}

test('schedule submits once and reloads on success', () => {
  const state = ui(); state.submit(); state.submit();
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].method, 'POST');
  assert.equal(state.requests[0].url, 'ajax.php?action=save_schedule');
  state.requests[0].success('1'); state.requests[0].complete(); state.submit();
  assert.equal(state.requests.length, 1);
  assert.deepEqual(state.events, ['start', 'toast', 'reload', 'end']);
});

for (const type of ['validation', 'network', 'unexpected']) {
  test(`${type} failure stops loading, restores save and permits retry`, () => {
    const state = ui(); state.submit();
    if (type === 'unexpected') state.requests[0].success('<b>SQL error</b>');
    else state.requests[0].error(type === 'validation' ? { responseJSON: { error: 'Choose at least one schedule day.' } } : { responseText: '<b>SQL error</b>' });
    state.requests[0].complete();
    assert.equal(state.disabled, false);
    assert.doesNotMatch(state.text, /<b>|SQL error/);
    assert.match(state.text, type === 'validation' ? /at least one/ : /Unable to save schedule/);
    assert.deepEqual(state.events, ['start', 'end']);
    state.submit(); assert.equal(state.requests.length, 2);
  });
}
