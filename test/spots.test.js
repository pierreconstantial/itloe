// A walkable lobby's spots (shared/minigames.js): the edge step the server runs on every walker's pos, as the
// doors do. The walking itself is tested over real sockets with the first minigame that turns it on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spotStep } from '../shared/minigames.js';

/** Two spots side by side. @type {import('../shared/minigames.js').Spot[]} */
const SPOTS = [
  { id: 'a', label: 'A', x: 2, y: 5, w: 2, h: 1, holder: null },
  { id: 'b', label: 'B', x: 4, y: 5, w: 2, h: 1, holder: null },
];

test('spots: only a step onto, off or between spots tells the minigame; a first position only sets where one stands', () => {
  /** @type {string | null | undefined} */ let before;
  const walk = (/** @type {number} */ x, /** @type {number} */ y) => {
    const { at, changed } = spotStep(SPOTS, before, x, y);
    before = at;
    return changed ? at : 'no change';
  };
  assert.equal(walk(3, 5.5), 'no change', 'first known position on a spot: not a step onto it');
  assert.equal(walk(8, 7), null, 'off it');
  assert.equal(walk(3, 5.5), 'a', 'onto a');
  assert.equal(walk(3.5, 5.8), 'no change', 'walking on a');
  assert.equal(walk(5, 5.5), 'b', 'from a straight onto b');
  assert.equal(walk(5, 7), null, 'off b');
  assert.equal(walk(9, 7), 'no change', 'walking on no spot');
});
