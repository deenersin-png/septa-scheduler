// ==========================================================================
// Paddle App — alert settings, and what this phone can do.
//
// Every alert is a PHONE notification, sent by the server with the app
// closed (pa-run-alerts.js plans them, functions/ sends them). There is no
// in-app timer any more. This module keeps the operator's choices:
//
//   pushEnabled              this account wants phone alerts (the phone
//                            registered through pa-push.js)
//   report1On / report1Lead  first report alert, minutes before report   (30)
//   report2On / report2Lead  second report alert                         (1)
//   depOn / depLead          every departure, minutes before it          (0)
//
// Times are SCHEDULED times only; a late bus ahead never moves an alert.
// ==========================================================================

import { doc, getDoc, setDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';
import { initFirebase } from './pa-firebase.js';

export const DEFAULTS = {
  pushEnabled: false,
  report1On: true, report1Lead: 30,
  report2On: true, report2Lead: 1,
  depOn: true, depLead: 0
};
/** Longest lead an operator can type, in minutes. */
export const MAX_LEAD_MIN = 180;
const LS_SETTINGS = 'pa_notify';

let db = null, uid = null;
let settings = { ...DEFAULTS };
const listeners = new Set();

/** Saved settings on today's model. The single phone alert before a run
 *  (pushLeadMin) becomes the first report alert. */
function upgrade(j) {
  const s = { ...DEFAULTS, ...j };
  if (j && j.report1Lead == null && j.pushLeadMin != null) s.report1Lead = j.pushLeadMin;
  ['report1Lead', 'report2Lead', 'depLead'].forEach(k => { s[k] = clampLead(s[k], DEFAULTS[k]); });
  return s;
}
export function clampLead(v, dflt = 0) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_LEAD_MIN, n)) : dflt;
}
function loadLocal() {
  try { const j = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null'); if (j) settings = upgrade(j); } catch (_) {}
}
function saveLocal() { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch (_) {} }
loadLocal();

export function getSettings() { return { ...settings }; }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(f => { try { f(getSettings()); } catch (_) {} }); }

/** Load the user's saved preferences (local mirror first, then Firestore). */
export async function attach(userId) {
  const fb = initFirebase();
  if (!fb) return;
  db = fb.db; uid = userId;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'notifications'));
    if (snap.exists()) {
      const d = snap.data(); delete d.updatedAt;
      settings = upgrade(d);
      saveLocal(); emit();
    }
  } catch (e) { console.warn('[pa] notify settings', e.code || e.message); }
}

export function detach() { db = null; uid = null; }

export async function save(patch) {
  settings = { ...settings, ...patch };
  saveLocal(); emit();
  if (db && uid) {
    try {
      await setDoc(doc(db, 'users', uid, 'settings', 'notifications'),
                   { ...settings, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) { console.warn('[pa] notify save', e.code || e.message); }
  }
}

/**
 * When the phone-alert sender last ran, from the heartbeat it writes each minute.
 * Resolves { lastRunAt, ok } — ok false means it has not run in a while, and
 * null means it has never run, so the screen can say so rather than leave an
 * operator waiting for an alert that nothing is sending.
 */
export async function senderStatus() {
  const fb = initFirebase();
  if (!fb) return null;
  try {
    const snap = await getDoc(doc(fb.db, 'config', 'pushSender'));
    if (!snap.exists()) return null;
    const d = snap.data();
    const ms = t => (t && t.toMillis ? t.toMillis() : 0);
    const last = ms(d.lastRunAt);
    return {
      lastRunAt: last,
      ok: last > 0 && Date.now() - last < 10 * 60000,
    };
  } catch (_) { return null; }
}

/**
 * What the ALERTS screen says about the sender: { kind, text }, kind being
 * 'ok' | 'warn' | 'err'. Pure, so it can be checked without a database.
 * `st` is senderStatus()'s answer (null = the sender has never run).
 */
export function senderMessage(st) {
  const clock = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (!st) return { kind: 'err', text: 'Phone alerts are not switched on for this app yet. Your alerts are saved and start once they are.' };
  if (!st.ok) return { kind: 'err', text: 'The alert sender has not run since ' + clock(st.lastRunAt) + '. Alerts may be late or missed.' };
  return { kind: 'ok', text: 'Alert sender is running · last checked ' + clock(st.lastRunAt) };
}

// ---- capability -----------------------------------------------------------

export function support() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
                  || navigator.standalone === true;
  const api = 'Notification' in window;
  return {
    api,
    sw: 'serviceWorker' in navigator,
    permission: api ? Notification.permission : 'unsupported',
    ios, standalone
  };
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href);
  } catch (e) { console.warn('[pa] service worker', e.message); return null; }
}
