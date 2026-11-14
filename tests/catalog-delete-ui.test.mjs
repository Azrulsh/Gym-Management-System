import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/catalog-delete.js', import.meta.url), 'utf8');
function ui() {
  const state = { requests: [], disabled: false, stopped: 0, text: '', timers: [], hidden: false };
  const document = {};
  const handlers = {};
  const message = {
    addClass() { return this; }, removeClass() { return this; },
    text(value) { state.text = value; return this; }, empty() { state.text = ''; return this; },
  };
  function $(target) {
    if (target === document) return { on(event, selector, handler) { handlers[selector] = handler; } };
    if (typeof target === 'object') return { attr: name => name === 'data-id' ? target.id : target.token };
    if (target.includes('catalog-delete-message')) return message;
    if (target === '#confirm_modal .modal-body') return { append(markup) { assert.match(markup, /role="alert"/); } };
    if (target === '#confirm_modal') return { modal(action) { state.hidden = action === 'hide'; } };
    return { prop(name, value) { state.disabled = value; } };
  }
  $.ajax = request => state.requests.push(request);
  const window = {
    _conf(text, callback, params) { state.confirmation = { text, callback, params }; },
    start_load() {}, end_load() { state.stopped++; }, alert_toast() { state.success = true; },
    setTimeout(callback) { state.timers.push(callback); }, location: { reload() {} },
  };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.open = (kind, id = '2', token = 'test-token') => handlers['.delete_' + kind].call({ id, token });
  state.confirm = (kind, id = 2) => window['delete_' + kind](id);
  return state;
}

for (const kind of ['plan', 'package', 'trainer']) {
  test(`${kind} deletion uses confirmation, token, and one request`, () => {
    const state = ui(); state.open(kind);
    assert.equal(state.confirmation.callback, 'delete_' + kind);
    assert.equal(state.confirmation.params[0], 2);
    state.confirm(kind); state.confirm(kind);
    assert.equal(state.requests.length, 1);
    const request = state.requests[0];
    assert.equal(request.url, 'ajax.php?action=delete_' + kind);
    assert.equal(request.method, 'POST');
    assert.equal(request.data.id, 2);
    assert.equal(request.data.csrf_token, 'test-token');
    assert.equal(state.disabled, true);
    request.success('1'); request.complete();
    assert.equal(state.hidden, true);
    assert.equal(state.success, true);
    assert.equal(state.stopped, 1);
    assert.equal(state.timers.length, 1);
    state.confirm(kind);
    assert.equal(state.requests.length, 1);
  });

  test(`${kind} reference conflict keeps the confirmation open and displays why deletion is blocked`, () => {
    const state = ui(); state.open(kind); state.confirm(kind);
    const text = `Cannot delete this ${kind} because it is used by membership records, including closed memberships.`;
    state.requests[0].error({ status: 409, responseJSON: { error: text } });
    state.requests[0].complete();
    assert.equal(state.text, text);
    assert.equal(state.hidden, false);
    assert.equal(state.disabled, false);
    assert.equal(state.stopped, 1);
    assert.equal(state.timers.length, 0);
  });
}

test('network or unexpected HTML errors stop loading without exposing server output', () => {
  for (const mode of ['network', 'html']) {
    const state = ui(); state.open('plan'); state.confirm('plan');
    if (mode === 'network') state.requests[0].error({ status: 0, responseText: '<b>SQL</b>' });
    else state.requests[0].success('<b>SQL</b>');
    state.requests[0].complete();
    assert.equal(state.text, 'Unable to delete plan. Please try again.');
    assert.equal(state.disabled, false);
    assert.equal(state.stopped, 1);
    assert.equal(state.hidden, false);
  }
});

test('missing tokens, malformed IDs and mismatched callbacks cannot submit a deletion', () => {
  for (const [id, token] of [['0', 'token'], ['1 OR 1=1', 'token'], ['2', '']]) {
    const state = ui(); state.open('plan', id, token); state.confirm('plan');
    assert.equal(state.requests.length, 0);
    assert.equal(state.confirmation, undefined);
  }
  const state = ui(); state.open('plan'); state.confirm('package'); state.confirm('plan', 3);
  assert.equal(state.requests.length, 0);
});

test('delete controls on each page include a CSRF token and no longer contain old AJAX handlers', () => {
  for (const [kind, file] of [['plan', 'plans.php'], ['package', 'packages.php'], ['trainer', 'trainer.php']]) {
    const page = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(page, new RegExp(`delete_${kind}[^\\n]+data-csrf-token=`));
    assert.doesNotMatch(page, new RegExp(`function delete_${kind}\\(`));
  }
});
