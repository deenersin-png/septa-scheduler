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

const B9112 = [trip('9112', 377, PINE), trip('9112', 430, '38th Parellel Pl', 1)];   // 6:17 AM first trip
const PULLOUTS = new Map([['9112', 354]]);                                           // pulls out 5:54 AM
// The pairing store as knownBus sees it: bus 3398 last seen on 9112 at `seenMs`.
const store = seenMs => (block, route, busyAt, sinceTs = 0) => (seenMs >= sinceTs ? '3398' : '');
const model = (nowMin, seenMs) => buildBusModel({ block: '9112', allTrips: B9112, buses: [], nowMin, pullOuts: PULLOUTS, knownBus: store(seenMs) });

test('before the block pulls out today it has no bus, whatever was seen on it yesterday', () => {
  assert.equal(model(300, Date.now() - 60000).VehicleID, '');            // 5:00 AM
});

test('after the pull-out, a bus last seen before it (yesterday) does not count', () => {
  const yesterday = Date.now() - 10 * 3600000;
  assert.equal(model(380, yesterday).VehicleID, '');                     // 6:20 AM
});

test('a bus seen since the pull-out keeps its number between trips', () => {
  assert.equal(model(380, Date.now() - 5 * 60000).VehicleID, '3398');
});

test('without pull-out times the old rule stands', () => {
  const m = buildBusModel({ block: '9112', allTrips: B9112, buses: [], nowMin: 300, knownBus: store(Date.now() - 10 * 3600000) });
  assert.equal(m.VehicleID, '3398');
});
