import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/js/login.js', import.meta.url), 'utf8');

function ui(valid = true) {
  const state = { requests: [], destinations: [], disabled: false, label: 'Login', text: '' };
  const document = {};
  const form = { dataset: {}, reportValidity: () => valid };
  let submit;
  const message = {
    addClass() { return this; }, removeClass() { return this; },
    text(value) { state.text = value; return this; }, empty() { state.text = ''; return this; },
  };
  const button = {
    prop(name, value) { state.disabled = value; return this; },
    text(value) { state.label = value; return this; },
  };
  function $(target) {
    if (target === document) return { on(event, selector, handler) {
      assert.equal(event, 'submit');
      assert.equal(selector, '#login-form');
      submit = handler;
    } };
    return {
      find: selector => selector === '.login-message' ? message : button,
      serialize: () => 'username=admin&password=test&csrf_token=login-test',
    };
  }
  $.ajax = options => state.requests.push(options);
  const window = { location: { assign: destination => state.destinations.push(destination) } };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.submit = () => submit.call(form, { preventDefault() {} });
  return state;
}

test('login submits once, disables the actual submit button and navigates on success', () => {
  const state = ui();
  state.submit();
  state.submit();
  assert.equal(state.requests.length, 1);
  const request = state.requests[0];
  assert.equal(request.url, 'ajax.php?action=login');
  assert.match(request.data,/csrf_token=login-test/);
  assert.equal(request.method, 'POST');
  assert.equal(state.disabled, true);
  assert.equal(state.label, 'Logging in...');
  request.success('1');
  request.complete();
  assert.deepEqual(state.destinations, ['index.php?page=home']);
  state.submit();
  assert.equal(state.requests.length, 1);
});

for (const code of ['2', '3']) {
  test(`login response ${code} shows the same credentials message and permits retry`, () => {
    const state = ui();
    state.submit();
    state.requests[0].success(code);
    state.requests[0].complete();
    assert.equal(state.text, 'Username or password is incorrect.');
    assert.equal(state.disabled, false);
    assert.equal(state.label, 'Login');
    assert.deepEqual(state.destinations, []);
    state.submit();
    assert.equal(state.requests.length, 2);
  });
}

for (const status of [0, 400, 503]) {
  test(`HTTP ${status} displays a safe message and restores the button`, () => {
    const state = ui();
    state.submit();
    state.requests[0].error({ status, responseText: '<b>SQL details and password hash</b>' });
    state.requests[0].complete();
    assert.equal(state.text, status === 400
      ? 'Enter a valid username and password.'
      : 'Unable to log in right now. Please try again.');
    assert.equal(state.disabled, false);
    assert.equal(state.label, 'Login');
    assert.deepEqual(state.destinations, []);
  });
}

test('unexpected HTML is never displayed or treated as successful login', () => {
  const state = ui();
  state.submit();
  state.requests[0].success('<b>Fatal error: database details</b>');
  state.requests[0].complete();
  assert.equal(state.text, 'Unable to log in right now. Please try again.');
  assert.equal(state.disabled, false);
  assert.deepEqual(state.destinations, []);
});

for (const [retryAfter, expected] of [
  [900, 'Too many login attempts. Retry in 15 min.'],
  [61, 'Too many login attempts. Retry in 2 min.'],
  [undefined, 'Too many login attempts. Please try again later.'],
  ['<script>private</script>', 'Too many login attempts. Please try again later.'],
  [999999, 'Too many login attempts. Please try again later.'],
]) {
  test(`HTTP 429 displays a safe wait message for ${String(retryAfter)}`, () => {
    const state = ui();
    state.submit();
    state.requests[0].error({ status: 429, responseJSON: { retry_after: retryAfter } });
    state.requests[0].complete();
    assert.equal(state.text, expected);
    assert.equal(state.disabled, false);
    assert.deepEqual(state.destinations, []);
  });
}

test('browser validation stops empty submissions', () => {
  const state = ui(false);
  state.submit();
  assert.equal(state.requests.length, 0);
  assert.equal(state.disabled, false);
});

test('expired login form shows a safe refresh message and restores Login without automatic retry',()=>{
  const state=ui();state.submit();
  state.requests[0].error({status:419,responseJSON:{error:'<script>private</script>'}});
  state.requests[0].complete();
  assert.equal(state.text,'Login form has expired. Refresh the page and try again.');
  assert.equal(state.disabled,false);assert.equal(state.label,'Login');
  assert.equal(state.requests.length,1);assert.deepEqual(state.destinations,[]);
});

test("login ui() state.submit() timeout restores controls and explains uncertain status", () => {
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
