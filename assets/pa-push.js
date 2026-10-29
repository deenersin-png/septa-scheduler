// ==========================================================================
// Paddle App — this phone's registration for push (Firebase Cloud Messaging).
//
// One registration serves every server-sent alert: the phone alert before a
// run (pa-run-alerts.js) and the Swap board's alerts. It stores the phone's
// FCM token in users/{uid}/devices, where functions/ looks it up. Cloud
// Messaging itself is free with no limit.
//
// Uses the site's own service worker (sw.js), whose push handler shows the
// alert, so no second worker is installed. iPhone only allows web push in an
// app added to the Home Screen (iOS 16.4 and later).
// ==========================================================================

import { doc, setDoc, getDoc, deleteDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

import { initFirebase, firebaseConfig } from './pa-firebase.js';

// Web push key pair. PUBLIC by design, like the API key.
// Firebase console -> Project settings -> Cloud Messaging -> Web Push
// certificates -> Generate key pair, then paste the "Key pair" value here.
// Until then phone alerts are off and the screens say so.
export const FCM_VAPID_KEY = 'BKOjs5OGkeLtRmYFefuA4LdWQEVpSShpyOztZYirmfS9cad3YWcvBQltTqrB08ebvhbniBtkbe1AzFt5yUKBCGI';
export const pushConfigured = () => !FCM_VAPID_KEY.includes('REPLACE_ME');

const LS_DEVICE = 'pa_push_device';
const MESSAGING = 'https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging.js';
const DAY_MS = 864e5;

// { uid, id, token?, checkedAt? } of this phone's registration.
function readDevice() { try { return JSON.parse(localStorage.getItem(LS_DEVICE) || 'null'); } catch (_) { return null; } }
function writeDevice(d) { try { localStorage.setItem(LS_DEVICE, JSON.stringify(d)); } catch (_) {} }

/** True when THIS phone has registered for `uid` and may still show alerts. */
export function registeredHere(uid) {
  const d = readDevice();
  if (!(d && d.uid === uid && d.id)) return false;
  // Notifications switched off in the phone's settings since: not registered any more.
  return !('Notification' in window) || Notification.permission === 'granted';
}

async function tokenFor(fb, M) {
  const reg = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href);
  return M.getToken(M.getMessaging(fb.app), { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
}

// One device doc per token; the id is a short hash so it is a valid path.
async function saveDevice(fb, uid, token, oldId) {
  let h = 0; for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  const id = 'fcm_' + (h >>> 0).toString(36);
  await setDoc(doc(fb.db, 'users', uid, 'devices', id), {
    fcmToken: token, platform: navigator.userAgent.slice(0, 120),
    project: firebaseConfig.projectId, updatedAt: serverTimestamp()
  });
  // The old token is dead or replaced: the server need not try it again.
  if (oldId && oldId !== id) await deleteDoc(doc(fb.db, 'users', uid, 'devices', oldId)).catch(() => {});
  writeDevice({ uid, id, token, checkedAt: Date.now() });
}

/**
 * Register this phone. Must be called from a tap (it may ask for the
 * notification permission). Resolves { ok, reason }, reason being
 * 'not-configured' | 'unsupported' | 'denied' | 'no-token' | 'error'.
 */
export async function registerPush(uid) {
  if (!pushConfigured()) return { ok: false, reason: 'not-configured' };
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return { ok: false, reason: 'unsupported' };
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied' };
    const M = await import(MESSAGING);
    if (!(await M.isSupported())) return { ok: false, reason: 'unsupported' };
    const fb = initFirebase();
    const token = await tokenFor(fb, M);
    if (!token) return { ok: false, reason: 'no-token' };
    const old = readDevice();
    await saveDevice(fb, uid, token, old && old.uid === uid ? old.id : null);
    return { ok: true };
  } catch (e) {
    console.warn('[pa] push register', e.code || e.message);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Keep this phone's registration alive; call on every app open, no tap
 * needed. A phone's push token changes from time to time (browser updates,
 * the push service rotating it), and the server deletes one Google calls
 * dead. Either way the phone silently stopped getting alerts while every
 * screen still said they were on. This sends the current token when it
 * changed, and once a day checks the server still has it - a fresh token
 * when it does not. Costs nothing on most opens (no read, no write).
 */
export async function refreshPush(uid) {
  if (!pushConfigured() || !registeredHere(uid) || !('serviceWorker' in navigator)) return;
  try {
    const M = await import(MESSAGING);
    if (!(await M.isSupported())) return;
    const fb = initFirebase();
    const d = readDevice();
    let token = await tokenFor(fb, M);
    if (!token) return;
    if (token === d.token) {
      if (Date.now() - (d.checkedAt || 0) < DAY_MS) return;
      const snap = await getDoc(doc(fb.db, 'users', uid, 'devices', d.id));
      if (snap.exists() && snap.data().fcmToken === token) { writeDevice({ ...d, checkedAt: Date.now() }); return; }
      if (!snap.exists()) {
        // The server dropped it as dead; the browser still had it cached.
        await M.deleteToken(M.getMessaging(fb.app)).catch(() => {});
        token = await tokenFor(fb, M);
        if (!token) return;
      }
    }
    await saveDevice(fb, uid, token, d.id);
  } catch (e) {
    console.warn('[pa] push refresh', e.code || e.message);
  }
}

/** One line for a failed registerPush(), in the operator's words. */
export function pushProblem(reason) {
  return reason === 'not-configured' ? 'Phone alerts are not switched on for this app yet.'
    : reason === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.'
    : reason === 'unsupported' ? 'This browser cannot get phone alerts. On iPhone, add the app to your Home Screen first and open it from there.'
    : 'Could not turn on phone alerts. Check your signal and try again.';
}
