// P1 — test suite for shared/ (see BUILD-PLAN.md §P1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, canPlace, place, findClears, applyClears, anyFit, legalPlacementCount } from '../shared/board.js';
import { PIECES, PIECE_SETS, handAt } from '../shared/pieces.js';
import {
  DEFAULT_SETTINGS, startGame, newPlayer, normalizeSettings, placementScore, ranking, reduce as reduceGame,
} from '../shared/game.js';

/** @typedef {import('../shared/game.js').State} State */
/** @typedef {import('../shared/game.js').Player} Player */

/** The reducer, with the host the campaign passes: 'a' by default. */
const reduce = (/** @type {State} */ s, /** @type {import('../shared/game.js').Action} */ a, hostId = 'a') => reduceGame(s, a, { hostId });

/**
 * A round under way with the given characters (ids a, b, c… in that order), seed 42.
 * @param {import('../shared/characters.js').CharacterId[]} characters @param {Partial<import('../shared/game.js').Settings>} [settings]
 * @returns {State}
 */
function started(characters, settings = {}, now = 0) {
  const players = characters.map((character, i) => ({ id: 'abcde'[i], character }));
  return /** @type {State} */ (startGame({ seed: 42, settings, players, now }));
}

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
  return { ...started(['pierre']), seed, order: ['a'], players: { a: p } };
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

