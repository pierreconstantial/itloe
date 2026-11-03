// P1 — test suite for shared/ (see BUILD-PLAN.md §P1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, canPlace, place, findClears, applyClears, anyFit, legalPlacementCount } from '../shared/board.js';
import { PIECES, PIECE_SETS, handAt } from '../shared/pieces.js';
import {
  DEFAULT_SETTINGS, SETTINGS_SCHEMA, initState, newPlayer, normalizeSettings, placementScore, ranking, reduce,
} from '../shared/game.js';

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

// ---------- ranking (P5 contract addition) ----------

test('ranking: ties share a rank, standard competition (1,1,3), join order within ties', () => {
  const s = initState(42);
  s.order = ['a', 'b', 'c', 'd'];
  s.players = {
    a: { ...newPlayer('a', 'Ana', 1, SIZE), score: 10 },
    b: { ...newPlayer('b', 'Bob', 2, SIZE), score: 30 },
    c: { ...newPlayer('c', 'Cal', 3, SIZE), score: 30 },
    d: { ...newPlayer('d', 'Dan', 4, SIZE), score: 5 },
  };
  assert.deepEqual(ranking(s), [
    { id: 'b', rank: 1, score: 30 },
    { id: 'c', rank: 1, score: 30 },
    { id: 'a', rank: 3, score: 10 },
    { id: 'd', rank: 4, score: 5 },
  ]);
});

// ---------- legalPlacementCount + Player.last (Q1 contract additions) ----------

test('legalPlacementCount: counts slots, respects limit, null slots skipped', () => {
  const b = isolatedHolesBoard(); // 16 isolated empty cells
  assert.equal(legalPlacementCount(b, SIZE, ['dot']), 16);
  assert.equal(legalPlacementCount(b, SIZE, ['dot', 'dot', null]), 32); // same id in two slots counts twice
  assert.equal(legalPlacementCount(b, SIZE, ['h2']), 0);
  assert.equal(legalPlacementCount(b, SIZE, ['dot'], 3), 3);
});

test('Player.last: move record on each place, with clears before applyClears', () => {
  const b = emptyBoard(SIZE);
  for (let x = 0; x < 7; x++) b[x] = 2; // row 0 full except (7,0)
  let s = playing({ board: b, hand: ['dot', 'h2', 'h3'] });
  s = reduce(s, { t: 'place', id: 'a', piece: 0, x: 7, y: 0 });
  const l1 = s.players.a.last;
  assert.ok(l1);
  assert.equal(l1.n, 1);
  assert.equal(l1.pieceId, 'dot');
  assert.deepEqual([l1.x, l1.y], [7, 0]);
  assert.deepEqual(l1.rows, [0]);
  assert.deepEqual(l1.cols, []);
  assert.equal(l1.cleanBoard, true); // the board held only row 0
  assert.equal(l1.streak, 1);
  assert.equal(l1.gained, placementScore(1, 1, 0, true));

  s = reduce(s, { t: 'place', id: 'a', piece: 1, x: 0, y: 4 });
  const l2 = s.players.a.last;
  assert.ok(l2);
  assert.equal(l2.n, 2);
  assert.deepEqual(l2.rows, []);
  assert.equal(l2.cleanBoard, false);
});

// ---------- Q4: settings, timed mode, piece sets ----------

const SZT = ['s_h', 'z_h', 's_v', 'z_v', 't_down', 't_up', 't_right', 't_left'];

/**
 * Lobby with host 'a' and player 'b'.
 * @param {Partial<import('../shared/game.js').Settings>} [settings]
 * @returns {State}
 */
function lobby2(settings) {
  let s = initState(42, settings);
  s = reduce(s, { t: 'join', id: 'a', name: 'Ana' });
  return reduce(s, { t: 'join', id: 'b', name: 'Bob' });
}

test('defaults = M1 behaviour; initState normalizes the settings it is given', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    size: 8, mode: 'marathon', timedSeconds: 180, pieceSet: 'full', grace: 1, cleanBoardBonus: 300,
  });
  const s = initState(1);
  assert.deepEqual(s.settings, DEFAULT_SETTINGS);
  assert.deepEqual(s.rules, DEFAULT_SETTINGS);
  assert.equal(s.size, 8);
  assert.equal(s.deadline, null);
  assert.equal(s.endReason, null);
  const t = initState(1, { size: 10, timedSeconds: 999, pieceSet: /** @type {any} */ ('weird') });
  assert.equal(t.size, 10);
  assert.equal(t.rules.size, 10);
  assert.equal(t.settings.timedSeconds, 300);
  assert.equal(t.settings.pieceSet, 'full');
  assert.deepEqual(Object.keys(SETTINGS_SCHEMA).sort(), Object.keys(DEFAULT_SETTINGS).sort());
});

