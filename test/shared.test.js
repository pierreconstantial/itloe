// P1 — test suite for shared/ (see BUILD-PLAN.md §P1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, canPlace, place, findClears, applyClears, anyFit } from '../shared/board.js';
import { PIECES, handAt } from '../shared/pieces.js';
import { initState, newPlayer, placementScore, reduce } from '../shared/game.js';

/** @typedef {import('../shared/game.js').State} State */
/** @typedef {import('../shared/game.js').Player} Player */

const SIZE = 8;

/**
 * Board of SIZE×SIZE filled with color 2 everywhere EXCEPT the given [x, y] cells.
 * @param {[number, number][]} empties
 * @returns {number[]}
 */
function fullExcept(empties) {
  const b = new Array(SIZE * SIZE).fill(2);
  for (const [x, y] of empties) b[y * SIZE + x] = 0;
  return b;
}

/**
 * Single-player playing state, player 'a' (host), with overrides on the player.
 * @param {Partial<Player>} over
 * @param {number} seed
 * @returns {State}
 */
function playing(over = {}, seed = 42) {
  const p = { ...newPlayer('a', 'Ana', 1, SIZE), ...over };
  return { ...initState(seed), phase: 'playing', hostId: 'a', order: ['a'], players: { a: p } };
}

/**
 * Empty cells: (i, i) and ((i+4)%8, i) for each row i → every row and column has
 * exactly two empty cells, all orthogonally isolated. A dot fits, an h2 never does,
 * and no placement of a dot completes a line.
 * @returns {number[]}
 */
function isolatedHolesBoard() {
  /** @type {[number, number][]} */
  const empties = [];
  for (let i = 0; i < SIZE; i++) empties.push([i, i], [(i + 4) % SIZE, i]);
  return fullExcept(empties);
}

// ---------- board.js ----------

test('canPlace: bounds and overlap', () => {
  const b = emptyBoard(SIZE);
  const h2 = PIECES.h2.cells;
  assert.equal(canPlace(b, SIZE, h2, 0, 0), true);
  assert.equal(canPlace(b, SIZE, h2, 6, 7), true); // touches right edge
  assert.equal(canPlace(b, SIZE, h2, 7, 0), false); // sticks out right
  assert.equal(canPlace(b, SIZE, PIECES.v2.cells, 0, 7), false); // sticks out bottom
  assert.equal(canPlace(b, SIZE, h2, -1, 0), false);
  assert.equal(canPlace(b, SIZE, h2, 0, -1), false);
  const occupied = place(b, SIZE, [[0, 0]], 3, 0, 1);
  assert.equal(canPlace(occupied, SIZE, h2, 2, 0), false); // overlaps (3,0)
  assert.equal(canPlace(occupied, SIZE, h2, 4, 0), true);
});

test('findClears/applyClears: cross, intersection counted once', () => {
  // Row 3 full, col 2 full, sharing cell (2,3); stray cell at (5,5).
  let b = emptyBoard(SIZE);
  for (let x = 0; x < SIZE; x++) b[3 * SIZE + x] = 1;
  for (let y = 0; y < SIZE; y++) b[y * SIZE + 2] = 1;
  b[5 * SIZE + 5] = 1;
  const clears = findClears(b, SIZE);
  assert.deepEqual(clears, { rows: [3], cols: [2] }); // 2 lines, not 3
  const after = applyClears(b, SIZE, clears);
  for (let x = 0; x < SIZE; x++) assert.equal(after[3 * SIZE + x], 0);
  for (let y = 0; y < SIZE; y++) assert.equal(after[y * SIZE + 2], 0);
  assert.equal(after[5 * SIZE + 5], 1); // untouched
});

test('anyFit: isolated holes, nulls skipped', () => {
  const b = isolatedHolesBoard();
  assert.equal(anyFit(b, SIZE, ['dot']), true);
  assert.equal(anyFit(b, SIZE, ['h2']), false);
  assert.equal(anyFit(b, SIZE, ['v2', 'h3', 'sq2']), false);
  assert.equal(anyFit(b, SIZE, [null, 'dot', null]), true);
  assert.equal(anyFit(b, SIZE, [null, null, null]), false);
});

// ---------- pieces.js ----------

