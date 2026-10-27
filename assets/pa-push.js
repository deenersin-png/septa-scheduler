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

import { doc, setDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

import { initFirebase, firebaseConfig } from './pa-firebase.js';

// Web push key pair. PUBLIC by design, like the API key.
// Firebase console -> Project settings -> Cloud Messaging -> Web Push
// certificates -> Generate key pair, then paste the "Key pair" value here.
// Until then phone alerts are off and the screens say so.
export const FCM_VAPID_KEY = 'BKOjs5OGkeLtRmYFefuA4LdWQEVpSShpyOztZYirmfS9cad3YWcvBQltTqrB08ebvhbniBtkbe1AzFt5yUKBCGI';
export const pushConfigured = () => !FCM_VAPID_KEY.includes('REPLACE_ME');

const LS_DEVICE = 'pa_push_device';

/** True when THIS phone has registered for `uid`. */
export function registeredHere(uid) {
  try { const d = JSON.parse(localStorage.getItem(LS_DEVICE) || 'null'); return !!(d && d.uid === uid && d.id); } catch (_) { return false; }
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
    const { getMessaging, getToken, isSupported } = await import('https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging.js');
    if (!(await isSupported())) return { ok: false, reason: 'unsupported' };
    const fb = initFirebase();
    const reg = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href);
    const token = await getToken(getMessaging(fb.app), { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return { ok: false, reason: 'no-token' };
    // One device doc per token; the id is a short hash so it is a valid path.
    let h = 0; for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
    const id = 'fcm_' + (h >>> 0).toString(36);
    await setDoc(doc(fb.db, 'users', uid, 'devices', id), {
      fcmToken: token, platform: navigator.userAgent.slice(0, 120),
      project: firebaseConfig.projectId, updatedAt: serverTimestamp()
    });
    try { localStorage.setItem(LS_DEVICE, JSON.stringify({ uid, id })); } catch (_) {}
    return { ok: true };
  } catch (e) {
    console.warn('[pa] push register', e.code || e.message);
    return { ok: false, reason: 'error' };
  }
}

/** One line for a failed registerPush(), in the operator's words. */
export function pushProblem(reason) {
  return reason === 'not-configured' ? 'Phone alerts are not switched on for this app yet.'
    : reason === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.'
    : reason === 'unsupported' ? 'This browser cannot get phone alerts. On iPhone, add the app to your Home Screen first and open it from there.'
    : 'Could not turn on phone alerts. Check your signal and try again.';
}
