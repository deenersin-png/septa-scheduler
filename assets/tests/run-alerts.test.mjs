// The phone alert before a run: planning only (no Firebase).
//
//   node --test assets/tests/run-alerts.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { planRunAlerts, upcomingRuns, testAlert, TEST_DELAY_MIN, DEFAULT_LEAD_MIN } from '../pa-run-alerts.js';
import { minToMs } from '../pa-schedule.js';

const NOW = minToMs('2026-10-27', 600);          // Tue 10:00 AM

test('one alert per working day, lead minutes before the scheduled report time', () => {
  const a = planRunAlerts([
    { date: '2026-10-28', runNo: '209', reportMin: 330, routeLabel: '21-42' },
    { date: '2026-10-29', runNo: '209', reportMin: 330, routeLabel: '21-42' }
  ], 30, NOW);
  assert.equal(a.length, 2);
  assert.equal(a[0].sendAtMs, minToMs('2026-10-28', 300));
  assert.equal(a[0].title, 'Run 209 · report in 30 min');
  assert.equal(a[0].body, 'Report 5:30 AM · 21-42 · Wed 10/28');
});

test('past and too-soon alerts are left out', () => {
  const a = planRunAlerts([
    { date: '2026-10-27', runNo: '1', reportMin: 540, routeLabel: '' },   // earlier today
    { date: '2026-10-27', runNo: '2', reportMin: 630, routeLabel: '' },   // alert at 10:00, now
    { date: '2026-10-27', runNo: '3', reportMin: 700, routeLabel: '' }    // alert at 11:10
  ], 30, NOW);
  assert.deepEqual(a.map(x => x.title.split(' ')[1]), ['3']);
});

test('a just-after-midnight report alerts the evening before', () => {
  const [a] = planRunAlerts([{ date: '2026-10-29', runNo: '101', reportMin: 29, routeLabel: '' }], 60, NOW);
  assert.equal(a.sendAtMs, minToMs('2026-10-28', 1409));     // 11:29 PM Wednesday
  assert.equal(new Date(a.sendAtMs).getDate(), 28);
});

test('an unknown lead falls back to the default', () => {
  const [a] = planRunAlerts([{ date: '2026-10-28', runNo: '9', reportMin: 600, routeLabel: '' }], 7, NOW);
  assert.match(a.title, new RegExp('in ' + DEFAULT_LEAD_MIN + ' min'));
});

test('upcomingRuns skips days off and uses the run\'s report time', async () => {
  const days = await upcomingRuns({
    from: '2026-10-27', n: 3,
    resolve: d => (d === '2026-10-28' ? { off: true } : { runNo: '209', reportMin: null }),
    runFor: async () => ({ reportMin: 330, pieces: [{ routeLabel: '21-42' }, { routeLabel: '21-42' }] })
  });
  assert.deepEqual(days.map(d => d.date), ['2026-10-27', '2026-10-29']);
  assert.equal(days[0].routeLabel, '21-42');
  assert.equal(days[0].reportMin, 330);
});

test('the test alert is due a couple of minutes out and never looks like a run', () => {
  const a = testAlert(NOW);
  assert.equal(a.date, 'test');
  assert.equal(a.sendAtMs, NOW + TEST_DELAY_MIN * 60000);
  assert.ok(a.sendAtMs - NOW <= 600000, 'the rules only allow ten minutes out');
  assert.ok(!/^Run /.test(a.title));
  assert.ok(a.title.length <= 80 && a.body.length <= 200);
});
