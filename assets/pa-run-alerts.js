// ==========================================================================
// Paddle App — the phone alert before a run, which arrives even with the
// app closed.
//
// Built to stay free with thousands of operators. The PHONE works out its
// own alert times from its own schedule and leaves them in runAlerts/, one
// small document per working day for the next PLAN_DAYS days, rewriting only
// what changed. The server (functions/lib/run-alerts.js) then does one query
// a minute for alerts that are due, sends them through Cloud Messaging (free)
// and deletes them. It never reads anyone's schedule, which is what made the
// old every-minute email cost money per person.
//
// The time is the SCHEDULED report time. A late bus ahead never moves it.
//
// runAlerts/{uid}_{date}   owner only (firestore.rules)
//   uid, date, sendAtMs, title, body, updatedAt
// runAlerts/{uid}_test     the same, date 'test': one test alert, minutes out
//
// The planning half is pure (no Firebase) so assets/tests/run-alerts.test.mjs
// can pin it; Firestore is loaded only when syncRunAlerts runs.
// ==========================================================================

import { addDays, minToMs, fmtClock, DAY_SHORT, dowOf } from './pa-schedule.js';

/** How far ahead alerts are kept on the server. Opening the app tops it up. */
export const PLAN_DAYS = 14;
export const LEAD_CHOICES = [15, 30, 45, 60, 90];
export const DEFAULT_LEAD_MIN = 30;

const LS_PREFIX = 'pa_run_alerts_v1_';
const FIRESTORE = 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const dayLabel = iso => DAY_SHORT[dowOf(iso)] + ' ' + Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));

/**
 * The operator's working days from `from` for `n` days, as
 * [{ date, runNo, reportMin, routeLabel }]. resolve(date) and
 * runFor(resolved, date) are pa-assignments / pa-edit-sheet's.
 */
export async function upcomingRuns({ resolve, runFor, from, n = PLAN_DAYS }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(from, i);
    const r = resolve(date);
    if (!r || r.off || !r.runNo) continue;
    let run = null;
    try { run = await runFor(r, date); } catch (_) {}
    const reportMin = run && run.reportMin != null ? run.reportMin : r.reportMin;
    if (reportMin == null) continue;
    const labels = run && run.pieces ? [...new Set(run.pieces.map(p => p.routeLabel).filter(Boolean))] : [];
    out.push({ date, runNo: String(r.runNo), reportMin, routeLabel: labels.join(' / ') });
  }
  return out;
}

/** Pure: one alert per working day, still in the future, soonest first. */
export function planRunAlerts(days, leadMin, nowMs) {
  const lead = LEAD_CHOICES.includes(+leadMin) ? +leadMin : DEFAULT_LEAD_MIN;
  return days
    .map(d => ({
      date: d.date,
      sendAtMs: minToMs(d.date, d.reportMin - lead),
      title: 'Run ' + d.runNo + ' · report in ' + lead + ' min',
      body: 'Report ' + fmtClock(d.reportMin) + (d.routeLabel ? ' · ' + d.routeLabel : '') + ' · ' + dayLabel(d.date)
    }))
    .filter(a => a.sendAtMs > nowMs + 60000)
    .sort((a, b) => a.sendAtMs - b.sendAtMs);
}

const sigOf = a => a.sendAtMs + '|' + a.title + '|' + a.body;

function readKnown(uid) {
  try { return JSON.parse(localStorage.getItem(LS_PREFIX + uid) || 'null'); } catch (_) { return null; }
}
function writeKnown(uid, m) { try { localStorage.setItem(LS_PREFIX + uid, JSON.stringify(m)); } catch (_) {} }

/**
 * Make runAlerts/ match this operator's schedule. Writes only what changed,
 * so an unchanged week costs nothing. enabled false clears them all.
 * Resolves { count, next, through, writes }.
 */
export async function syncRunAlerts({ db, uid, enabled, leadMin, days, now = Date.now() }) {
  const F = await import(FIRESTORE);
  const col = F.collection(db, 'runAlerts');
  // known: { id: { s: signature, at: sendAtMs } } of what the server holds.
  let known = readKnown(uid);
  if (!known) {
    // First sync on this phone: learn what another phone may have written.
    known = {};
    const snap = await F.getDocs(F.query(col, F.where('uid', '==', uid)));
    snap.forEach(d => { const x = d.data(); if (x.date !== 'test') known[d.id] = { s: sigOf(x), at: x.sendAtMs }; });
  }
  // The server deletes an alert once it is sent; forget those here too.
  Object.keys(known).forEach(id => { if (known[id].at <= now) delete known[id]; });

  const want = enabled ? planRunAlerts(days || [], leadMin, now) : [];
  const batch = F.writeBatch(db);
  let writes = 0;
  const ids = new Set();
  for (const a of want) {
    const id = uid + '_' + a.date;
    ids.add(id);
    if (known[id] && known[id].s === sigOf(a)) continue;
    batch.set(F.doc(col, id), { uid, date: a.date, sendAtMs: a.sendAtMs, title: a.title, body: a.body, updatedAt: F.serverTimestamp() });
    known[id] = { s: sigOf(a), at: a.sendAtMs };
    writes++;
  }
  for (const id of Object.keys(known)) {
    if (ids.has(id)) continue;
    batch.delete(F.doc(col, id));
    delete known[id];
    writes++;
  }
  if (writes) await batch.commit();
  writeKnown(uid, known);
  return { count: want.length, next: want[0] || null, through: want.length ? want[want.length - 1].date : null, writes };
}

export const TEST_DELAY_MIN = 2;

/** Pure: the test alert, sent by the same server path as a real one. */
export function testAlert(nowMs, delayMin = TEST_DELAY_MIN) {
  const sendAtMs = nowMs + delayMin * 60000;
  const at = new Date(sendAtMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { date: 'test', sendAtMs, title: 'Test alert · Paddle App',
           body: 'Phone alerts work, even with the app closed. Set for ' + at + '.' };
}

/**
 * Leave a test alert for the server to send in TEST_DELAY_MIN minutes, so
 * the operator can close the app and see a real push arrive. Its own doc,
 * runAlerts/{uid}_test, so it never replaces a real alert.
 * Resolves the alert written.
 */
export async function sendTestAlert({ db, uid, now = Date.now() }) {
  const F = await import(FIRESTORE);
  const a = testAlert(now);
  await F.setDoc(F.doc(db, 'runAlerts', uid + '_test'),
                 { uid, date: a.date, sendAtMs: a.sendAtMs, title: a.title, body: a.body, updatedAt: F.serverTimestamp() });
  return a;
}

/** Whether this phone has synced alerts for `uid` before. When it has not and
 *  alerts are off, there is nothing to clear and no reason to ask the server. */
export const hasLocal = uid => readKnown(uid) !== null;

/** Forget this phone's copy, e.g. on sign-out. */
export function forget(uid) { try { localStorage.removeItem(LS_PREFIX + uid); } catch (_) {} }
