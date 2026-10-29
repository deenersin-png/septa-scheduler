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
