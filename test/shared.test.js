// P1 — test suite for shared/ (see BUILD-PLAN.md §P1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, canPlace, place, findClears, applyClears, anyFit, legalPlacementCount } from '../shared/board.js';
import { PIECES, PIECE_SETS, handAt } from '../shared/pieces.js';
import { CHARACTERS, ROSTER_SIZE, freeCharacters } from '../shared/characters.js';
import { WORLD, WALK_SPEED, spawnPoint, clampToWorld } from '../shared/world.js';
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
    assert.ok(p.w > 0 && Number.isFinite(p.w));
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

test('join by character: first is host, name + colour from the character, guards', () => {
  let s = initState(42);
  s = reduce(s, { t: 'join', id: 'a', character: 'sol' }); // colour follows the character, not join order
  assert.equal(s.hostId, 'a');
  assert.deepEqual([s.players.a.character, s.players.a.name, s.players.a.color], ['sol', 'Sol', 3]);
  s = reduce(s, { t: 'join', id: 'b', character: 'elodie' });
  assert.equal(s.hostId, 'a');
  assert.deepEqual([s.players.b.name, s.players.b.color], ['Élodie', 2]);
  assert.deepEqual(s.order, ['a', 'b']);

  assert.equal(reduce(s, { t: 'join', id: 'a', character: 'anna' }), s); // duplicate id
  assert.equal(reduce(s, { t: 'join', id: 'x', character: 'sol' }), s); // taken
  assert.equal(reduce(s, { t: 'join', id: 'x', character: /** @type {any} */ ('zelda') }), s); // unknown
  assert.equal(reduce(s, /** @type {any} */ ({ t: 'join', id: 'x', name: 'Ana' })), s); // pre-M3 shape
  assert.equal(reduce(s, { t: 'join', id: '', character: 'anna' }), s); // empty id

  s = reduce(s, { t: 'join', id: 'c', character: 'pierre' });
  s = reduce(s, { t: 'join', id: 'd', character: 'anna' });
  assert.deepEqual(freeCharacters(s), []);
  for (const c of Object.keys(CHARACTERS)) {
    assert.equal(reduce(s, { t: 'join', id: 'e', character: /** @type {any} */ (c) }), s); // roster exhausted
  }
});

test('characters: roster data and freeCharacters', () => {
  const ids = Object.keys(CHARACTERS);
  assert.deepEqual(ids, ['pierre', 'elodie', 'sol', 'anna']); // display order
  assert.equal(ROSTER_SIZE, ids.length);
  assert.deepEqual(Object.values(CHARACTERS).map((c) => c.color), [1, 2, 3, 4]);
  assert.equal(CHARACTERS.elodie.name, 'Élodie');
  for (const [id, c] of Object.entries(CHARACTERS)) assert.equal(c.id, id);
  assert.deepEqual(freeCharacters(initState(1)), ids);
  let s = reduce(initState(1), { t: 'join', id: 'a', character: 'sol' });
  assert.deepEqual(freeCharacters(s), ids.filter((c) => c !== 'sol')); // order kept
  s = reduce(s, { t: 'leave', id: 'a' });
  assert.deepEqual(freeCharacters(s), ids);
});

test('old saves without character stay loadable and hold their colour slot', () => {
  // pre-M3 player: no `character` key at all (as read from a JSON save)
  const { character: _drop, ...legacy } = newPlayer('old', 'Ana', 2, SIZE);
  /** @type {State} */
  const s = { ...initState(42), hostId: 'old', order: ['old'], players: { old: /** @type {Player} */ (legacy) } };
  assert.deepEqual(freeCharacters(s), ['pierre', 'sol', 'anna']); // colour 2 = Élodie's slot
  assert.equal(reduce(s, { t: 'join', id: 'n', character: 'elodie' }), s); // no colour clash
  const s2 = reduce(s, { t: 'join', id: 'n', character: 'anna' });
  assert.equal(s2.players.n.color, 4);
  const started = reduce(s2, { t: 'start', id: 'old' });
  assert.equal(started.phase, 'playing');
  assert.equal(started.players.old.character, null); // normalized, name/colour kept
  assert.deepEqual([started.players.old.name, started.players.old.color], ['Ana', 2]);
});

