// Who leads whom: assets/pa-live-cards.js leaderForTrip, on route 42 trips as
// GTFS has them around block 9102's 5:05 AM departure (weekday, Fall 2026).
//
//   node --test assets/tests/leaders.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { leaderForTrip } from '../pa-live-cards.js';

const trip = (block, s, first, dir = 0) => ({ block, s, e: s + 40, route: '42', dir, first, tripId: block + '-' + s });
const PINE = '61st St & Pine St', WYCOMBE = 'Wycombe Loop';
const ALL = [
  trip('9104', 275, PINE),          // 4:35 from 61st & Pine
  trip('9101', 284, WYCOMBE),       // 4:44 from the far end of the line
  trip('9102', 305, PINE),          // mine, 5:05
  trip('9106', 316, WYCOMBE),
  trip('9107', 290, PINE, 1)        // other direction
];

test('the bus that left my first stop before me leads, not a later start further out', () => {
  assert.equal(leaderForTrip(ALL, '9102', ALL[2], null).block, '9104');
});

test('with no earlier bus from my stop, the latest earlier trip in my direction leads', () => {
  const mine = trip('9102', 305, 'Walnut St & 5th St');
  assert.equal(leaderForTrip(ALL, '9102', mine, null).block, '9101');
});

test('a block that has already pulled in never leads', () => {
  const pullIns = new Map([['9104', 270]]);
  assert.equal(leaderForTrip(ALL, '9102', ALL[2], pullIns).block, '9101');
});

// ---- a leader's bus number: today's only -----------------------------------

import { buildBusModel } from '../pa-live-cards.js';
import { blockOutSince } from '../pa-schedule.js';

const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();      // October 2026, local time
const PO_9112 = 6 * 60 + 8, PI_9112 = 19 * 60;                     // out 6:08 AM, in 7:00 PM

test('before the block pulls out today, it is in: no bus', () => {
  assert.equal(blockOutSince(PO_9112, PI_9112, at(29, 5, 0)), Infinity);       // Thu 5:00 AM
});

test('from 30 min before the pull-out, only a bus seen since then counts', () => {
  assert.equal(blockOutSince(PO_9112, PI_9112, at(29, 5, 40)), at(29, 5, 38));
  assert.equal(blockOutSince(PO_9112, PI_9112, at(29, 14, 0)), at(29, 5, 38));
});

test('a block out past midnight keeps the bus it pulled out with', () => {
  // out 5:00 PM, in 1:30 AM: at 1:00 AM Thursday it is still Wednesday's bus
  assert.equal(blockOutSince(17 * 60, 90, at(29, 1, 0)), at(28, 16, 30));
});

test('a night liner pulled out after midnight', () => {
  // 9102: out 1:27 AM, in 10:46 AM
  assert.equal(blockOutSince(87, 646, at(29, 2, 0)), at(29, 0, 57));
  assert.equal(blockOutSince(87, 646, at(29, 23, 0)), Infinity);
});

test('no pull-out in the pick: no limit', () => {
  assert.equal(blockOutSince(null, null, at(29, 5, 0)), 0);
});

test('the leader card shows no bus before the pull-out, and keeps the bus seen since', () => {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const B = [trip('9112', nowMin + 120, PINE), trip('9112', nowMin + 180, '38th Parellel Pl', 1)];
  const store = seenMs => (block, route, busyAt, sinceTs = 0) => (seenMs >= sinceTs ? '3398' : '');
  const card = (po, pi, seenMs) => buildBusModel({ block: '9112', allTrips: B, buses: [], nowMin,
    pullOuts: new Map([['9112', po]]), pullIns: new Map([['9112', pi]]), knownBus: store(seenMs) }).VehicleID;
  // pulls out in 90 min, last pulled in 2 h ago: in for now, yesterday's bus ignored
  assert.equal(card(nowMin + 90, nowMin + 1320, Date.now() - 10 * 3600000), '');   // 1320 = 2 h ago on the clock
  // pulled out an hour ago: yesterday's bus ignored, one seen 5 min ago kept
  assert.equal(card(nowMin - 60, nowMin + 600, Date.now() - 10 * 3600000), '');
  assert.equal(card(nowMin - 60, nowMin + 600, Date.now() - 5 * 60000), '3398');
});

test('a block before its pull-out is "not out yet", with no bus; after it, missing data is just missing', () => {
  // 9104: pulls out 4:28 AM, first trip 4:35 AM; at 2:00 AM it is not out yet
  const B = [trip('9104', 275, PINE), trip('9104', 324, '38th Parellel Pl', 1)];
  const paired = () => '3398';
  const m = nowMin => buildBusModel({ block: '9104', allTrips: B, buses: [], nowMin, pullOuts: new Map([['9104', 268]]), knownBus: paired });
  const early = m(120);
  assert.equal(early._notOutYet, true);
  assert.equal(early._outAtMin, 268);
  assert.equal(early.VehicleID, '');
  const late = m(270);                                   // 4:30 AM: pulled out, first trip not yet run
  assert.equal(late._notOutYet, false);
  // no pick pull-out: the first trip decides
  const noPick = buildBusModel({ block: '9104', allTrips: B, buses: [], nowMin: 120, knownBus: paired });
  assert.equal(noPick._notOutYet, true);
  assert.equal(noPick._outAtMin, 275);
  assert.equal(noPick._outIsPullOut, false);
});
