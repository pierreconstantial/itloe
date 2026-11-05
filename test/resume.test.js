// P2 — timed-pause fairness (server/resume.ts): any round keeps its remaining time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, reduce } from '../server/rules.ts';
import { savedAtMs, shiftRound } from '../server/resume.ts';
import { initQuiz, reduceQuiz } from '../shared/quiz/index.js';

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

/** A campaign whose round is `s` (only `at` matters here). @param {any} s @param {string | null} [kind] */
const at = (s, kind = 'blocks') => /** @type {any} */ ({ at: { node: 'x', kind, activity: s } });

test('shiftRound: a quiz reveal is not on a clock', () => {
  let q = initQuiz(1);
  q = reduceQuiz(q, { t: 'join', id: 'a', character: 'anna' });
  q = reduceQuiz(q, { t: 'start', id: 'a', now: T0, candidates: [{ id: 'q1', choices: 4 }] });
  const d = /** @type {any} */ (q.round).deadline;
  const reveal = reduceQuiz(q, { t: 'close', deadline: d });
  const c = at(reveal, 'quiz');
  assert.equal(shiftRound(c, T0, T0 + 5000), c, 'a reveal is not on a clock');
});

test('shiftRound: unchanged (same object) when there is nothing to shift', () => {
  const s = timedGame();
  const c = at(s);
  assert.equal(shiftRound(c, null, T0 + 5000), c, 'old envelope without savedAt');
  assert.equal(shiftRound(c, T0 + 5000, T0 + 5000), c, 'no downtime');
  assert.equal(shiftRound(c, T0 + 9000, T0 + 5000), c, 'clock went backwards');
  const classic = reduce(reduce(initState(1), { t: 'join', id: 'a', character: 'anna' }), { t: 'start', id: 'a', now: T0 });
  assert.equal(classic.deadline, null);
  const untimed = at(classic);
  assert.equal(shiftRound(untimed, T0, T0 + 5000), untimed, 'untimed game');
  const lobby = at(initState(1, { mode: 'timed' }));
  assert.equal(shiftRound(lobby, T0, T0 + 5000), lobby, 'lobby');
  const finished = reduce(s, { t: 'timeUp', deadline: /** @type {number} */ (s.deadline) });
  assert.equal(finished.phase, 'finished');
  const done = at(finished);
  assert.equal(shiftRound(done, T0, T0 + 5000), done, 'finished');
  const none = at(null, null);
  assert.equal(shiftRound(none, T0, T0 + 5000), none, 'no round');
});