test('start: host only, deals the same hand 0 to everyone', () => {
  let s = initState(42);
  s = reduce(s, { t: 'join', id: 'a', character: 'pierre' });
  s = reduce(s, { t: 'join', id: 'b', character: 'elodie' });
  assert.equal(reduce(s, { t: 'start', id: 'b' }), s); // not host
  const started = reduce(s, { t: 'start', id: 'a' });
  assert.equal(started.phase, 'playing');
  assert.deepEqual(started.players.a.hand, handAt(42, 0));
  assert.deepEqual(started.players.b.hand, handAt(42, 0)); // fairness: identical hands
  assert.equal(started.players.a.handIndex, 0);
  assert.equal(reduce(started, { t: 'start', id: 'a' }), started); // already playing
  assert.equal(reduce(started, { t: 'join', id: 'e', character: 'sol' }), started); // no join mid-game
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
  s = reduce(s, { t: 'join', id: 'a', character: 'pierre' });
  s = reduce(s, { t: 'join', id: 'b', character: 'elodie' });
  s = reduce(s, { t: 'start', id: 'a' });
  assert.equal(reduce(s, { t: 'again', id: 'a' }), s); // not finished yet
  /** @type {State} */
  const finished = { ...s, phase: 'finished' };
  assert.equal(reduce(finished, { t: 'again', id: 'b' }), finished); // not host

  const again = reduce(finished, { t: 'again', id: 'a' });
  assert.equal(again.phase, 'playing');
  assert.notEqual(again.seed, 42); // new seed
  assert.deepEqual(again.order, ['a', 'b']);
  assert.equal(again.players.a.name, 'Pierre');
  assert.equal(again.players.b.color, 2);
  assert.equal(again.players.a.score, 0);
  assert.ok(again.players.a.board.every((c) => c === 0));
  assert.deepEqual(again.players.a.hand, handAt(again.seed, 0));
  assert.deepEqual(again.players.b.hand, handAt(again.seed, 0));
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
  s = reduce(s, { t: 'join', id: 'a', character: 'pierre' });
  return reduce(s, { t: 'join', id: 'b', character: 'elodie' });
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
  const joined = reduce(s, { t: 'join', id: 'c', character: 'sol' });
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
  // pinned sequences: any weight change moves them, so it must be a deliberate update here
  // (last: balance R1, sq3 0.5 + big corners 1.5, 2026-11-04 — see docs/balance.md)
  assert.deepEqual(handAt(42, 0), ['c_nw', 't_left', 's_h']);
  assert.deepEqual(handAt(42, 3), ['r3x2', 'v3', 'v2']);
  assert.equal(PIECE_SETS.simple.weights.sq3, PIECES.sq3.w); // simple derives from the PIECES weights
  assert.equal(PIECE_SETS.simple.weights.bc_nw, PIECES.bc_nw.w);
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
  s = reduce(s, { t: 'join', id: 'a', character: 'pierre' });
  s = reduce(s, { t: 'join', id: 'b', character: 'elodie' });
  return reduce(s, { t: 'join', id: 'c', character: 'sol' });
}

test('a lobby leave frees the character for the next joiner', () => {
  let s = lobby3();
  assert.equal(reduce(s, { t: 'join', id: 'd', character: 'elodie' }), s); // taken by b
  s = reduce(s, { t: 'leave', id: 'b' });
  assert.deepEqual(s.order, ['a', 'c']);
  assert.equal(s.players.b, undefined);
  assert.deepEqual(freeCharacters(s), ['elodie', 'anna']);
  s = reduce(s, { t: 'join', id: 'd', character: 'elodie' });
  assert.deepEqual([s.players.d.character, s.players.d.color], ['elodie', 2]); // b's freed slot
  s = reduce(s, { t: 'join', id: 'e', character: 'anna' });
  assert.deepEqual(new Set(s.order.map((id) => s.players[id].color)).size, 4);
  assert.equal(reduce(s, { t: 'join', id: 'f', character: 'pierre' }), s); // roster exhausted
});

test('mid-game: a left player does not block its character; rematch keeps characters', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  assert.deepEqual(freeCharacters(s), ['anna']);
  s = reduce(s, { t: 'leave', id: 'b' });
  assert.deepEqual(freeCharacters(s), ['elodie', 'anna']); // b left: Élodie shows as free
  assert.equal(reduce(s, { t: 'join', id: 'd', character: 'elodie' }), s); // but join is lobby-only
  /** @type {State} */
  const fin = { ...s, phase: 'finished', players: { ...s.players, a: { ...s.players.a, done: true }, c: { ...s.players.c, done: true } } };
  const again = reduce(fin, { t: 'again', id: 'a' });
  assert.deepEqual(again.order, ['a', 'c']);
  assert.deepEqual(again.order.map((id) => again.players[id].character), ['pierre', 'sol']);
  assert.deepEqual(again.order.map((id) => [again.players[id].name, again.players[id].color]), [['Pierre', 1], ['Sol', 3]]);
  // config in the lobby rebuilds players and must keep their characters too
  const cfg = reduce(lobby3(), { t: 'config', id: 'a', patch: { size: 9 } });
  assert.deepEqual(cfg.order.map((id) => cfg.players[id].character), ['pierre', 'elodie', 'sol']);
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
  s = reduce(s, { t: 'join', id: 'z', character: 'pierre' }); // next joiner becomes host
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
  s = reduce(s, { t: 'leave', id: 'a' }); // host leaves: b has left, so c inherits
  assert.equal(s.hostId, 'c');
  assert.equal(s.phase, 'playing');
  s = reduce(s, { t: 'leave', id: 'c' }); // everyone done → finished
  assert.equal(s.phase, 'finished');
  assert.equal(s.endReason, 'stuck');
  assert.equal(s.hostId, null); // everyone left: no host, and «Replay» is impossible
  assert.equal(reduce(s, { t: 'again', id: 'a' }), s);
});

