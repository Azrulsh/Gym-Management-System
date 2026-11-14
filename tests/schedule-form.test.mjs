import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1 };

for (const id of ['abc', '', '0', '-1', '2147483648', '1 OR 1=1', "1'", ['1'], null, true]) {
  test(`schedule form rejects ID ${JSON.stringify(id)} before opening a database connection`, () => {
    const response = run(session, `
      $_GET = json_decode(${literal(JSON.stringify({ id }))}, true);
      // If malformed IDs reach the connection include, fail rather than use the application DB.
      $page = str_replace("include 'db_connect.php';", "throw new RuntimeException('Unexpected connection');", file_get_contents('manage_schedule.php'));
      $page = str_replace('__DIR__', var_export(getcwd(), true), $page);
      eval('?>' . $page);
    `);
    assert.equal(response.status, 400);
    assert.match(response.body, /Invalid schedule ID/);
    assert.doesNotMatch(response.body, /<form|Warning|Fatal error|Stack trace/);
  });
}

function render(get, setup = '', options = {}) {
  return run(session, `
    require 'tests/helpers/membership-read-db.php';
    with_membership_read_database(function($db,$schema) {
      $db->query('CREATE TABLE schedules (id INT PRIMARY KEY, member_id INT NOT NULL, dow TEXT NOT NULL,
        date_from DATE NOT NULL, date_to DATE NOT NULL, time_from TIME NOT NULL, time_to TIME NOT NULL) ENGINE=InnoDB');
      $db->query("INSERT INTO schedules VALUES (1,11,'0,2','2028-02-01','2028-02-29','09:00:15','10:00:30')");
      ${setup}
      $before = $db->query('SELECT * FROM schedules')->fetch_all(MYSQLI_ASSOC);
      $html = render_membership_read_page($db,'manage_schedule.php',json_decode(${literal(JSON.stringify(get))},true));
      $after = $db->query('SELECT * FROM schedules')->fetch_all(MYSQLI_ASSOC);
      if ($before !== $after) throw new RuntimeException('Form changed schedule records');
      echo $html;
    });
  `, options);
}

test('missing or deleted schedule returns 404 without an editable form', () => {
  const response = render({ id: '999' });
  assert.equal(response.status, 404);
  assert.match(response.body, /Schedule not found/);
  assert.doesNotMatch(response.body, /<form|Warning|Fatal error|Stack trace/);
});

test('Edit populates the exact schedule, selected member, Sunday, months and second precision', () => {
  const response = render({ id: '1' });
  assert.equal(response.status, 200);
  assert.match(response.body, /name="id" value="1"/);
  assert.match(response.body, /class="btn btn-danger confirm-schedule-delete" data-id="1" data-csrf-token="[a-f0-9]{64}"/);
  assert.match(response.body, /entire recurring schedule/);
  assert.match(response.body, /value="11" selected/);
  assert.match(response.body, /value="0" selected[^>]*>Sunday/);
  assert.match(response.body, /value="2" selected[^>]*>Tuesday/);
  for (const value of ['2028-02', '09:00:15', '10:00:30']) assert.ok(response.body.includes(`value="${value}"`));
  assert.doesNotMatch(response.body, /Warning|Fatal error/);
});

test('Sunday alone remains selected when editing', () => {
  assert.match(render({ id: '1' }, "$db->query(\"UPDATE schedules SET dow='0' WHERE id=1\");").body, /value="0" selected[^>]*>Sunday/);
});

test('Add remains a blank form with available members and required schedule fields', () => {
  const response = render({});
  assert.equal(response.status, 200);
  assert.match(response.body, /name="id" value=""/);
  assert.doesNotMatch(response.body, /request-schedule-delete|confirm-schedule-delete/);
  assert.match(response.body, /name="date_from"[^>]*required value=""/);
  assert.match(response.body, /name="time_from"[^>]*required value=""/);
  assert.match(response.body, /value="11"/);
  assert.doesNotMatch(response.body, /Warning|Fatal error/);
});

test('member lookup failure returns safe 503 without a partial form', () => {
  const response = render({ id: '1' }, "$db->query('DROP TABLE members'); ini_set('error_log','');", {
    expectedStderr: /^Unable to load schedule form\.\r?\n$/,
  });
  assert.equal(response.status, 503);
  assert.match(response.body, /Unable to load schedule/);
  assert.doesNotMatch(response.body, /<form|SELECT |Stack trace|Fatal error/);
});
