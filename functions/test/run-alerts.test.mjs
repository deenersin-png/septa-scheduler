// The phone alert before a run, server half: the in-memory database and a
// fake push sender, no Google involved.
//
//   npm --prefix functions test

import test from 'node:test';
import assert from 'node:assert/strict';

import { sendDue, STALE_MS } from '../lib/run-alerts.js';
import { makeDb } from './fake-db.mjs';

const NOW = Date.UTC(2026, 9, 28, 9, 0);

function harness() {
  const db = makeDb();
  const pushes = [];
  const deps = {
    db, appUrl: 'https://example.test/home.html', log: { error() {}, info() {} },
    serverTimestamp: () => 'TS',
    async sendPush(token, p) { pushes.push({ token, ...p }); }
  };
  db.store.set('users/deen/devices/a', { fcmToken: 'tA' });
  const alert = (id, uid, sendAtMs) => db.store.set('runAlerts/' + id, { uid, date: '2026-10-28', sendAtMs, title: 'Run 209 · report in 30 min', body: 'Report 5:30 AM' });
  return { db, deps, pushes, alert };
}

test('sends what is due, once, and deletes it', async () => {
  const h = harness();
  h.alert('deen_2026-10-28', 'deen', NOW - 30000);
  h.alert('deen_2026-10-29', 'deen', NOW + 86400000);
  const r = await sendDue(h.deps, NOW);
  assert.deepEqual(r, { due: 1, sent: 1, stale: 0, raced: 0 });
  assert.equal(h.pushes[0].title, 'Run 209 · report in 30 min');
  assert.equal(h.pushes[0].tag, 'run-2026-10-28');
  assert.equal(h.db.store.has('runAlerts/deen_2026-10-28'), false);
  assert.equal(h.db.store.has('runAlerts/deen_2026-10-29'), true);     // tomorrow's waits
  assert.deepEqual((await sendDue(h.deps, NOW)).sent, 0);              // nothing twice
  assert.equal(h.db.store.get('config/pushSender').lastRunAt, 'TS');
});

test('an alert the job missed by more than a few minutes is dropped, not sent late', async () => {
  const h = harness();
  h.alert('deen_x', 'deen', NOW - STALE_MS - 1000);
  const r = await sendDue(h.deps, NOW);
  assert.equal(r.stale, 1);
  assert.equal(h.pushes.length, 0);
  assert.equal(h.db.store.size >= 1 && h.db.store.has('runAlerts/deen_x'), false);
});

test('two overlapping runs cannot both send', async () => {
  const h = harness();
  h.alert('deen_y', 'deen', NOW - 1000);
  const [a, b] = await Promise.all([sendDue(h.deps, NOW), sendDue(h.deps, NOW)]);
  assert.equal(a.sent + b.sent, 1);
  assert.equal(a.raced + b.raced, 1);
  assert.equal(h.pushes.length, 1);
});

test('someone with no registered phone just gets nothing', async () => {
  const h = harness();
  h.alert('kim_z', 'kim', NOW - 1000);
  const r = await sendDue(h.deps, NOW);
  assert.deepEqual([r.due, r.sent], [1, 0]);
  assert.equal(h.db.store.has('runAlerts/kim_z'), false);
});