test('normalizeSettings: clamp + snap ranges, reject bad choices, ignore junk', () => {
  const n = (/** @type {unknown} */ patch) => normalizeSettings(patch);
  assert.equal(n({ timedSeconds: 10 }).timedSeconds, 60);
  assert.equal(n({ timedSeconds: 1e9 }).timedSeconds, 300);
  assert.equal(n({ timedSeconds: 100 }).timedSeconds, 90); // snapped to step 30 from 60
  assert.equal(n({ timedSeconds: 106 }).timedSeconds, 120);
  assert.equal(n({ cleanBoardBonus: -5 }).cleanBoardBonus, 0);
  assert.equal(n({ cleanBoardBonus: 520 }).cleanBoardBonus, 500);
  assert.equal(n({ cleanBoardBonus: 130 }).cleanBoardBonus, 150);
  assert.equal(n({ cleanBoardBonus: NaN }).cleanBoardBonus, 300);
  assert.equal(n({ timedSeconds: '120' }).timedSeconds, 180); // string → ignored
  assert.equal(n({ size: 11 }).size, 8); // choice: not in values → ignored
  assert.equal(n({ size: 9 }).size, 9);
  assert.equal(n({ grace: 3 }).grace, 1);
  assert.equal(n({ grace: 0 }).grace, 0);
  assert.equal(n({ mode: 'TIMED' }).mode, 'marathon');
  assert.equal(n({ pieceSet: 'simple' }).pieceSet, 'simple');
  assert.deepEqual(n({ bogus: 1, __proto__: { size: 10 } }), DEFAULT_SETTINGS);
  for (const junk of [null, undefined, 42, 'x', [1]]) assert.deepEqual(n(junk), DEFAULT_SETTINGS);
  const base = normalizeSettings({ size: 10 });
  assert.equal(normalizeSettings({ grace: 2 }, base).size, 10); // patch applies on top of base
});

test('config: host only, lobby/finished only, no-op patch → same state', () => {
  const s = lobby2();
  assert.equal(reduce(s, { t: 'config', id: 'b', patch: { size: 9 } }), s); // not host
  assert.equal(reduce(s, { t: 'config', id: 'a', patch: { size: 8 } }), s); // no change
  assert.equal(reduce(s, { t: 'config', id: 'a', patch: /** @type {any} */ ({ size: 7 }) }), s); // invalid → no change
  assert.equal(reduce(s, { t: 'config', id: 'a', patch: /** @type {any} */ (null) }), s);
  const started = reduce(s, { t: 'start', id: 'a' });
  assert.equal(reduce(started, { t: 'config', id: 'a', patch: { size: 9 } }), started); // locked mid-game
});

test('config in lobby: settings + rules + size + lobby boards follow', () => {
  const s = reduce(lobby2(), { t: 'config', id: 'a', patch: { size: 10, grace: 2 } });
  assert.equal(s.settings.size, 10);
  assert.equal(s.rules.size, 10);
  assert.equal(s.size, 10);
  assert.equal(s.players.a.board.length, 100);
  assert.equal(s.players.b.graceLeft, 2);
  assert.deepEqual(s.order, ['a', 'b']);
  assert.equal(s.players.b.color, 2);
  const joined = reduce(s, { t: 'join', id: 'c', name: 'Cal' });
  assert.equal(joined.players.c.board.length, 100); // late joiner gets the current size
});

test('config in finished: only settings change, again locks them in', () => {
  const s = reduce(lobby2(), { t: 'start', id: 'a' });
  /** @type {State} */
  const fin = { ...s, phase: 'finished' };
  const cfg = reduce(fin, { t: 'config', id: 'a', patch: { size: 9, pieceSet: 'simple' } });
  assert.equal(cfg.settings.size, 9);
  assert.equal(cfg.rules.size, 8); // podium boards still 8×8
  assert.equal(cfg.size, 8);
  assert.equal(cfg.players.a.board, fin.players.a.board);
  const again = reduce(cfg, { t: 'again', id: 'a' });
  assert.equal(again.rules.size, 9);
  assert.equal(again.size, 9);
  assert.equal(again.rules.pieceSet, 'simple');
  assert.equal(again.players.a.board.length, 81);
  assert.deepEqual(again.players.a.hand, handAt(again.seed, 0, 'simple'));
});

