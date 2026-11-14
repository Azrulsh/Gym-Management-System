import assert from 'node:assert/strict';
import test from 'node:test';
import { literal, run } from './helpers/php.mjs';

const session = { login_id: 2, login_type: 1 };
const valid = { member_id: '11', date_from: '2026-02', date_to: '2026-02', time_from: '09:00', time_to: '10:00', dow: ['0', '2'] };
function attempt(post) {
  return JSON.parse(run(session, `require 'tests/helpers/membership-db.php';
    with_membership_database(function($db,$schema) {
      $db->query('CREATE TABLE schedules (id INT PRIMARY KEY AUTO_INCREMENT, member_id INT NOT NULL, dow TEXT NOT NULL,
        date_from DATE NOT NULL, date_to DATE NOT NULL, time_from TIME NOT NULL, time_to TIME NOT NULL) ENGINE=InnoDB');
      $db->query("INSERT INTO schedules VALUES (1,11,'1','2026-01-01','2026-01-31','08:00','09:00')");
      $before = $db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $historyBefore = membership_snapshot($db);
      $result = new_membership_for_test($db,json_decode(${literal(JSON.stringify(post))},true),'save_schedule');
      $after = $db->query('SELECT * FROM schedules ORDER BY id')->fetch_all(MYSQLI_ASSOC);
      $historyAfter = membership_snapshot($db);
      echo json_encode(compact('before','after','result','historyBefore','historyAfter'));
    });`).body);
}

for (const id of ['', '1']) {
  for (const [label, changes, message] of [
    ['reversed months', { date_from: '2026-12', date_to: '2026-11' }, /Month To/],
    ['reversed times', { time_from: '15:00', time_to: '14:00' }, /Time To/],
    ['equal times', { time_from: '15:00', time_to: '15:00' }, /Time To/],
    ['equal mixed precision', { time_from: '09:00:00', time_to: '09:00' }, /Time To/],
    ['no days', { dow: [] }, /at least one/],
    ['missing days', { dow: null }, /at least one/],
    ['invalid day', { dow: ['7'] }, /valid schedule days/],
    ['invalid month', { date_to: '2026-13' }, /valid schedule months/],
    ['invalid time', { time_to: '25:00' }, /valid schedule months/],
  ]) {
    test(`${id ? 'Edit' : 'Add'} rejects ${label} without changing schedules or membership history`, () => {
      const data = attempt({ ...valid, id, ...changes });
      assert.equal(data.result.status, 400);
      assert.match(JSON.parse(data.result.result).error, message);
      assert.deepEqual(data.after, data.before);
      assert.deepEqual(data.historyAfter, data.historyBefore);
    });
  }
  test(`${id ? 'Edit' : 'Add'} accepts a same-month schedule including Sunday and preserves history`, () => {
    const data = attempt({ ...valid, id });
    assert.equal(data.result.result, 1);
    const row = id ? data.after[0] : data.after[1];
    assert.equal(row.date_from, '2026-02-01');
    assert.equal(row.date_to, '2026-02-28');
    assert.equal(row.dow, '0,2');
    assert.equal(row.time_from, '09:00:00');
    assert.equal(row.time_to, '10:00:00');
    assert.deepEqual(data.historyAfter, data.historyBefore);
  });
}

test('leap year, year boundary, duplicate days and second precision remain supported', () => {
  const data = attempt({ ...valid, id: '', date_from: '2027-12', date_to: '2028-02',
    time_from: '09:00', time_to: '09:00:01', dow: ['0', '0', '6'] });
  assert.equal(data.result.result, 1);
  assert.equal(data.after[1].date_to, '2028-02-29');
  assert.equal(data.after[1].dow, '0,6');
});