test('leave while playing by a stuck host still hands the host role over', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = { ...s, players: { ...s.players, a: { ...s.players.a, done: true } } };
  const left = reduce(s, { t: 'leave', id: 'a' });
  assert.notEqual(left, s);
  assert.equal(left.hostId, 'b');
  assert.equal(left.players.a.left, true); // stuck, then left: now marked as departed
  assert.equal(left.players.a.board, s.players.a.board);
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

// ---------- left flag: departed players are not part of the rematch ----------

test('newPlayer and joins start with left=false; lobby leave removes (no left flag needed)', () => {
  const s = lobby3();
  for (const id of s.order) assert.equal(s.players[id].left, false);
  const started = reduce(s, { t: 'start', id: 'a' });
  for (const id of started.order) assert.equal(started.players[id].left, false);
});

test('mid-game leave marks left + done, keeps board/score/last; double leave is same-ref', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'place', id: 'b', piece: 0, x: 0, y: 0 });
  const before = s.players.b;
  const left = reduce(s, { t: 'leave', id: 'b' });
  const b = left.players.b;
  assert.deepEqual([b.left, b.done], [true, true]);
  assert.equal(b.board, before.board);
  assert.equal(b.score, before.score);
  assert.equal(b.last, before.last);
  assert.equal(reduce(left, { t: 'leave', id: 'b' }), left);
});

test('again after a mid-game leave: rematch has only the remaining players, colours kept, finishable', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'leave', id: 'b' }); // P4 repro: b leaves mid-game…
  /** @type {State} */
  const fin = { ...s, phase: 'finished', players: { ...s.players, a: { ...s.players.a, done: true }, c: { ...s.players.c, done: true } } };
  assert.deepEqual(fin.order, ['a', 'b', 'c']); // …still on the podium…
  const again = reduce(fin, { t: 'again', id: 'a' });
  assert.deepEqual(again.order, ['a', 'c']); // …but not in the rematch
  assert.equal(again.players.b, undefined); // their id no longer re-attaches (server only welcomes known ids)
  assert.equal(again.players.a.color, 1);
  assert.equal(again.players.c.color, 3); // colours kept, not reassigned
  for (const id of again.order) assert.deepEqual([again.players[id].left, again.players[id].done], [false, false]);
  assert.equal(reduce(again, { t: 'place', id: 'b', piece: 0, x: 0, y: 0 }), again);
  assert.equal(reduce(again, { t: 'leave', id: 'b' }), again);

  // the rematch can finish: get a and c stuck → finished (with b it never could, b had no phone)
  /** @type {State} */
  const nearEnd = {
    ...again,
    players: Object.fromEntries(again.order.map((id) => [id,
      { ...again.players[id], board: isolatedHolesBoard(), hand: /** @type {(string|null)[]} */ (['dot', 'h2', null]) }])),
  };
  let e = reduce(nearEnd, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  assert.equal(e.phase, 'playing');
  e = reduce(e, { t: 'place', id: 'c', piece: 0, x: 1, y: 1 });
  assert.equal(e.phase, 'finished');
  assert.equal(e.endReason, 'stuck');
});