test('piece set: 29 pieces, sane shapes', () => {
  const ids = Object.keys(PIECES);
  assert.equal(ids.length, 29);
  for (const id of ids) {
    const p = PIECES[id];
    assert.equal(p.id, id);
    assert.ok(p.cells.length >= 1 && p.cells.length <= 9);
    assert.ok(p.w >= 1);
    // origin convention: bounding box starts at (0,0)
    assert.equal(Math.min(...p.cells.map((c) => c[0])), 0);
    assert.equal(Math.min(...p.cells.map((c) => c[1])), 0);
  }
  assert.equal(PIECES.sq3.cells.length, 9);
  assert.equal(PIECES.h5.cells.length, 5);
});

test('handAt: deterministic, valid ids', () => {
  for (let n = 0; n < 10; n++) {
    const h = handAt(42, n);
    assert.deepEqual(h, handAt(42, n));
    assert.equal(h.length, 3);
    for (const id of h) assert.ok(PIECES[id], `unknown piece ${id}`);
  }
  // different seeds give different sequences (first 10 hands can't all collide)
  const a = [];
  const b = [];
  for (let n = 0; n < 10; n++) a.push(...handAt(1, n)), b.push(...handAt(2, n));
  assert.notDeepEqual(a, b);
});

// ---------- placementScore ----------

test('placementScore table', () => {
  assert.equal(placementScore(4, 0, 0, false), 4); // cells only
  assert.equal(placementScore(4, 1, 0, false), 14); // 1 line = 10
  assert.equal(placementScore(1, 2, 0, false), 41); // cross = 40
  assert.equal(placementScore(1, 3, 0, false), 91); // 3 lines = 90
  assert.equal(placementScore(1, 1, 2, false), 31); // streak 2 → ×3
  assert.equal(placementScore(5, 2, 1, true), 385); // 5 + 40×2 + 300
});

// ---------- reduce: join / start ----------

test('join: first is host, colors in order, caps and guards', () => {
  let s = initState(42);
  s = reduce(s, { t: 'join', id: 'a', name: 'Ana' });
  assert.equal(s.hostId, 'a');
  assert.equal(s.players.a.color, 1);
  s = reduce(s, { t: 'join', id: 'b', name: 'Bob' });
  assert.equal(s.hostId, 'a');
  assert.equal(s.players.b.color, 2);
  assert.deepEqual(s.order, ['a', 'b']);

  assert.equal(reduce(s, { t: 'join', id: 'a', name: 'Dup' }), s); // duplicate id
  assert.equal(reduce(s, { t: 'join', id: 'x', name: '  ' }), s); // blank name

  s = reduce(s, { t: 'join', id: 'c', name: 'Cal' });
  s = reduce(s, { t: 'join', id: 'd', name: 'Dan' });
  assert.equal(reduce(s, { t: 'join', id: 'e', name: 'Eve' }), s); // full (4)
});

test('start: host only, deals the same hand 0 to everyone', () => {
  let s = initState(42);
  s = reduce(s, { t: 'join', id: 'a', name: 'Ana' });
  s = reduce(s, { t: 'join', id: 'b', name: 'Bob' });
  assert.equal(reduce(s, { t: 'start', id: 'b' }), s); // not host
  const started = reduce(s, { t: 'start', id: 'a' });
  assert.equal(started.phase, 'playing');
  assert.deepEqual(started.players.a.hand, handAt(42, 0));
  assert.deepEqual(started.players.b.hand, handAt(42, 0)); // fairness: identical hands
  assert.equal(started.players.a.handIndex, 0);
  assert.equal(reduce(started, { t: 'start', id: 'a' }), started); // already playing
  assert.equal(reduce(started, { t: 'join', id: 'e', name: 'Eve' }), started); // no join mid-game
});

// ---------- reduce: place ----------

test('place: writes cells, scores cells, consumes the slot, pure', () => {
  const s = playing({ hand: ['h3', 'dot', 'dot'] });
  const snapshot = JSON.stringify(s);
  const s2 = reduce(s, { t: 'place', id: 'a', piece: 0, x: 2, y: 5 });
  assert.notEqual(s2, s);
  assert.equal(JSON.stringify(s), snapshot); // input not mutated
  const p = s2.players.a;
  assert.equal(p.score, 3);
  assert.deepEqual(p.hand, [null, 'dot', 'dot']);
  assert.equal(p.handIndex, 0); // no refill yet
  for (let i = 0; i < 3; i++) assert.equal(p.board[5 * SIZE + (2 + i)], 1); // player color
  assert.equal(p.streak, 0);
  assert.equal(p.graceLeft, 0); // non-clearing placement spent the grace
});

