// Round controls: endGame + retire (a disconnected player can never block a game).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ranking, reduce as reduceGame, startGame } from '../shared/game.js';
import { MINIGAMES } from '../shared/minigames.js';

/** @typedef {import('../shared/game.js').State} State */

const CTX = { gameMasterId: 'a' };
/** The reducer, with the game master the campaign passes: 'a'. */
const reduce = (/** @type {State} */ s, /** @type {import('../shared/game.js').Action} */ a) => reduceGame(s, a, CTX);
/** The round in a plain lobby: the game master takes players out there. @param {State} round @returns {any} */
const inLobby = (round) => ({ stage: round.phase === 'playing' ? 'running' : 'podium', seed: 0, settings: {}, players: [], ready: [], holders: {}, round });
/** A plain lobby action on the round, the round after it. @param {State} round @param {any} a */
const lobbyReduce = (round, a) => /** @type {State} */ (MINIGAMES.blocks.reduce(inLobby(round), a, CTX).round);
/** The game master takes `target` out. @param {State} s @param {string} target @param {string} [by] */
const retire = (s, target, by = 'a') => lobbyReduce(s, { t: 'retire', id: by, target });

/** Marathon game under way: a (game master, anna), b (sol), c (pierre); a has made one move. @returns {State} */
function game3() {
  const players = /** @type {const} */ ([{ id: 'a', character: 'anna' }, { id: 'b', character: 'sol' }, { id: 'c', character: 'pierre' }]);
  let s = /** @type {State} */ (startGame({ seed: 7, settings: {}, players: [...players], now: 1 }));
  assert.equal(s.phase, 'playing');
  const piece = s.players.a.hand.findIndex((h) => h !== null);
  s = reduce(s, { t: 'place', id: 'a', piece: /** @type {0|1|2} */ (piece), x: 0, y: 0 });
  assert.ok(s.players.a.score > 0, 'a scored');
  return s;
}

test('endGame freezes boards without marking players left', () => {
  const s = game3();
  const e = reduce(s, { t: 'endGame', id: 'a' });
  for (const id of e.order) {
    assert.deepEqual(e.players[id].board, s.players[id].board, 'board frozen');
    assert.equal(e.players[id].left, false);
  }
  assert.deepEqual(ranking(e).map((r) => r.id)[0], 'a', 'ranked as usual');
});

test('endGame: game master only, refused outside playing', () => {
  const s = game3();
  assert.equal(reduce(s, { t: 'endGame', id: 'b' }), s, 'not the game master');
  const e = reduce(s, { t: 'endGame', id: 'a' });
  assert.equal(reduce(e, { t: 'endGame', id: 'a' }), e, 'already finished');
});

test('endGame on a timed game: the late bell is ignored', () => {
  const s = /** @type {State} */ (startGame({ seed: 3, settings: { mode: 'timed' }, players: [{ id: 'a', character: 'anna' }], now: 1000 }));
  const d = /** @type {number} */ (s.deadline);
  const e = reduce(s, { t: 'endGame', id: 'a' });
  assert.equal(e.endReason, 'gm');
  assert.equal(reduce(e, { t: 'timeUp', deadline: d }), e);
});

test('a retired player keeps their board, and cannot place', () => {
  const s = game3();
  const r = retire(s, 'b');
  assert.deepEqual([r.players.b.done, r.players.b.retired, r.players.b.left], [true, true, false]);
  assert.deepEqual(r.players.b.board, s.players.b.board);
  // its character stays held (a reconnect / reclaim finds it)
  assert.equal(reduce(r, { t: 'place', id: 'b', piece: 0, x: 0, y: 0 }), r, 'a retired player cannot place');
});

test('retire: no-op (same ref) on unknown, already-done or left target, from a guest, and outside playing', () => {
  const s = game3();
  assert.equal(retire(s, 'nope'), s);
  assert.equal(retire(s, 'c', 'b'), s, 'a guest');
  const r = retire(s, 'b');
  assert.equal(retire(r, 'b'), r, 'already done');
  const left = lobbyReduce(s, { t: 'leave', id: 'c' });
  assert.equal(retire(left, 'c'), left, 'left');
  const podium = reduce(s, { t: 'endGame', id: 'a' });
  assert.equal(retire(podium, 'b'), podium, 'podium');
});

test('retire: the last one out finishes the game (stuck), the game master may retire themself', () => {
  let s = game3();
  s = retire(retire(s, 'b'), 'c');
  assert.equal(s.phase, 'playing');
  s = retire(s, 'a');
  assert.equal(s.phase, 'finished');
  assert.equal(s.endReason, 'stuck');
});
