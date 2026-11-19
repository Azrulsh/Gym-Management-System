import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { run } from './helpers/php.mjs';

const source = readFileSync(new URL('../assets/js/membership-renew.js', import.meta.url), 'utf8');
function ui({ rid = '9', token = 'renew-token' } = {}) {
  const state = { requests: [], events: [], disabled: false, text: '' };
  const document = {};
  const button = { dataset: {} };
  let click;
  const message = {
    addClass() { return this; }, removeClass() { return this; },
    text(value) { state.text = value; return this; }, empty() { state.text = ''; return this; },
  };
  function $(target) {
    if (target === document) return { on(event, selector, handler) { assert.equal(selector, '.renew-membership'); click = handler; } };
    if (target === button) return {
      attr: name => name === 'data-registration-id' ? rid : token,
      prop(name, value) { state.disabled = value; },
    };
    return message;
  }
  $.ajax = request => state.requests.push(request);
  const window = {
    start_load() { state.events.push('start'); }, end_load() { state.events.push('end'); },
    alert_toast() { state.events.push('toast'); },
    uni_modal(title, url, size) { state.events.push('modal'); state.modal = { title, url, size }; },
  };
  vm.runInNewContext(source, { document, jQuery: $, window });
  state.click = () => click.call(button);
  return state;
}

test('Renew sends ID and CSRF once, then opens the new membership after stopping loading', () => {
  const state = ui(); state.click(); state.click();
  assert.equal(state.requests.length, 1);
  const request = state.requests[0];
  assert.equal(request.url, 'ajax.php?action=renew_membership');
  assert.equal(request.method, 'POST');
  assert.equal(request.data.rid, '9');
  assert.equal(request.data.csrf_token, 'renew-token');
  assert.equal(state.disabled, true);
  request.success('12'); request.complete();
  assert.deepEqual(state.events, ['start', 'end', 'toast', 'modal']);
  assert.deepEqual(state.modal, { title: 'Member Plan Details', url: 'view_pdetails.php?id=12', size: '' });
  state.click();
  assert.equal(state.requests.length, 1);
});

test('stale renewal conflict explains rejection and restores controls', () => {
  const state = ui(); state.click();
  state.requests[0].error({ status: 409, responseJSON: { error: 'Membership has already been renewed or ended. Refresh the page.' } });
  state.requests[0].complete();
  assert.match(state.text, /already been renewed or ended/);
  assert.equal(state.disabled, false);
  assert.deepEqual(state.events, ['start', 'end']);
  state.click();
  assert.equal(state.requests.length, 2);
});

for (const response of ['<b>SQL failure</b>', '0', '-1', '1e3', '2147483648', '']) {
  test(`unexpected response ${JSON.stringify(response)} cannot open a renewal modal`, () => {
    const state = ui(); state.click();
    state.requests[0].success(response); state.requests[0].complete();
    assert.equal(state.text, 'Unable to renew membership. Please try again.');
    assert.equal(state.disabled, false);
    assert.deepEqual(state.events, ['start', 'end']);
  });
}

test('network failures do not show raw HTML or leave loading running', () => {
  const state = ui(); state.click();
  state.requests[0].error({ status: 0, responseText: '<b>SQL details</b>' });
  state.requests[0].complete();
  assert.equal(state.text, 'Unable to renew membership. Please try again.');
  assert.equal(state.disabled, false);
  assert.deepEqual(state.events, ['start', 'end']);
});

test('missing tokens and invalid IDs cannot submit a renewal', () => {
  for (const values of [{ token: '' }, { rid: '' }, { rid: '0' }, { rid: '9 OR 1=1' }]) {
    const state = ui(values); state.click();
    assert.equal(state.requests.length, 0);
  }
});

for (const [label, status, days, visible] of [
  ['expired active', 1, -1, true], ['expired ended', 0, -1, false],
  ['expires today', 1, 0, false], ['unexpired active', 1, 1, false],
]) {
  test(`details modal shows Renew correctly for ${label} membership`, () => {
    const response = run({ login_id: 2, login_type: 1, csrf_token: 'renew-token' }, `
      require 'tests/helpers/membership-read-db.php';
      with_membership_read_database(function($db,$schema) {
        $db->query('UPDATE registration_info SET status=${status}, start_date=DATE_SUB(CURDATE(),INTERVAL 1 YEAR), end_date=DATE_ADD(CURDATE(),INTERVAL ${days} DAY) WHERE id=9');
        echo render_membership_read_page($db,'view_pdetails.php',['id'=>'9']);
      });
    `);
    assert.equal(response.body.includes('mr-2 renew-membership'), visible);
    assert.doesNotMatch(response.body, /Warning|Fatal error/);
    if (visible) assert.match(response.body, /renew-membership"[^>]*data-registration-id="9"[^>]*data-csrf-token="renew-token"/);
  });
}

test("membership-renew ui() state.click() timeout restores controls and explains uncertain status", () => {
  const state=ui(); state.click();
  const request=state.requests[0]; assert.equal(request.timeout,15000);
  request.error({responseText:'<b>Internal error</b>'},'timeout'); request.complete();
  assert.equal(state.disabled,false);
  assert.match(state.text,/status could not be confirmed/);
  assert.match(state.text,/Refresh/);
  assert.doesNotMatch(state.text,/<b>|Internal error/);
  assert.equal(state.requests.length,1);
  state.click(); assert.equal(state.requests.length,2);
});