test('place: invalid actions return the same state object', () => {
  const lobby = initState(42);
  assert.equal(reduce(lobby, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 }), lobby);

  const s = playing({ hand: ['h2', null, 'dot'] });
  assert.equal(reduce(s, { t: 'place', id: 'zz', piece: 0, x: 0, y: 0 }), s); // unknown player
  assert.equal(reduce(s, { t: 'place', id: 'a', piece: 1, x: 0, y: 0 }), s); // null slot
  assert.equal(reduce(s, /** @type {any} */ ({ t: 'place', id: 'a', piece: 3, x: 0, y: 0 })), s);
  assert.equal(reduce(s, { t: 'place', id: 'a', piece: 0, x: 7, y: 0 }), s); // out of bounds
  const blocked = playing({ hand: ['h2', null, null], board: fullExcept([[0, 0]]) });
  assert.equal(reduce(blocked, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 }), blocked); // overlap
  const done = playing({ hand: ['dot', null, null], done: true });
  assert.equal(reduce(done, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 }), done); // done player
  assert.equal(reduce(s, /** @type {any} */ ({ t: 'nope' })), s); // unknown action
});

test('place: cross clear scores 10×L², intersection once', () => {
  // Row 3 and col 2 both miss only (2,3); stray at (5,5) prevents plateau net.
  let board = emptyBoard(SIZE);
  for (let x = 0; x < SIZE; x++) if (x !== 2) board[3 * SIZE + x] = 2;
  for (let y = 0; y < SIZE; y++) if (y !== 3) board[y * SIZE + 2] = 2;
  board[5 * SIZE + 5] = 2;
  const s = playing({ board, hand: ['dot', null, null] });
  const p = reduce(s, { t: 'place', id: 'a', piece: 0, x: 2, y: 3 }).players.a;
  assert.equal(p.score, 1 + 10 * 4); // 1 cell + 10×2²×(1+0)
  assert.equal(p.streak, 1);
  assert.equal(p.board[5 * SIZE + 5], 2); // stray survives
  assert.equal(p.board.filter((c) => c !== 0).length, 1); // row + col gone, counted once
});

test('place: plateau net +300', () => {
  let board = emptyBoard(SIZE);
  for (let x = 0; x < SIZE; x++) if (x !== 7) board[0 * SIZE + x] = 2;
  const s = playing({ board, hand: ['dot', null, null] });
  const p = reduce(s, { t: 'place', id: 'a', piece: 0, x: 7, y: 0 }).players.a;
  assert.equal(p.score, 1 + 10 + 300);
  assert.ok(p.board.every((c) => c === 0));
});

test('streak and grace transitions', () => {
  // Clearing board: row 0 misses (7,0); stray at (0,5) avoids plateau.
  const clearing = () => {
    const b = emptyBoard(SIZE);
    for (let x = 0; x < SIZE; x++) if (x !== 7) b[0 * SIZE + x] = 2;
    b[5 * SIZE + 0] = 2;
    return b;
  };
  const act = /** @type {const} */ ({ t: 'place', id: 'a', piece: 0, x: 7, y: 0 });
  const nonClearAct = /** @type {const} */ ({ t: 'place', id: 'a', piece: 0, x: 4, y: 4 });

  // clearing with streak 2 → ×3, streak 3, grace restored
  let p = reduce(playing({ board: clearing(), hand: ['dot', null, null], streak: 2, graceLeft: 0 }), act).players.a;
  assert.equal(p.score, 1 + 10 * 3);
  assert.equal(p.streak, 3);
  assert.equal(p.graceLeft, 1);

  // first non-clearing placement: streak kept, grace spent
  p = reduce(playing({ hand: ['dot', null, null], streak: 2, graceLeft: 1 }), nonClearAct).players.a;
  assert.equal(p.streak, 2);
  assert.equal(p.graceLeft, 0);

  // second non-clearing placement: streak resets
  p = reduce(playing({ hand: ['dot', null, null], streak: 2, graceLeft: 0 }), nonClearAct).players.a;
  assert.equal(p.streak, 0);
});

