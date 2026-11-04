// Host controls: endGame + retire (a disconnected player can never block a game).
import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, ranking, reduce } from '../shared/game.js';

/** @typedef {import('../shared/game.js').State} State */

/** Marathon game under way: a (host, anna), b (sol), c (pierre); a has made one move. @returns {State} */
function game3() {
  let s = initState(7);
  s = reduce(s, { t: 'join', id: 'a', character: 'anna' });
  s = reduce(s, { t: 'join', id: 'b', character: 'sol' });
  s = reduce(s, { t: 'join', id: 'c', character: 'pierre' });
  s = reduce(s, { t: 'start', id: 'a', now: 1 });
  assert.equal(s.phase, 'playing');
  const piece = s.players.a.hand.findIndex((h) => h !== null);
  s = reduce(s, { t: 'place', id: 'a', piece: /** @type {0|1|2} */ (piece), x: 0, y: 0 });
  assert.ok(s.players.a.score > 0, 'a scored');
  return s;
}

test('endGame: host only, playing → finished, everyone done, scores kept, endReason host', () => {
  const s = game3();
  assert.equal(reduce(s, { t: 'endGame', id: 'b' }), s, 'non-host refused (same ref)');
  const e = reduce(s, { t: 'endGame', id: 'a' });
  assert.equal(e.phase, 'finished');
  assert.equal(e.endReason, 'host');
  for (const id of e.order) {
    assert.equal(e.players[id].done, true);
    assert.equal(e.players[id].score, s.players[id].score, 'score kept');
    assert.deepEqual(e.players[id].board, s.players[id].board, 'board frozen');
    assert.equal(e.players[id].left, false);
  }
  assert.deepEqual(ranking(e).map((r) => r.id)[0], 'a', 'ranked as usual');
});

test('endGame: refused outside playing; host-ended game can go again / newGame', () => {
  const lobby = initState(1);
  assert.equal(reduce(lobby, { t: 'endGame', id: 'x' }), lobby);
  const e = reduce(game3(), { t: 'endGame', id: 'a' });
  assert.equal(reduce(e, { t: 'endGame', id: 'a' }), e, 'already finished');
  const again = reduce(e, { t: 'again', id: 'a', now: 2 });
  assert.equal(again.phase, 'playing');
  assert.equal(again.endReason, null);
  assert.ok(again.order.every((id) => !again.players[id].done && !again.players[id].retired));
  assert.equal(reduce(e, { t: 'newGame', id: 'a' }).phase, 'lobby');
});

test('endGame on a timed game: the late bell is ignored', () => {
  let s = initState(3, { mode: 'timed' });
  s = reduce(s, { t: 'join', id: 'a', character: 'anna' });
  s = reduce(s, { t: 'start', id: 'a', now: 1000 });
  const d = /** @type {number} */ (s.deadline);
  const e = reduce(s, { t: 'endGame', id: 'a' });
  assert.equal(e.endReason, 'host');
  assert.equal(reduce(e, { t: 'timeUp', deadline: d }), e);
});

test('retire: host takes a player out — done, retired, NOT left, still ranked; game goes on', () => {
  const s = game3();
  assert.equal(reduce(s, { t: 'retire', id: 'b', target: 'c' }), s, 'non-host refused (same ref)');
  const r = reduce(s, { t: 'retire', id: 'a', target: 'b' });
  assert.equal(r.phase, 'playing');
  assert.equal(r.players.b.done, true);
  assert.equal(r.players.b.retired, true);
  assert.equal(r.players.b.left, false);
  assert.deepEqual(r.players.b.board, s.players.b.board);
  assert.ok(ranking(r).some((x) => x.id === 'b'), 'still ranked');
  assert.equal(r.hostId, 'a');
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
  const lobby = reduce(reduce(initState(1), { t: 'join', id: 'a', character: 'anna' }), { t: 'join', id: 'b', character: 'sol' });
  assert.equal(reduce(lobby, { t: 'retire', id: 'a', target: 'b' }), lobby, 'lobby');
});

test('retire: the last one out finishes the game (stuck), host may retire themself', () => {
  let s = game3();
  s = reduce(s, { t: 'retire', id: 'a', target: 'b' });
  s = reduce(s, { t: 'retire', id: 'a', target: 'c' });
  assert.equal(s.phase, 'playing');
  s = reduce(s, { t: 'retire', id: 'a', target: 'a' });
  assert.equal(s.phase, 'finished');
  assert.equal(s.endReason, 'stuck');
  assert.equal(s.hostId, 'a', 'host stays host');
});

test('newGame after a retire: the retired player is back, fresh', () => {
  let s = reduce(game3(), { t: 'retire', id: 'a', target: 'b' });
  s = reduce(s, { t: 'endGame', id: 'a' });
  const l = reduce(s, { t: 'newGame', id: 'a' });
  assert.deepEqual(l.order, ['a', 'b', 'c']);
  assert.equal(l.players.b.retired, false);
  assert.equal(l.players.b.done, false);
});
