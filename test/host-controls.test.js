// Host controls: endGame + retire (a disconnected player can never block a game).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_RULES, ranking, reduce as reduceGame, startGame } from '../shared/game.js';

/** @typedef {import('../shared/game.js').State} State */

/** The reducer, with the host the campaign passes: 'a'. */
const reduce = (/** @type {State} */ s, /** @type {import('../shared/game.js').Action} */ a) => reduceGame(s, a, { hostId: 'a' });

/** Marathon game under way: a (host, anna), b (sol), c (pierre); a has made one move. @returns {State} */
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

test('endGame: host only, refused outside playing; everyone ended plays again', () => {
  const s = game3();
  assert.equal(reduce(s, { t: 'endGame', id: 'b' }), s, 'not the host');
  const e = reduce(s, { t: 'endGame', id: 'a' });
  assert.equal(reduce(e, { t: 'endGame', id: 'a' }), e, 'already finished');
  assert.deepEqual(BLOCK_RULES.seated(e), ['a', 'b', 'c']);
});

test('endGame on a timed game: the late bell is ignored', () => {
  const s = /** @type {State} */ (startGame({ seed: 3, settings: { mode: 'timed' }, players: [{ id: 'a', character: 'anna' }], now: 1000 }));
  const d = /** @type {number} */ (s.deadline);
  const e = reduce(s, { t: 'endGame', id: 'a' });
  assert.equal(e.endReason, 'host');
  assert.equal(reduce(e, { t: 'timeUp', deadline: d }), e);
});

test('a retired player keeps their board, and cannot place', () => {
  const s = game3();
  const r = reduce(s, { t: 'retire', id: 'a', target: 'b' });
  assert.deepEqual(r.players.b.board, s.players.b.board);
  // its character stays held (a reconnect / reclaim finds it)
  assert.equal(reduce(r, { t: 'place', id: 'b', piece: 0, x: 0, y: 0 }), r, 'a retired player cannot place');
});

test('retire: no-op (same ref) on unknown, already-done or left target, and outside playing', () => {
  const s = game3();
  assert.equal(reduce(s, { t: 'retire', id: 'a', target: 'nope' }), s);
  const r = reduce(s, { t: 'retire', id: 'a', target: 'b' });
  assert.equal(reduce(r, { t: 'retire', id: 'a', target: 'b' }), r, 'already done');
  const left = reduce(s, { t: 'leave', id: 'c' });
  assert.equal(reduce(left, { t: 'retire', id: 'a', target: 'c' }), left, 'left');
  const podium = reduce(s, { t: 'endGame', id: 'a' });
  assert.equal(reduce(podium, { t: 'retire', id: 'a', target: 'b' }), podium, 'podium');
});

test('retire: the last one out finishes the game (stuck), host may retire themself', () => {
  let s = game3();
  s = reduce(s, { t: 'retire', id: 'a', target: 'b' });
  s = reduce(s, { t: 'retire', id: 'a', target: 'c' });
  assert.equal(s.phase, 'playing');
  s = reduce(s, { t: 'retire', id: 'a', target: 'a' });
  assert.equal(s.phase, 'finished');
  assert.equal(s.endReason, 'stuck');
});

test('a retired player plays the next round', () => {
  let s = reduce(game3(), { t: 'retire', id: 'a', target: 'b' });
  s = reduce(s, { t: 'endGame', id: 'a' });
  assert.deepEqual(BLOCK_RULES.seated(s), ['a', 'b', 'c']);
});
