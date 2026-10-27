// ==========================================================================
// The phone alert before a run: the server half.
//
// The phone plans its own alerts (assets/pa-run-alerts.js) and leaves them in
// runAlerts/ with the time to send. Each minute this does ONE query for what
// is due, sends it, and deletes it. It never reads a schedule, so the cost
// does not grow with the number of operators: an idle minute is one read,
// and each alert is about two reads, one delete and a free push.
//
// The properties it keeps:
//  * One alert per run. The alert is deleted with a must-exist precondition
//    BEFORE it is sent, so two overlapping runs of this job cannot both send.
//  * Nothing late. An alert more than STALE_MS past its time (the job was
//    down) is dropped, not sent: "report in 30 min" an hour late is wrong.
// ==========================================================================

import { notify } from './push.js';

export const STALE_MS = 5 * 60000;

/**
 * One pass. deps: { db, sendPush, appUrl, log, serverTimestamp }
 * Resolves { due, sent, stale, raced }.
 */
export async function sendDue(deps, nowMs) {
  const { db, log } = deps;
  const snap = await db.collection('runAlerts').where('sendAtMs', '<=', nowMs).get();
  const out = { due: snap.docs.length, sent: 0, stale: 0, raced: 0 };
  for (const d of snap.docs) {
    const a = d.data();
    try { await d.ref.delete({ exists: true }); }
    catch (_) { out.raced++; continue; }                // another run took it
    if (nowMs - a.sendAtMs > STALE_MS) { out.stale++; continue; }
    try {
      const n = await notify(deps, [a.uid], { title: a.title, body: a.body, tag: 'run-' + a.date });
      if (n) out.sent++;
    } catch (e) { if (log) log.error('run alert failed', { uid: a.uid, error: String(e) }); }
  }
  // Heartbeat, so the ALERTS screen can say whether the sender is running.
  if (deps.serverTimestamp) {
    await db.collection('config').doc('pushSender').set({ lastRunAt: deps.serverTimestamp(), lastDue: out.due }, { merge: true });
  }
  return out;
}
