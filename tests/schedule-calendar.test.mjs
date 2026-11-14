import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const page = readFileSync(new URL('../schedule.php', import.meta.url), 'utf8');
const script = page.split('<script>')[1].split('</script>')[0]
  .replace("<?php echo date('Y-m-d') ?>", '2026-11-14');
const library = readFileSync(new URL('../assets/fullcalendar/main.js', import.meta.url), 'utf8');
// Exercise the bundled library's real recurrence loop without rendering a browser DOM.
const expansion = library.slice(library.indexOf('function expandRanges('), library.indexOf('    var changeHandlerPlugin'));
function dates(event) {
  const context = {
    arrayToHash: values => Object.fromEntries(Array.from(values, value => [value, true])),
    startOfDay: date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
    addDays: (date, days) => new Date(date.getTime() + days * 86400000),
  };
  vm.createContext(context);
  vm.runInContext(expansion, context);
  return Array.from(context.expandRanges(event.daysOfWeek, null, {
    start: new Date(event.startRecur + 'T00:00:00Z'), end: new Date(event.endRecur + 'T00:00:00Z'),
  }, {}), date => date.toISOString().split('T')[0]);
}
function calendar(row) {
  let options;
  const before = structuredClone(row);
  const document = { getElementById: () => ({}), addEventListener(event, callback) { callback(); } };
  function $() { return { click() {}, val() {} }; }
  $.ajax = request => { request.success(JSON.stringify([row])); request.complete(); };
  const FullCalendar = { Calendar: function (element, config) { options = config; this.render = () => {}; } };
  vm.runInNewContext(script, { document, $, FullCalendar, start_load() {}, end_load() {} });
  assert.deepEqual(row, before, 'Calendar conversion must not change stored schedule values');
  return options.events[0];
}

for (const [name, from, to, day, expectedEnd, expectedDates] of [
  ['November Mondays', '2026-11-01', '2026-11-30', '1', '2026-12-01', ['2026-11-02','2026-11-09','2026-11-16','2026-11-23','2026-11-30']],
  ['leap February Tuesdays', '2028-02-01', '2028-02-29', '2', '2028-03-01', ['2028-02-01','2028-02-08','2028-02-15','2028-02-22','2028-02-29']],
  ['ordinary February Sundays', '2027-02-01', '2027-02-28', '0', '2027-03-01', ['2027-02-07','2027-02-14','2027-02-21','2027-02-28']],
  ['December Thursdays', '2026-12-01', '2026-12-31', '4', '2027-01-01', ['2026-12-03','2026-12-10','2026-12-17','2026-12-24','2026-12-31']],
  ['Monday month end with Tuesday following', '2027-05-01', '2027-05-31', '1,2', '2027-06-01', ['2027-05-03','2027-05-04','2027-05-10','2027-05-11','2027-05-17','2027-05-18','2027-05-24','2027-05-25','2027-05-31']],
]) {
  test(`${name}: includes the final day and excludes the next month`, () => {
    const event = calendar({ id: '7', name: 'Test Member', dow: day, date_from: from, date_to: to, time_from: '09:00:00', time_to: '10:00:00' });
    assert.equal(event.endRecur, expectedEnd);
    assert.equal(event.startRecur, from);
    assert.equal(event.data_id, '7');
    assert.equal(event.startTime, '09:00:00');
    assert.equal(event.endTime, '10:00:00');
    assert.deepEqual(dates(event), expectedDates);
  });
}