test('piece set: sane shapes', () => {
  const ids = Object.keys(PIECES);
  for (const id of ids) {
    const p = PIECES[id];
    assert.equal(p.id, id);
    assert.ok(p.cells.length >= 1 && p.cells.length <= 9);
    assert.ok(p.w > 0 && Number.isFinite(p.w));
    // origin convention: bounding box starts at (0,0)
    assert.equal(Math.min(...p.cells.map((c) => c[0])), 0);
    assert.equal(Math.min(...p.cells.map((c) => c[1])), 0);
  }
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

// ---------- startGame ----------

test('startGame: names and colours from the characters, the same hand 0 to everyone, the settings as rules', () => {
  const s = started(['sol', 'elodie'], { size: 9 });
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.order, ['a', 'b']);
  assert.deepEqual([s.players.a.character, s.players.a.name, s.players.a.color], ['sol', 'Sol', 3]); // colour follows the character
  assert.deepEqual([s.players.b.name, s.players.b.color], ['Élodie', 2]);
  assert.deepEqual(s.players.a.hand, handAt(42, 0));
  assert.deepEqual(s.players.b.hand, handAt(42, 0)); // fairness: identical hands
  assert.equal(s.players.a.handIndex, 0);
  assert.deepEqual([s.rules.size, s.size, s.players.a.board.length], [9, 9, 81]);
  assert.equal(startGame({ seed: 42, settings: {}, players: [], now: 0 }), null, 'nobody to play');
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
  /** @type {State} */
  const podium = { ...started(['pierre']), phase: 'finished' };
  assert.equal(reduce(podium, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 }), podium); // not playing

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
  const s = { ...started(['pierre']), order: ['a', 'b'], players: { a, b } };
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

// ---------- ranking (P5 contract addition) ----------

test('ranking: ties share a rank, standard competition (1,1,3), join order within ties', () => {
  const s = started(['pierre']);
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
 * A round under way with 'a' (host) and 'b'.
 * @param {Partial<import('../shared/game.js').Settings>} [settings]
 * @returns {State}
 */
const game2 = (settings, now = 0) => started(['pierre', 'elodie'], settings, now);

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

test('size 9 and 10: boards sized at start, full rows of that width clear', () => {
  for (const size of /** @type {const} */ ([9, 10])) {
    let s = game2({ size });
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
  // pinned sequences: any weight change moves them, so it must be a deliberate update here
  // (last: balance R1, sq3 0.5 + big corners 1.5, 2026-11-04 — see docs/balance.md)
  assert.deepEqual(handAt(42, 0), ['c_nw', 't_left', 's_h']);
  assert.deepEqual(handAt(42, 3), ['r3x2', 'v3', 'v2']);
  assert.equal(PIECE_SETS.simple.weights.sq3, PIECES.sq3.w); // simple derives from the PIECES weights
  assert.equal(PIECE_SETS.simple.weights.bc_nw, PIECES.bc_nw.w);
  assert.deepEqual(handAt(42, 0, 'full'), handAt(42, 0));
  assert.throws(() => handAt(42, 0, /** @type {any} */ ('nope')));
  // reduce deals from rules.pieceSet, including refills
  let s = game2({ pieceSet: 'simple' });
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
  const g = game2({ grace: 0 });
  assert.equal(g.players.a.graceLeft, 0);
});

test('timed: the start sets the deadline from now; now required', () => {
  const timed = { mode: /** @type {const} */ ('timed'), timedSeconds: 120 };
  assert.equal(startGame({ seed: 42, settings: timed, players: [{ id: 'a', character: 'pierre' }], now: /** @type {any} */ (undefined) }), null);
  assert.equal(startGame({ seed: 42, settings: timed, players: [{ id: 'a', character: 'pierre' }], now: NaN }), null);
  const t = game2(timed, 1_000_000);
  assert.equal(t.phase, 'playing');
  assert.equal(t.deadline, 1_000_000 + 120_000);
  assert.equal(t.endReason, null);
  // marathon ignores now and has no deadline
  const m = game2({}, 5);
  assert.equal(m.deadline, null);
  assert.equal(reduce(m, { t: 'timeUp', deadline: 5 }), m);
});

test('timed: timeUp ends the game, matching deadline only; place after is rejected', () => {
  let s = game2({ mode: 'timed', timedSeconds: 60 }, 0);
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
});

test('endReason stuck when everyone is stuck (also before the bell)', () => {
  /** @type {State} */
  const s = { ...playing({ board: isolatedHolesBoard(), hand: ['dot', 'h2', null] }), deadline: 99 };
  const end = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  assert.equal(end.phase, 'finished');
  assert.equal(end.endReason, 'stuck');
  assert.equal(reduce(end, { t: 'timeUp', deadline: 99 }), end); // late bell is a no-op
});

// ---------- leave ----------

/** A round under way with a (host), b, c. @returns {State} */
const game3 = () => started(['pierre', 'elodie', 'sol']);

test('leave: unknown or already-removed id → same state', () => {
  /** @type {State} */
  const s = { ...game3(), phase: 'finished' };
  assert.equal(reduce(s, { t: 'leave', id: 'nobody' }), s);
  const gone = reduce(s, { t: 'leave', id: 'b' });
  assert.equal(reduce(gone, { t: 'leave', id: 'b' }), gone);
});

test('leave while playing: marked done, last kept, game goes on', () => {
  let s = game3();
  s = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  const lastA = s.players.a.last;
  const left = reduce(s, { t: 'leave', id: 'a' });
  assert.equal(left.phase, 'playing');
  assert.deepEqual(left.order, ['a', 'b', 'c']); // stays on the boards / podium
  assert.equal(left.players.a.done, true);
  assert.equal(left.players.a.last, lastA);
  assert.equal(left.players.a.score, s.players.a.score);
  assert.equal(left.endReason, null);
  assert.equal(reduce(left, { t: 'leave', id: 'a' }), left); // second leave → no-op
  assert.equal(reduce(left, { t: 'place', id: 'a', piece: 1, x: 3, y: 3 }), left); // frozen
});

test('leave while playing: the last leave finishes the game', () => {
  let s = game3();
  s = reduce(s, { t: 'leave', id: 'b' });
  s = reduce(s, { t: 'leave', id: 'a' });
  assert.equal(s.phase, 'playing');
  s = reduce(s, { t: 'leave', id: 'c' }); // everyone done → finished
  assert.equal(s.phase, 'finished');
  assert.equal(s.endReason, 'stuck');
});

test('leave while playing by a stuck player still marks them left', () => {
  let s = game3();
  s = { ...s, players: { ...s.players, a: { ...s.players.a, done: true } } };
  const left = reduce(s, { t: 'leave', id: 'a' });
  assert.notEqual(left, s);
  assert.equal(left.players.a.left, true); // stuck, then left: now marked as departed
  assert.equal(left.players.a.board, s.players.a.board);
});

test('leave in finished: removed from the podium', () => {
  /** @type {State} */
  const fin = { ...game3(), phase: 'finished' };
  const s = reduce(fin, { t: 'leave', id: 'a' });
  assert.deepEqual(s.order, ['b', 'c']);
  assert.deepEqual(ranking(s).map((r) => r.id).sort(), ['b', 'c']);
});
