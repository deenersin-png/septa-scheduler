# Paddle App: phone alerts

Two kinds of phone notification, both sent through Firebase Cloud Messaging:

- **Before my run.** A notification at the scheduled report time minus the
  operator's lead time (15–90 min). It arrives with the app closed. Switch:
  **My run → ALERTS → Alert my phone before my run**.
- **Swap board.** Someone is interested in your offer, you were picked, a swap
  was marked arranged (with the reminder that the dispatcher must approve it),
  a picked offer was cancelled.

Plus two swap chores: an offer reported by three different operators is
hidden, and expired offers are deleted every night at 3:15 AM.

| Function | When | Decisions in |
|---|---|---|
| `runAlerts` | every minute | `lib/run-alerts.js` |
| `swapInterest`, `swapStatus`, `swapReport`, `swapDeleted` | when swap documents change | `lib/swap.js` |
| `swapCleanup` | 3:15 AM daily | `lib/swap.js` |

`npm --prefix functions test` runs them all against an in-memory database. The
deploy runs it first and stops if anything fails.

---

## Why it stays free with thousands of operators

The server never reads anyone's schedule. Each phone works out its own alert
times (`assets/pa-run-alerts.js`) and saves one small document per working day
for the next 14 days in `runAlerts/`, rewriting only what changed. Every minute
`runAlerts` does one query for alerts that are due, sends them and deletes them.

Rough numbers for 1,000 operators working 5 days a week:

| | Per day | Free per day |
|---|---|---|
| Database reads | about 3,000 (1,440 idle checks + ~2 per alert) | 50,000 |
| Database writes | about 3,000 (alerts saved, sent ones deleted, heartbeat) | 20,000 |
| Function runs | 1,440 + a few swap ones (≈45,000 a month) | 2,000,000 a month |
| Push messages | ~700 | unlimited (Cloud Messaging is free) |
| Scheduled jobs | 2 | 3 |

So the bill is **$0**. Set a budget alert anyway (Firebase console → Usage and
billing → Details & settings) so Google emails you if that ever changes.

Phones plan 14 days ahead. Someone who does not open the app for two weeks
stops getting alerts until they open it again; the ALERTS screen says so.

---

## Switching it on, once

The project is already on the Blaze plan. Two steps:

**1. The web push key.** Firebase console → Project settings → **Cloud
Messaging** → Web Push certificates → **Generate key pair**. Paste the key into
`FCM_VAPID_KEY` in `assets/pa-push.js`. It is public, like the API key.

**2. Deploy** the rules and the functions:

```bash
firebase deploy --only firestore,functions --project paddle-app-3e565
```

The first deploy also switches on the Google services functions need (Cloud
Functions, Cloud Build, Artifact Registry, Cloud Run, Eventarc, Cloud
Scheduler), which takes a few minutes.

Then each operator turns it on per phone: ALERTS → **Alert my phone before my
run**, or **Get swap alerts on this phone** under MY OFFERS. On iPhone that only
works once the app is added to the Home Screen (Apple's rule for web push).

Logs: `npm --prefix functions run logs`.