test('again with every remaining player gone is invalid; a lone survivor can replay solo', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(reduce(s, { t: 'leave', id: 'b' }), { t: 'leave', id: 'c' });
  /** @type {State} */
  const fin = { ...s, phase: 'finished', players: { ...s.players, a: { ...s.players.a, done: true } } };
  const solo = reduce(fin, { t: 'again', id: 'a' });
  assert.deepEqual(solo.order, ['a']);
  assert.equal(solo.phase, 'playing');
  // a lone left-flagged roster with a stale host (defensive): beginPlay refuses
  /** @type {State} */
  const ghost = { ...fin, players: { ...fin.players, a: { ...fin.players.a, left: true } } };
  assert.equal(reduce(ghost, { t: 'again', id: 'a' }), ghost);
});

test('host handoff skips a left player onto a merely-stuck one', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'leave', id: 'b' }); // b gone
  s = { ...s, players: { ...s.players, c: { ...s.players.c, done: true } } }; // c stuck, still connected
  const left = reduce(s, { t: 'leave', id: 'a' });
  assert.equal(left.hostId, 'c'); // not b
  assert.equal(left.phase, 'finished'); // a was the last one playing
  const again = reduce(left, { t: 'again', id: 'c' }); // the stuck player can start the rematch
  assert.deepEqual(again.order, ['c']);
});

test('leave on the podium by a host skips players who left mid-game', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'leave', id: 'b' });
  /** @type {State} */
  const fin = { ...s, phase: 'finished' };
  const after = reduce(fin, { t: 'leave', id: 'a' });
  assert.deepEqual(after.order, ['b', 'c']); // a removed; b stays shown until the rematch
  assert.equal(after.hostId, 'c');
  assert.deepEqual(reduce(after, { t: 'again', id: 'c' }).order, ['c']);
});

// ---------- newGame: podium → lobby ----------

/**
 * lobby3 started, a and b placed once, then forced to the podium.
 * @returns {State}
 */
function podium3() {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'place', id: 'a', piece: 0, x: 0, y: 0 });
  s = reduce(s, { t: 'place', id: 'b', piece: 0, x: 0, y: 0 });
  /** @type {State} */
  const fin = { ...s, phase: 'finished', endReason: 'stuck' };
  return fin;
}

test('newGame: host on the podium → fresh lobby, same players, new seed, settings live', () => {
  const fin = podium3();
  const s = reduce(fin, { t: 'newGame', id: 'a' });
  assert.equal(s.phase, 'lobby');
  assert.deepEqual(s.order, ['a', 'b', 'c']);
  assert.equal(s.hostId, 'a');
  assert.notEqual(s.seed, fin.seed);
  assert.equal(s.seed, reduce(fin, { t: 'again', id: 'a' }).seed); // same derivation as «Replay»
  assert.deepEqual([s.deadline, s.endReason], [null, null]);
  assert.deepEqual(s.rules, s.settings);
  assert.equal(s.size, s.rules.size);
  for (const id of s.order) {
    const p = s.players[id];
    assert.deepEqual(p, newPlayer(id, fin.players[id].name, fin.players[id].color, SIZE, s.rules.grace, fin.players[id].character));
    assert.deepEqual(p.hand, [null, null, null]); // lobby players hold no hand, like after a join
  }
  // config is live again in that lobby and rebuilds boards
  const cfg = reduce(s, { t: 'config', id: 'a', patch: { size: 10 } });
  assert.deepEqual([cfg.rules.size, cfg.players.c.board.length], [10, 100]);
});

test('newGame: settings changed on the podium become the lobby rules', () => {
  const fin = reduce(podium3(), { t: 'config', id: 'a', patch: { size: 9, grace: 2 } });
  assert.equal(fin.rules.size, 8); // podium keeps showing the old game
  const s = reduce(fin, { t: 'newGame', id: 'a' });
  assert.deepEqual([s.rules.size, s.size, s.rules.grace], [9, 9, 2]);
  assert.equal(s.players.a.board.length, 81);
  assert.equal(s.players.a.graceLeft, 2);
});

test('newGame: non-host and wrong phase refused (same ref)', () => {
  const fin = podium3();
  assert.equal(reduce(fin, { t: 'newGame', id: 'b' }), fin);
  assert.equal(reduce(fin, { t: 'newGame', id: 'nobody' }), fin);
  const lobby = lobby3();
  assert.equal(reduce(lobby, { t: 'newGame', id: 'a' }), lobby);
  const play = reduce(lobby, { t: 'start', id: 'a' });
  assert.equal(reduce(play, { t: 'newGame', id: 'a' }), play);
});

