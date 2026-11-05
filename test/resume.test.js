// P2 — timed-pause fairness (server/resume.ts): any round keeps its remaining time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGame, reduce as reduceGame } from '../server/rules.ts';
import { savedAtMs, shiftRound } from '../server/resume.ts';
import { startQuiz, reduceQuiz as reduceRound } from '../shared/quiz/index.js';

/** The block reducer, with the host the campaign passes: 'a'. */
const reduce = (/** @type {import('../shared/game.js').State} */ s, /** @type {import('../shared/game.js').Action} */ a) => reduceGame(s, a, { hostId: 'a' });

/** The quiz reducer, with the host the campaign passes: 'a'. */
const reduceQuiz = (/** @type {import('../shared/quiz/index.js').QuizState} */ s, /** @type {import('../shared/quiz/index.js').QuizAction} */ a) => reduceRound(s, a, { hostId: 'a' });

const T0 = 1_700_000_000_000;

/** A block game started at T0 by Anna. @param {Partial<import('../shared/game.js').Settings>} settings */
const gameOf = (settings) => /** @type {import('../shared/game.js').State} */ (startGame({ seed: 42, settings, players: [{ id: 'a', character: 'anna' }], now: T0 }));

/** A playing timed game started at T0 (deadline = T0 + timedSeconds). */
function timedGame() {
  const s = gameOf({ mode: 'timed' });
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
  const q = /** @type {import('../shared/quiz/index.js').QuizState} */ (startQuiz({ seed: 1, settings: {}, now: T0,
    players: [{ id: 'a', character: 'anna' }], inputs: [{ id: 'q1', choices: 4 }] }));
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
  const classic = gameOf({});
  assert.equal(classic.deadline, null);
  const untimed = at(classic);
  assert.equal(shiftRound(untimed, T0, T0 + 5000), untimed, 'untimed game');
  const finished = reduce(s, { t: 'timeUp', deadline: /** @type {number} */ (s.deadline) });
  assert.equal(finished.phase, 'finished');
  const done = at(finished);
  assert.equal(shiftRound(done, T0, T0 + 5000), done, 'finished');
  const none = at(null, null);
  assert.equal(shiftRound(none, T0, T0 + 5000), none, 'no round');
});
