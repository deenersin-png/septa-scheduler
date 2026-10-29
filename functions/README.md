# Paddle App: phone alerts

Two kinds of phone notification, both sent through Firebase Cloud Messaging:

- **My run.** Two report alerts (default 30 and 1 min before report time) and
  an alert at every departure (default on time: the pull-out, each trip, the
  next piece). Each has its own switch and lead time. They arrive with the app
  closed; there are no in-app alerts. Screen: **My run → ALERTS**.
- **Swap board.** Someone is interested in your offer, you were picked, a swap
  was marked arranged (with the reminder that the dispatcher must approve it),
  a picked offer was cancelled.

Plus three swap chores: an offer reported by three different operators is
hidden; an offer whose run has started without an arranged swap is deleted
that minute (inside `runAlerts`, using the offer's `startsAtMs`); and expired
offers are deleted every night at 3:15 AM.

| Function | When | Decisions in |
|---|---|---|
| `runAlerts` | every minute | `lib/run-alerts.js`, then `expireStarted` in `lib/swap.js` |
| `swapInterest`, `swapStatus`, `swapReport`, `swapDeleted` | when swap documents change | `lib/swap.js` |
| `swapCleanup` | 3:15 AM daily | `lib/swap.js` |

`npm --prefix functions test` runs them all against an in-memory database. The
deploy runs it first and stops if anything fails.

---

## Why it stays free with thousands of operators

The server never reads anyone's schedule. Each phone works out its own alert
times (`assets/pa-run-alerts.js`) and saves one small document per alert in
`runAlerts/` (`{uid}_{date}_{key}`), rewriting only what changed: report
alerts 14 days ahead, departure alerts about a week ahead. Every minute
`runAlerts` does one query for alerts that are due, sends them and deletes them.

Rough numbers for 1,000 operators working 5 days a week, every alert switched
on (2 report alerts + about 15 departures a working day):

| | Per day | Free per day |
|---|---|---|
| Database reads | about 40,000 (2 × 1,440 idle checks + ~3 per alert) | 50,000 |
| Database writes | about 14,000 (alerts saved, heartbeat) | 20,000 |
| Database deletes | about 12,000 (sent alerts) | 20,000 |
| Function runs | 1,440 + a few swap ones (≈45,000 a month) | 2,000,000 a month |
| Push messages | ~12,000 | unlimited (Cloud Messaging is free) |
| Scheduled jobs | 2 | 3 |

Departure alerts are most of it. Up to about 1,000 operators the bill is
**$0**; past the free allowance it is cents a day (reads $0.06 per 100,000,
writes $0.18 per 100,000). Set a budget alert anyway (Firebase console → Usage
and billing → Details & settings) so Google emails you if that ever changes.

Someone who does not open the app for a week stops getting departure alerts,
and after two weeks report alerts, until they open it again; the ALERTS screen
says so.

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