test('size 9 and 10: boards sized at start, full rows of that width clear', () => {
  for (const size of /** @type {const} */ ([9, 10])) {
    let s = reduce(lobby2({ size }), { t: 'start', id: 'a' });
    assert.equal(s.size, size);
    assert.equal(s.players.a.board.length, size * size);
    // fill row 0 except the last cell, plus a stray to avoid a clean board
    const board = emptyBoard(size);
    for (let x = 0; x < size - 1; x++) board[x] = 2;
    board[3 * size + 3] = 2;
    s = { ...s, players: { ...s.players, a: { ...s.players.a, board, hand: ['dot', 'dot', 'dot'] } } };
    assert.equal(reduce(s, { t: 'place', id: 'a', piece: 0, x: size, y: 0 }), s); // out of bounds
    const p = reduce(s, { t: 'place', id: 'a', piece: 0, x: size - 1, y: 0 }).players.a;
    assert.deepEqual(p.last?.rows, [0]);
    assert.equal(p.score, 1 + 10);
    assert.equal(p.board.filter((c) => c !== 0).length, 1);
  }
});

test('piece sets: simple never deals S/Z/T, full unchanged for an existing seed', () => {
  assert.deepEqual(Object.keys(PIECE_SETS.simple.weights).length, 21);
  for (const id of SZT) assert.equal(PIECE_SETS.simple.weights[id], undefined);
  for (const id of Object.keys(PIECES)) assert.equal(PIECE_SETS.full.weights[id], PIECES[id].w);
  for (const seed of [1, 42, 987654]) {
    for (let n = 0; n < 500; n++) {
      for (const id of handAt(seed, n, 'simple')) assert.ok(!SZT.includes(id), `${id} in simple set`);
    }
  }
  // pinned from the pre-Q4 handAt: tuning-free refactor must not move existing sequences
  assert.deepEqual(handAt(42, 0), ['r2x3', 't_left', 's_h']);
  assert.deepEqual(handAt(42, 3), ['sq3', 'v3', 'h5']);
  assert.deepEqual(handAt(42, 0, 'full'), handAt(42, 0));
  assert.throws(() => handAt(42, 0, /** @type {any} */ ('nope')));
  // reduce deals from rules.pieceSet, including refills
  let s = reduce(lobby2({ pieceSet: 'simple' }), { t: 'start', id: 'a' });
  assert.deepEqual(s.players.a.hand, handAt(42, 0, 'simple'));
  s = { ...s, players: { ...s.players, a: { ...s.players.a, hand: [null, null, 'dot'] } } };
  s = reduce(s, { t: 'place', id: 'a', piece: 2, x: 0, y: 0 });
  assert.deepEqual(s.players.a.hand, handAt(42, 1, 'simple'));
});

test('grace 0 and 2, custom clean-board bonus', () => {
  /** @param {Partial<import('../shared/game.js').Settings>} rules @param {Partial<Player>} over */
  const st = (rules, over) => {
    const base = playing(over);
    return { ...base, rules: { ...base.rules, ...rules } };
  };
  const nonClear = /** @type {const} */ ({ t: 'place', id: 'a', piece: 0, x: 4, y: 4 });
  // grace 0: first non-clearing placement resets the streak
  let p = reduce(st({ grace: 0 }, { hand: ['dot', 'dot', null], streak: 3, graceLeft: 0 }), nonClear).players.a;
  assert.equal(p.streak, 0);
  // grace 2: two forgiven, third resets
  let s = st({ grace: 2 }, { hand: ['dot', 'dot', 'dot'], streak: 3, graceLeft: 2 });
  s = reduce(s, nonClear);
  assert.deepEqual([s.players.a.streak, s.players.a.graceLeft], [3, 1]);
  s = reduce(s, { t: 'place', id: 'a', piece: 1, x: 0, y: 7 });
  assert.deepEqual([s.players.a.streak, s.players.a.graceLeft], [3, 0]);
  s = reduce(s, { t: 'place', id: 'a', piece: 2, x: 7, y: 7 });
  assert.equal(s.players.a.streak, 0);
  // a clear restores graceLeft to rules.grace
  const row = emptyBoard(SIZE);
  for (let x = 0; x < 7; x++) row[x] = 2;
  p = reduce(st({ grace: 2, cleanBoardBonus: 50 }, { board: row, hand: ['dot', null, null], graceLeft: 0 }),
    { t: 'place', id: 'a', piece: 0, x: 7, y: 0 }).players.a;
  assert.equal(p.graceLeft, 2);
  assert.equal(p.score, 1 + 10 + 50); // clean board with bonus 50
  assert.equal(p.last?.gained, 61);
  assert.equal(placementScore(1, 1, 0, true, 0), 11);
  assert.equal(placementScore(1, 1, 0, true), 311); // default stays 300
  // start initializes graceLeft from rules
  const g = reduce(lobby2({ grace: 0 }), { t: 'start', id: 'a' });
  assert.equal(g.players.a.graceLeft, 0);
});

