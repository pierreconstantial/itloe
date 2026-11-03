// P1 owns this file — replace with the real suite (see BUILD-PLAN.md §P1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard } from '../shared/board.js';
import { handAt } from '../shared/pieces.js';

test('scaffold sanity', () => {
  assert.equal(emptyBoard(8).length, 64);
  assert.deepEqual(handAt(42, 0), handAt(42, 0));
});
