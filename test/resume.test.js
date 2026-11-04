// P2 — timed-pause fairness (server/resume.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduce } from '../server/rules.ts';
import { savedAtMs, shiftDeadline } from '../server/resume.ts';

const T0 = 1_700_000_000_000;

/** A playing timed game started at T0 (deadline = T0 + timedSeconds). */
function timedGame() {
  let s = initState(42, { mode: 'timed' });
  s = reduce(s, { t: 'join', id: 'a', character: 'anna' });
  s = reduce(s, { t: 'start', id: 'a', now: T0 });
  assert.equal(s.phase, 'playing');
  assert.equal(typeof s.deadline, 'number');
  return s;
}

test('savedAtMs: epoch ms, legacy ISO string, absent/garbage → null', () => {
  assert.equal(savedAtMs(T0), T0);
  assert.equal(savedAtMs(new Date(T0).toISOString()), T0);
  assert.equal(savedAtMs(undefined), null);
  assert.equal(savedAtMs('not a date'), null);
  assert.equal(savedAtMs(Number.NaN), null);
  assert.equal(savedAtMs({}), null);
});

test('shiftDeadline: a live deadline keeps its remaining time across the downtime', () => {
  const s = timedGame();
  const savedAt = T0 + 20_000; // 20 s into the game
  const now = savedAt + 3_600_000; // server down for an hour
  const r = shiftDeadline(s, savedAt, now);
  assert.equal(r.deadline, /** @type {number} */ (s.deadline) + 3_600_000);
  assert.equal(/** @type {number} */ (r.deadline) - now, /** @type {number} */ (s.deadline) - savedAt, 'same remaining time');
  assert.deepEqual({ ...r, deadline: s.deadline }, s, 'nothing else changes');
  assert.notEqual(r, s);
});

test('shiftDeadline: unchanged (same object) when there is nothing to shift', () => {
  const s = timedGame();
  assert.equal(shiftDeadline(s, null, T0 + 5000), s, 'old envelope without savedAt');
  assert.equal(shiftDeadline(s, T0 + 5000, T0 + 5000), s, 'no downtime');
  assert.equal(shiftDeadline(s, T0 + 9000, T0 + 5000), s, 'clock went backwards');
  const classic = reduce(reduce(initState(1), { t: 'join', id: 'a', character: 'anna' }), { t: 'start', id: 'a', now: T0 });
  assert.equal(classic.deadline, null);
  assert.equal(shiftDeadline(classic, T0, T0 + 5000), classic, 'untimed game');
  const lobby = initState(1, { mode: 'timed' });
  assert.equal(shiftDeadline(lobby, T0, T0 + 5000), lobby, 'lobby');
  const finished = reduce(s, { t: 'timeUp', deadline: /** @type {number} */ (s.deadline) });
  assert.equal(finished.phase, 'finished');
  assert.equal(shiftDeadline(finished, T0, T0 + 5000), finished, 'finished');
});