test('timed: start/again set the deadline from now; now required', () => {
  const s = lobby2({ mode: 'timed', timedSeconds: 120 });
  assert.equal(reduce(s, { t: 'start', id: 'a' }), s); // timed without now → invalid
  assert.equal(reduce(s, { t: 'start', id: 'a', now: NaN }), s);
  const started = reduce(s, { t: 'start', id: 'a', now: 1_000_000 });
  assert.equal(started.phase, 'playing');
  assert.equal(started.deadline, 1_000_000 + 120_000);
  assert.equal(started.endReason, null);
  // marathon ignores now and has no deadline
  const m = reduce(lobby2(), { t: 'start', id: 'a', now: 5 });
  assert.equal(m.deadline, null);
  assert.equal(reduce(m, { t: 'timeUp', deadline: 5 }), m);
});

test('timed: timeUp ends the game, matching deadline only; place after is rejected', () => {
  let s = reduce(lobby2({ mode: 'timed', timedSeconds: 60 }), { t: 'start', id: 'a', now: 0 });
  s = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  const lastA = s.players.a.last;
  assert.ok(lastA);
  assert.equal(reduce(s, { t: 'timeUp', deadline: 59_999 }), s); // stale / wrong deadline
  const end = reduce(s, { t: 'timeUp', deadline: 60_000 });
  assert.equal(end.phase, 'finished');
  assert.equal(end.endReason, 'time');
  assert.ok(end.players.a.done && end.players.b.done);
  assert.equal(end.players.a.last, lastA); // final move record kept
  assert.equal(end.players.a.score, s.players.a.score);
  assert.equal(reduce(end, { t: 'timeUp', deadline: 60_000 }), end); // idempotent
  assert.equal(reduce(end, { t: 'place', id: 'b', piece: 0, x: 0, y: 0 }), end);
  // again resets the clock; the old timer is now stale
  const again = reduce(end, { t: 'again', id: 'a', now: 500_000 });
  assert.equal(again.phase, 'playing');
  assert.equal(again.deadline, 560_000);
  assert.equal(again.endReason, null);
  assert.equal(reduce(again, { t: 'timeUp', deadline: 60_000 }), again);
  assert.equal(reduce(end, { t: 'again', id: 'a' }), end); // timed again without now → invalid
});

test('endReason stuck when everyone is stuck (also before the bell)', () => {
  /** @type {State} */
  const s = { ...playing({ board: isolatedHolesBoard(), hand: ['dot', 'h2', null] }), deadline: 99 };
  const end = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  assert.equal(end.phase, 'finished');
  assert.equal(end.endReason, 'stuck');
  assert.equal(reduce(end, { t: 'timeUp', deadline: 99 }), end); // late bell is a no-op
});

// ---------- leave + colour reuse ----------

/**
 * Lobby with players a (host), b, c.
 * @returns {State}
 */
function lobby3() {
  let s = initState(42);
  for (const [id, name] of [['a', 'Ana'], ['b', 'Bob'], ['c', 'Cal']]) s = reduce(s, { t: 'join', id, name });
  return s;
}

