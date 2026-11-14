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
      class RenewalPageResult {
        public $num_rows;
        private $row;
        public function __construct($row) { $this->row = $row; $this->num_rows = $row ? 1 : 0; }
        public function fetch_array() { return $this->row; }
      }
      class RenewalPageDatabase {
        public function query($sql) {
          if (strpos($sql, 'SELECT r.*') !== 0) return new RenewalPageResult(null);
          return new RenewalPageResult(['id' => 9, 'trainer_id' => 0, 'mid_no' => 12345, 'name' => 'Test User', 'plan' => 3,
            'package' => 'Test Package', 'pamount' => 100, 'ppamount' => 20, 'status' => ${status},
            'end_date' => (new DateTimeImmutable('today'))->modify('${days} days')->format('Y-m-d')]);
        }
      }
      $_GET['id']='9';
      $page = str_replace("include 'db_connect.php';", '$conn = new RenewalPageDatabase();', file_get_contents('view_pdetails.php'));
      eval('?>' . $page);
    `);
    assert.equal(response.body.includes('mr-2 renew-membership'), visible);
    assert.doesNotMatch(response.body, /Warning|Fatal error/);
    if (visible) assert.match(response.body, /renew-membership"[^>]*data-registration-id="9"[^>]*data-csrf-token="renew-token"/);
  });
}