test('newGame: players who left mid-game are dropped, characters and colours kept', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'leave', id: 'b' });
  /** @type {State} */
  const fin = { ...s, phase: 'finished' };
  const lobby = reduce(fin, { t: 'newGame', id: 'a' });
  assert.deepEqual(lobby.order, ['a', 'c']);
  assert.equal(lobby.players.b, undefined);
  assert.deepEqual(lobby.order.map((id) => [lobby.players[id].character, lobby.players[id].name, lobby.players[id].color]),
    [['pierre', 'Pierre', 1], ['sol', 'Sol', 3]]);
  for (const id of lobby.order) assert.deepEqual([lobby.players[id].left, lobby.players[id].done], [false, false]);
  assert.deepEqual(freeCharacters(lobby), ['elodie', 'anna']);
});

test('newGame: a newcomer can join the new lobby, then start works', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  s = reduce(s, { t: 'leave', id: 'b' });
  /** @type {State} */
  const fin = { ...s, phase: 'finished' };
  assert.equal(reduce(fin, { t: 'join', id: 'd', character: 'anna' }), fin); // podium: no joins
  let lobby = reduce(fin, { t: 'newGame', id: 'a' });
  assert.equal(reduce(lobby, { t: 'join', id: 'd', character: 'sol' }), lobby); // still held by c
  lobby = reduce(lobby, { t: 'join', id: 'd', character: 'elodie' }); // b's freed character
  lobby = reduce(lobby, { t: 'join', id: 'e', character: 'anna' });
  assert.deepEqual(lobby.order, ['a', 'c', 'd', 'e']);
  assert.equal(lobby.players.d.color, 2);
  const play = reduce(lobby, { t: 'start', id: 'a' });
  assert.equal(play.phase, 'playing');
  assert.equal(play.seed, lobby.seed); // start deals from the seed newGame derived
  assert.deepEqual(play.order, ['a', 'c', 'd', 'e']);
  for (const id of play.order) assert.deepEqual(play.players[id].hand, handAt(lobby.seed, 0));
});

test('newGame: no remaining player → refused when hostless, empty lobby if the host is a ghost', () => {
  let s = reduce(lobby3(), { t: 'start', id: 'a' });
  for (const id of ['a', 'b', 'c']) s = reduce(s, { t: 'leave', id });
  assert.equal(s.phase, 'finished');
  assert.equal(s.hostId, null);
  assert.equal(reduce(s, { t: 'newGame', id: 'a' }), s); // unreachable in practice: nobody is host
  // defensive: a stale host id pointing at a left player
  /** @type {State} */
  const ghost = { ...s, hostId: 'a' };
  const empty = reduce(ghost, { t: 'newGame', id: 'a' });
  assert.equal(empty.phase, 'lobby');
  assert.deepEqual([empty.order, empty.players, empty.hostId], [[], {}, null]);
  const joined = reduce(empty, { t: 'join', id: 'z', character: 'anna' });
  assert.equal(joined.hostId, 'z'); // the next joiner hosts
});

// ---------- world geometry ----------

test('world: spawnPoint is deterministic, distinct per character, inside the world', () => {
  assert.deepEqual(WORLD, { w: 16, h: 9 });
  assert.equal(WALK_SPEED, 4);
  /** @type {number[]} */
  const xs = [];
  for (const c of /** @type {import('../shared/characters.js').CharacterId[]} */ (Object.keys(CHARACTERS))) {
    const p = spawnPoint(c);
    assert.deepEqual(p, spawnPoint(c)); // deterministic
    assert.equal(p.x, 3 + 3.33 * (CHARACTERS[c].color - 1));
    assert.deepEqual([p.y, p.dir], [7.6, 'down']);
    assert.ok(p.x >= 0 && p.x <= WORLD.w && p.y >= 0 && p.y <= WORLD.h);
    xs.push(p.x);
  }
  assert.equal(new Set(xs).size, xs.length);
  assert.deepEqual(spawnPoint('pierre'), { x: 3, y: 7.6, dir: 'down' });
  assert.deepEqual(spawnPoint(null), { x: 8, y: 7.6, dir: 'down' }); // pre-M3 player: centre fallback
  assert.deepEqual(clampToWorld(-1, 20), { x: 0, y: 9 });
  assert.deepEqual(clampToWorld(7.5, 4.25), { x: 7.5, y: 4.25 });
  assert.deepEqual(clampToWorld(NaN, Infinity), { x: 0, y: 0 });
});