test('join takes the lowest free colour; a lobby leave frees the slot', () => {
  let s = lobby3();
  s = reduce(s, { t: 'leave', id: 'b' });
  assert.deepEqual(s.order, ['a', 'c']);
  assert.equal(s.players.b, undefined);
  s = reduce(s, { t: 'join', id: 'd', name: 'Dan' });
  assert.equal(s.players.d.color, 2); // b's freed colour, not c's (3)
  s = reduce(s, { t: 'join', id: 'e', name: 'Eve' });
  assert.equal(s.players.e.color, 4);
  assert.deepEqual(new Set(s.order.map((id) => s.players[id].color)).size, 4);
  assert.equal(reduce(s, { t: 'join', id: 'f', name: 'Fay' }), s); // still capped at 4
});

test('leave in lobby: host passes to the next player; empty lobby stays valid', () => {
  let s = lobby3();
  s = reduce(s, { t: 'leave', id: 'a' });
  assert.equal(s.hostId, 'b');
  assert.equal(s.phase, 'lobby');
  s = reduce(s, { t: 'leave', id: 'c' }); // non-host leave keeps the host
  assert.equal(s.hostId, 'b');
  s = reduce(s, { t: 'leave', id: 'b' });
  assert.equal(s.hostId, null);
  assert.deepEqual(s.order, []);
  assert.deepEqual(s.players, {});
  assert.equal(reduce(s, { t: 'start', id: 'b' }), s);
  s = reduce(s, { t: 'join', id: 'z', name: 'Zoé' }); // next joiner becomes host, colour 1
  assert.equal(s.hostId, 'z');
  assert.equal(s.players.z.color, 1);
});

test('leave: unknown or already-removed id → same state', () => {
  const s = lobby3();
  assert.equal(reduce(s, { t: 'leave', id: 'nobody' }), s);
  const gone = reduce(s, { t: 'leave', id: 'b' });
  assert.equal(reduce(gone, { t: 'leave', id: 'b' }), gone);
});

test('leave while playing: marked done, last kept, host passes, game goes on', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  const lastA = s.players.a.last;
  const left = reduce(s, { t: 'leave', id: 'a' });
  assert.equal(left.phase, 'playing');
  assert.deepEqual(left.order, ['a', 'b', 'c']); // stays on the boards / podium
  assert.equal(left.players.a.done, true);
  assert.equal(left.players.a.last, lastA);
  assert.equal(left.players.a.score, s.players.a.score);
  assert.equal(left.hostId, 'b');
  assert.equal(left.endReason, null);
  assert.equal(reduce(left, { t: 'leave', id: 'a' }), left); // second leave → no-op
  assert.equal(reduce(left, { t: 'place', id: 'a', piece: 1, x: 3, y: 3 }), left); // frozen
});

test('leave while playing: host skips players already out, and the last leave finishes the game', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'leave', id: 'b' }); // b out first
  assert.equal(s.hostId, 'a');
  s = reduce(s, { t: 'leave', id: 'a' }); // host leaves: b is done, so c inherits
  assert.equal(s.hostId, 'c');
  assert.equal(s.phase, 'playing');
  s = reduce(s, { t: 'leave', id: 'c' }); // everyone done → finished
  assert.equal(s.phase, 'finished');
  assert.equal(s.endReason, 'stuck');
  assert.equal(s.hostId, 'a'); // all done: plain next in order
});

test('leave while playing by a stuck host still hands the host role over', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = { ...s, players: { ...s.players, a: { ...s.players.a, done: true } } };
  const left = reduce(s, { t: 'leave', id: 'a' });
  assert.notEqual(left, s);
  assert.equal(left.hostId, 'b');
  assert.equal(left.players.a, s.players.a); // already done: player object untouched
});

test('leave in finished: removed from the podium, host passes, again needs a player', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  /** @type {State} */
  const fin = { ...s, phase: 'finished' };
  s = reduce(fin, { t: 'leave', id: 'a' });
  assert.deepEqual(s.order, ['b', 'c']);
  assert.equal(s.hostId, 'b');
  assert.deepEqual(ranking(s).map((r) => r.id).sort(), ['b', 'c']);
  const again = reduce(s, { t: 'again', id: 'b' });
  assert.equal(again.phase, 'playing');
  assert.deepEqual(again.order, ['b', 'c']);
  s = reduce(reduce(s, { t: 'leave', id: 'b' }), { t: 'leave', id: 'c' });
  assert.equal(s.hostId, null);
  assert.deepEqual(s.order, []);
});
