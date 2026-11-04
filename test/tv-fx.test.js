// TV effects logic: the clear ghost includes the completing piece's cells; "+N" floaters merge / stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, newPlayer, reduce } from '../shared/game.js';
import { detectMove } from '../public/screen/events.js';
import { clearedCells } from '../public/screen/game-view.js';
import { createFloaterPlanner, MERGE_MS, LIFE_MS } from '../public/screen/floaters.js';

const SIZE = 8;

test('clear ghost: a piece completing a row → every cell of that row, the piece cells in the player colour', () => {
  // row 0 holds colour 3 except (6,0),(7,0); an h2 at (6,0) completes it
  const board = new Array(SIZE * SIZE).fill(0);
  for (let x = 0; x < 6; x++) board[x] = 3;
  const p = { ...newPlayer('a', 'Ana', 1, SIZE), board, hand: /** @type {any} */ (['h2', 'dot', 'dot']) };
  /** @type {import('../shared/game.js').State} */
  const s = { ...initState(42), phase: 'playing', hostId: 'a', order: ['a'], players: { a: p } };
  const s2 = reduce(s, { t: 'place', id: 'a', piece: 0, x: 6, y: 0 });
  assert.deepEqual(s2.players.a.last?.rows, [0], 'the row cleared');
  const m = detectMove(p, s2.players.a);
  assert.ok(m);
  assert.deepEqual([...m.cleared.keys()].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7], 'the whole row, the piece cells too');
  assert.equal(m.cleared.get(0), 3, 'cells that were there keep their colour');
  assert.equal(m.cleared.get(6), 1, 'the piece cells take the player colour');
  assert.equal(m.cleared.get(7), 1);
});

test('clearedCells: rows and cols, a crossing cell once; no lines → nothing', () => {
  const before = new Array(SIZE * SIZE).fill(2);
  const c = clearedCells(before, [1], [3], 4);
  assert.equal(c.size, SIZE + SIZE - 1);
  assert.ok(c.has(1 * SIZE + 3));
  assert.equal(clearedCells(before, [], [], 4).size, 0);
  assert.equal(clearedCells(undefined, [0], [], 4).size, 0);
});

test('floaters: gains within the merge window grow one floater; later ones stack in free slots', () => {
  const f = createFloaterPlanner();
  const a = f.add('p', 5, 0);
  assert.deepEqual([a.kind, a.slot, a.total], ['new', 0, 5]);
  const b = f.add('p', 7, MERGE_MS - 50);
  assert.deepEqual([b.kind, b.key, b.total], ['merge', a.key, 12], 'merged into the first');
  const c = f.add('p', 4, MERGE_MS - 50 + MERGE_MS + 1);
  assert.deepEqual([c.kind, c.slot], ['new', 1], 'a second floater, one slot down');
  const other = f.add('q', 9, 10);
  assert.deepEqual([other.kind, other.slot], ['new', 0], 'per player');
  const d = f.add('p', 3, LIFE_MS + 10);
  assert.equal(d.kind, 'new');
  assert.equal(d.slot, 0, 'the first floater has expired: its slot is free again');
});

test('floaters: bot speed (a move every 100 ms for 2 s) never stacks more than the screen can hold', () => {
  const f = createFloaterPlanner();
  let maxSlot = 0, shown = 0;
  for (let t = 0; t < 2000; t += 100) {
    const r = f.add('bot', 4, t);
    if (r.kind === 'new') shown++;
    maxSlot = Math.max(maxSlot, r.slot);
  }
  assert.equal(shown, Math.ceil(2000 / LIFE_MS), 'one growing floater per lifetime, the next one only once it has faded');
  assert.equal(maxSlot, 0, 'never two on top of each other');
});
