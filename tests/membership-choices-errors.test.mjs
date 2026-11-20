import assert from 'node:assert/strict';
import test from 'node:test';
import {run} from './helpers/php.mjs';

function render(setup = '', options = {}) {
  return run({login_id: 2, login_type: 1}, `
    require 'tests/helpers/membership-read-db.php';
    with_membership_read_database(function($db) {
      ${setup}
      $before = membership_snapshot($db);
      $html = render_membership_read_page($db, 'manage_membership.php', ['id' => '11']);
      if ($before !== membership_snapshot($db)) throw new RuntimeException('Form changed history');
      echo $html;
    });`, options);
}

for (const table of ['members', 'plans', 'packages', 'trainers']) {
  test(`membership form handles unavailable ${table} before rendering any controls`, () => {
    const result = render(`$db->query('DROP TABLE ${table}');`, {
      expectedStderr: /^Unable to load membership choices\.\r?\n$/,
    });
    assert.equal(result.status, 503);
    assert.equal(result.body, '<div class="alert alert-danger" role="alert">Unable to load membership choices. Please try again.</div>');
    assert.doesNotMatch(result.body, /<form|<select|SQL|1146|Fatal|Warning/);
  });
}

test('membership form retains eligible selection, catalog choices and optional trainer', () => {
  const result = render();
  assert.equal(result.status, 200);
  assert.match(result.body, /<option value="11" selected>/);
  for (const name of ['member_id', 'plan_id', 'package_id', 'trainer_id']) {
    assert.match(result.body, new RegExp('<select name="' + name + '"'));
  }
  assert.match(result.body, /Test Package/);
  assert.match(result.body, /Test Trainer/);
  assert.match(result.body, /name="csrf_token"/);
  assert.doesNotMatch(result.body, /<select name="trainer_id"[^>]*required/);
  assert.doesNotMatch(result.body, /Unable to load|Fatal|Warning/);
});

for (const table of ['members', 'plans', 'packages', 'trainers']) {
  test(`empty ${table} remains a successful form response`, () => {
    const result = render(`$db->query('DELETE FROM ${table}');`);
    assert.equal(result.status, 200);
    assert.match(result.body, /<form/);
    assert.doesNotMatch(result.body, /Unable to load|Fatal|Warning/);
    if (table === 'members') assert.match(result.body, /No eligible members/);
  });
}
