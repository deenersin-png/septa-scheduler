// ==========================================================================
// Push to a person's phones, through Firebase Cloud Messaging (free, no limit).
//
// Every phone the person registered (assets/pa-push.js) has a doc in
// users/{uid}/devices with its fcmToken. A token Google says is dead is
// deleted, so one lost phone does not cost a failed send forever.
// ==========================================================================

const DEAD_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument'
]);

/**
 * Send one message to every registered phone of each uid.
 * deps: { db, sendPush(token, payload) -> Promise, appUrl, log }
 * msg:  { title, body, tag?, url? }
 * Resolves the number of phones reached.
 */
export async function notify(deps, uids, msg) {
  const { db, sendPush, appUrl, log } = deps;
  let sent = 0;
  for (const uid of [...new Set(uids)].filter(Boolean)) {
    const snap = await db.collection('users/' + uid + '/devices').get();
    for (const d of snap.docs) {
      const dev = d.data();
      if (!dev.fcmToken) continue;
      try {
        await sendPush(dev.fcmToken, { title: msg.title, body: msg.body, url: msg.url || appUrl, tag: msg.tag || 'pa' });
        sent++;
      } catch (e) {
        const code = e && (e.code || (e.errorInfo && e.errorInfo.code));
        if (DEAD_TOKEN.has(code)) { await d.ref.delete().catch(() => {}); }
        else if (log) log.error('push failed', { uid, code: code || String(e) });
      }
    }
  }
  return sent;
}
