import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTY_ROOM } from '../shared/scene.js';
import { nearbyObject } from '../shared/interactions.js';

test('context action follows the closest furniture and disappears out of reach', () => {
  assert.equal(nearbyObject(PARTY_ROOM, { x: 1.25, y: 6.5 })?.id, 'sofa');
  assert.equal(nearbyObject(PARTY_ROOM, { x: 11, y: 7.6 })?.id, 'table');
  assert.equal(nearbyObject(PARTY_ROOM, { x: 14.9, y: 6 })?.id, 'plant');
  assert.equal(nearbyObject(PARTY_ROOM, { x: 7, y: 7 }), null);
  assert.equal(nearbyObject(PARTY_ROOM, { x: NaN, y: 7 }), null);
});