test('refill happens exactly when all 3 slots are null', () => {
  const seed = 42;
  // last piece of the hand → refill with handAt(seed, 1)
  let s = playing({ hand: [null, 'dot', null] }, seed);
  let p = reduce(s, { t: 'place', id: 'a', piece: 1, x: 0, y: 0 }).players.a;
  assert.equal(p.handIndex, 1);
  assert.deepEqual(p.hand, handAt(seed, 1));
  assert.equal(p.done, false);

  // two pieces left → no refill
  s = playing({ hand: ['dot', 'dot', 'dot'] }, seed);
  p = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 }).players.a;
  assert.equal(p.handIndex, 0);
  assert.deepEqual(p.hand, [null, 'dot', 'dot']);
});

test('stuck → done; last player done → finished', () => {
  const s = playing({ board: isolatedHolesBoard(), hand: ['dot', 'h2', null] });
  const s2 = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  const p = s2.players.a;
  assert.equal(p.streak, 0); // no line completed
  assert.equal(p.done, true); // h2 fits nowhere
  assert.equal(s2.phase, 'finished'); // single player → game over
});

test('one player stuck, the other alive → still playing', () => {
  const a = { ...newPlayer('a', 'Ana', 1, SIZE), board: isolatedHolesBoard(), hand: /** @type {(string|null)[]} */ (['dot', 'h2', null]) };
  const b = newPlayer('b', 'Bob', 2, SIZE);
  b.hand = ['dot', 'dot', 'dot'];
  /** @type {State} */
  const s = { ...initState(42), phase: 'playing', hostId: 'a', order: ['a', 'b'], players: { a, b } };
  const s2 = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  assert.equal(s2.players.a.done, true);
  assert.equal(s2.phase, 'playing');
  // b gets stuck too → finished
  const s3 = {
    ...s2,
    players: { ...s2.players, b: { ...s2.players.b, board: isolatedHolesBoard(), hand: /** @type {(string|null)[]} */ (['dot', 'h2', null]) } },
  };
  const s4 = reduce(s3, { t: 'place', id: 'b', piece: 0, x: 1, y: 1 });
  assert.equal(s4.players.b.done, true);
  assert.equal(s4.phase, 'finished');
});

// ---------- reduce: again ----------

test('again: host only, new seed, fresh boards, same players', () => {
  let s = initState(42);
  s = reduce(s, { t: 'join', id: 'a', name: 'Ana' });
  s = reduce(s, { t: 'join', id: 'b', name: 'Bob' });
  s = reduce(s, { t: 'start', id: 'a' });
  assert.equal(reduce(s, { t: 'again', id: 'a' }), s); // not finished yet
  /** @type {State} */
  const finished = { ...s, phase: 'finished' };
  assert.equal(reduce(finished, { t: 'again', id: 'b' }), finished); // not host

  const again = reduce(finished, { t: 'again', id: 'a' });
  assert.equal(again.phase, 'playing');
  assert.notEqual(again.seed, 42); // new seed
  assert.deepEqual(again.order, ['a', 'b']);
  assert.equal(again.players.a.name, 'Ana');
  assert.equal(again.players.b.color, 2);
  assert.equal(again.players.a.score, 0);
  assert.ok(again.players.a.board.every((c) => c === 0));
  assert.deepEqual(again.players.a.hand, handAt(again.seed, 0));
  assert.deepEqual(again.players.b.hand, handAt(again.seed, 0));
});

// ---------- full deterministic game ----------

test('smoke: a full 2-player game plays to the podium', () => {
  let s = initState(7);
  s = reduce(s, { t: 'join', id: 'a', name: 'Ana' });
  s = reduce(s, { t: 'join', id: 'b', name: 'Bob' });
  s = reduce(s, { t: 'start', id: 'a' });

  /** @type {(state: State, id: string) => State} */
  const autoPlace = (state, id) => {
    const p = state.players[id];
    for (const piece of /** @type {const} */ ([0, 1, 2])) {
      const pid = p.hand[piece];
      if (pid === null) continue;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if (canPlace(p.board, SIZE, PIECES[pid].cells, x, y)) {
            return reduce(state, { t: 'place', id, piece, x, y });
          }
        }
      }
    }
    assert.fail(`player ${id} not done but no placement found`);
  };

  let guard = 500;
  while (s.phase === 'playing' && guard-- > 0) {
    for (const id of s.order) if (!s.players[id].done) s = autoPlace(s, id);
  }
  assert.equal(s.phase, 'finished');
  assert.ok(s.players.a.done && s.players.b.done);
  assert.ok(s.players.a.score > 0 && s.players.b.score > 0);
  assert.ok(s.players.a.handIndex >= 1, 'at least one refill happened');
});
