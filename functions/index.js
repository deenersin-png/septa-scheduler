// ==========================================================================
// Paddle App — Cloud Functions: the wiring.
//
//   preRunEmail      the pre-run email (below)
//   swap*            the Swap board's alerts, report counting and cleanup;
//                    the decisions are in lib/swap.js
//
// Every minute Google's scheduler calls this. What happens then — who is due,
// whether their email already went out, what to do when sending fails — is in
// lib/sender.js, where it can be tested without Google, Gmail or SEPTA. This
// file only supplies what those tests replace: the schedule, the secrets, the
// database and the real mail transport.
//
// Deploying, and what it costs: functions/README.md.
// ==========================================================================

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';

import { philadelphiaNow, ZONE } from './lib/plan.js';
import { runJob } from './lib/sender.js';
import * as SWAP from './lib/swap.js';

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');

const APP_URL = 'https://deenersin-png.github.io/septa-scheduler/home.html';

initializeApp();
const db = getFirestore();

export const preRunEmail = onSchedule({
  schedule: '* * * * *',            // every minute, in the one form every scheduler accepts
  timeZone: ZONE,
  region: 'us-east1',
  memory: '512MiB',
  timeoutSeconds: 120,
  secrets: [GMAIL_USER, GMAIL_APP_PASSWORD],
  retryCount: 0
}, async () => {
  await runJob({
    db,
    serverTimestamp: () => FieldValue.serverTimestamp(),
    now: philadelphiaNow(),         // Philadelphia's clock, not the server's
    send,
    appUrl: APP_URL,
    log: logger
  });
});

let transport = null;
async function send(to, mail) {
  // Secrets can arrive with a stray newline or space, and Google shows an app
  // password in four groups ("abcd efgh ijkl mnop"). Neither is part of the
  // password, and either would surface as "535 authentication failed".
  const user = GMAIL_USER.value().trim();
  if (!transport) {
    transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass: GMAIL_APP_PASSWORD.value().replace(/\s+/g, '') }
    });
  }
  await transport.sendMail({
    from: 'Paddle App <' + user + '>',
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html
  });
}

// ---- swap board -------------------------------------------------------------
// Same region as the database (us-east1), which Firestore triggers require.

const SWAP_URL = 'https://deenersin-png.github.io/septa-scheduler/home.html?view=swap';

// Data-only web push: sw.js shows it, so the page needs no second worker.
// Every data value must be a string.
async function sendPush(token, p) {
  await getMessaging().send({
    token,
    data: { title: p.title, body: p.body, url: p.url, tag: p.tag },
    webpush: { headers: { Urgency: 'high', TTL: '86400' } }
  });
}

const swapDeps = () => ({ db, sendPush, appUrl: SWAP_URL, log: logger,
                          deleteTree: ref => db.recursiveDelete(ref) });

export const swapInterest = onDocumentCreated({ document: 'swapOffers/{offerId}/interest/{uid}', region: 'us-east1' },
  async e => { await SWAP.onInterestCreated(swapDeps(), e.params.offerId, e.data && e.data.data()); });

export const swapStatus = onDocumentUpdated({ document: 'swapOffers/{offerId}', region: 'us-east1' },
  async e => { await SWAP.onOfferUpdated(swapDeps(), e.params.offerId, e.data.before.data(), e.data.after.data()); });

export const swapReport = onDocumentCreated({ document: 'swapReports/{reportId}', region: 'us-east1' },
  async e => { await SWAP.onReportCreated(swapDeps(), e.data && e.data.data()); });

// An offer deleted from the app leaves its interest/contact rows behind
// (the poster may not delete the other person's contact); sweep them.
export const swapDeleted = onDocumentDeleted({ document: 'swapOffers/{offerId}', region: 'us-east1' },
  async e => { await db.recursiveDelete(db.collection('swapOffers').doc(e.params.offerId)); });

export const swapCleanup = onSchedule({ schedule: '15 3 * * *', timeZone: ZONE, region: 'us-east1', retryCount: 0 },
  async () => {
    const n = await SWAP.cleanupExpired(swapDeps(), philadelphiaNow().date);
    logger.info('swap cleanup', { deleted: n });
  });
