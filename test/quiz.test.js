// Contract E — the quiz reducer (shared/quiz/index.js): pure, seeded, never sees an answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startQuiz, reduceQuiz as reduceRound, quizRanking, resolvePending, mergeQuizSettings, pointsFor, SCORING, QUIZ_DEFAULTS, QUIZ_RULES } from '../shared/quiz/index.js';

/** @typedef {import('../shared/quiz/index.js').QuizState} QuizState */
/** The reducer, with the host the campaign passes: 'a'. */
const reduceQuiz = (/** @type {QuizState} */ s, /** @type {import('../shared/quiz/index.js').QuizAction} */ a) => reduceRound(s, a, { hostId: 'a' });

const T0 = 1_700_000_000_000;
/** 6 candidates: 4 with choices, 2 text-only. */
const CANDIDATES = [
  { id: 'q1', choices: 4 }, { id: 'q2', choices: 4 }, { id: 'q3', choices: 0 },
  { id: 'q4', choices: 4 }, { id: 'q5', choices: 0 }, { id: 'q6', choices: 4 },
];

/** A quiz with Anna (host) and Sol on its first question, settings patched; null when it can't start. */
const start = (patch = {}, candidates = CANDIDATES) => startQuiz({
  seed: 42, settings: { count: 3, seconds: 20, ...patch }, now: T0, inputs: candidates,
  players: [{ id: 'a', character: 'anna' }, { id: 'b', character: 'sol' }],
});
const started = (patch = {}) => /** @type {QuizState} */ (start(patch));

test('quiz settings reject invalid ranges and modes and preserve valid filters', () => {
  assert.equal(mergeQuizSettings(QUIZ_DEFAULTS, { count: 2 }).count, QUIZ_DEFAULTS.count, 'below the minimum → dropped');
  assert.deepEqual(mergeQuizSettings(QUIZ_DEFAULTS, { count: 999, seconds: 25, mode: 'nope', level: 2, categories: ['histoire'] }),
    { ...QUIZ_DEFAULTS, seconds: 25, level: 2, categories: ['histoire'] });
});

test('start: seeded picks, candidate exhaustion and deadline from now', () => {
  assert.equal(start({}, []), null, 'nothing to ask → no quiz');
  const q = started();
  assert.equal(q.phase, 'question');
  assert.equal(q.questions.length, 3);
  assert.equal(q.round?.index, 0);
  assert.equal(q.round?.deadline, T0 + 20_000);
  assert.deepEqual(q.asked, [q.questions[0].id]);
  // deterministic: same seed + candidates → same pick
  assert.deepEqual(started().questions, q.questions);
  // fewer candidates than count → plays what there is
  const few = start({ count: 10 }, CANDIDATES.slice(0, 2));
  assert.equal(few?.questions.length, 2);
  assert.deepEqual(q.order.map((id) => [q.players[id].name, q.players[id].score]), [['Anna', 0], ['Sol', 0]]);
});

test('modes: choice asks only questions with choices; text never shows choices; mixed follows the question', () => {
  const choice = started({ mode: 'choice', count: 10 });
  assert.ok(choice.questions.every((c) => c.choices > 0));
  assert.equal(choice.round?.asChoice, true);
  assert.equal(choice.round?.perm?.length, 4);
  assert.deepEqual([...(choice.round?.perm ?? [])].sort(), [0, 1, 2, 3], 'perm is a permutation');
  const text = started({ mode: 'text', count: 10 });
  assert.equal(text.questions.length, 6, 'text mode can ask every question');
  assert.equal(text.round?.asChoice, false);
  assert.equal(text.round?.perm, null);
  const mixed = started({ mode: 'mixed', count: 6 });
  let s = mixed;
  for (let i = 0; i < 6; i++) {
    assert.equal(s.round?.asChoice, s.questions[i].choices > 0, `round ${i}`);
    s = reduceQuiz(reduceQuiz(s, { t: 'close', deadline: /** @type {any} */ (s.round).deadline }), { t: 'next', id: 'a', now: T0 + (i + 1) * 30_000 });
  }
});

/** First round as choice: both players answer. */
function choiceRound() { return started({ mode: 'choice' }); }

test('answer: once per round, before the deadline, valid choice; the last answer closes the round', () => {
  let s = choiceRound();
  const r = /** @type {any} */ (s.round);
  assert.equal(reduceQuiz(s, { t: 'answer', id: 'a', choice: 9, now: T0 + 1000, verdict: 'right' }), s, 'choice out of range');
  assert.equal(reduceQuiz(s, { t: 'answer', id: 'a', text: 'x', now: T0 + 1000, verdict: 'right' }), s, 'text on a choice round');
  assert.equal(reduceQuiz(s, { t: 'answer', id: 'a', choice: 1, now: r.deadline + 1, verdict: 'right' }), s, 'too late');
  assert.equal(reduceQuiz(s, { t: 'answer', id: 'zz', choice: 1, now: T0 + 1000, verdict: 'right' }), s, 'not seated');
  s = reduceQuiz(s, { t: 'answer', id: 'a', choice: 1, now: T0 + 2000, verdict: 'right' });
  assert.equal(s.phase, 'question');
  assert.equal(reduceQuiz(s, { t: 'answer', id: 'a', choice: 2, now: T0 + 3000, verdict: 'wrong' }), s, 'second answer refused');
  s = reduceQuiz(s, { t: 'answer', id: 'b', choice: 0, now: T0 + 5000, verdict: 'wrong' });
  assert.equal(s.phase, 'reveal', 'everyone answered → reveal at once');
  assert.equal(s.players.a.score, pointsFor(T0 + 2000, r.deadline, 20));
  assert.equal(s.players.a.correct, 1);
  assert.equal(s.players.b.score, 0);
});

test('scoring table: right + linear speed bonus, wrong 0', () => {
  const d = T0 + 20_000;
  assert.equal(pointsFor(T0, d, 20), SCORING.right + SCORING.speedMax);
  assert.equal(pointsFor(T0 + 10_000, d, 20), SCORING.right + SCORING.speedMax / 2);
  assert.equal(pointsFor(d, d, 20), SCORING.right);
});

test('close: only for the current deadline (stale timers harmless)', () => {
  const s = choiceRound();
  assert.equal(reduceQuiz(s, { t: 'close', deadline: 123 }), s);
  const r = reduceQuiz(s, { t: 'close', deadline: /** @type {any} */ (s.round).deadline });
  assert.equal(r.phase, 'reveal');
  assert.equal(reduceQuiz(r, { t: 'close', deadline: /** @type {any} */ (s.round).deadline }), r, 'already revealed');
});

test('uncertain text: pending until the judge; credited when the verdict lands, during question or reveal', () => {
  let s = started({ mode: 'text' });
  s = reduceQuiz(s, { t: 'answer', id: 'a', text: 'Hugo', now: T0 + 1000, verdict: 'uncertain' });
  assert.equal(s.round?.answers.a.ok, null);
  const of = { index: 0, questionId: /** @type {any} */ (s.round).questionId };
  s = reduceQuiz(s, { t: 'verdict', target: 'a', ok: true, ...of }); // judged during the question
  s = reduceQuiz(s, { t: 'answer', id: 'b', text: 'Zola', now: T0 + 2000, verdict: 'uncertain' });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.players.a.correct, 1, 'judged right before the close → credited at the reveal');
  assert.equal(s.players.b.score, 0, 'still pending');
  assert.equal(reduceQuiz(s, { t: 'verdict', target: 'b', ok: true, ...of, index: 1 }), s, 'a verdict about another round is ignored');
  assert.equal(reduceQuiz(s, { t: 'verdict', target: 'b', ok: true, ...of, questionId: 'other' }), s, '…also by its question');
  const late = reduceQuiz(s, { t: 'verdict', target: 'b', ok: true, ...of });
  assert.equal(late.players.b.correct, 1, 'a verdict landing on the reveal credits at once');
  assert.equal(reduceQuiz(late, { t: 'verdict', target: 'b', ok: false, ...of }), late, 'a decided answer is not re-judged');
  const timedOut = reduceQuiz(s, { t: 'verdict', target: 'b', ok: null, ...of });
  assert.equal(timedOut.round?.answers.b.ok, false, 'null (no judge / timeout) → wrong');
});

test('override: host on the reveal, any answer, both ways, re-scoring', () => {
  let s = choiceRound();
  s = reduceQuiz(s, { t: 'answer', id: 'a', choice: 1, now: T0 + 2000, verdict: 'right' });
  s = reduceQuiz(s, { t: 'answer', id: 'b', choice: 0, now: T0 + 4000, verdict: 'wrong' });
  assert.equal(reduceQuiz(s, { t: 'override', id: 'b', target: 'b', ok: true }), s, 'non-host');
  const up = reduceQuiz(s, { t: 'override', id: 'a', target: 'b', ok: true });
  assert.equal(up.players.b.score, /** @type {any} */ (s.round).answers.b.points);
  assert.equal(up.round?.answers.b.overridden, true);
  const down = reduceQuiz(up, { t: 'override', id: 'a', target: 'a', ok: false });
  assert.equal(down.players.a.score, 0);
  assert.equal(down.players.a.correct, 0);
  assert.equal(reduceQuiz(down, { t: 'override', id: 'a', target: 'a', ok: false }), down, 'no-op');
});

test('next: pending → wrong, next round, then finished after the last; asked accumulates', () => {
  let s = started({ mode: 'text', count: 3 });
  s = reduceQuiz(s, { t: 'answer', id: 'a', text: 'x', now: T0 + 1000, verdict: 'uncertain' });
  s = reduceQuiz(s, { t: 'close', deadline: /** @type {any} */ (s.round).deadline });
  assert.equal(reduceQuiz(s, { t: 'next', id: 'b', now: T0 }), s, 'non-host');
  s = reduceQuiz(s, { t: 'next', id: 'a', now: T0 + 30_000 });
  assert.equal(s.phase, 'question');
  assert.equal(s.round?.index, 1);
  assert.equal(s.round?.deadline, T0 + 30_000 + 20_000);
  assert.equal(s.asked.length, 2);
  s = reduceQuiz(s, { t: 'close', deadline: /** @type {any} */ (s.round).deadline });
  s = reduceQuiz(s, { t: 'next', id: 'a', now: T0 + 60_000 });
  assert.equal(s.round?.index, 2);
  s = reduceQuiz(s, { t: 'close', deadline: /** @type {any} */ (s.round).deadline });
  s = reduceQuiz(s, { t: 'next', id: 'a', now: T0 + 90_000 });
  assert.equal(s.phase, 'finished', 'after the last of `count` (3) questions');
  assert.equal(s.endReason, 'done');
  assert.equal(s.asked.length, 3);
});

test('endGame: host, from question (round dropped) or reveal (kept)', () => {
  let s = choiceRound();
  s = reduceQuiz(s, { t: 'answer', id: 'a', choice: 1, now: T0 + 1000, verdict: 'right' });
  const fromQuestion = reduceQuiz(s, { t: 'endGame', id: 'a' });
  assert.equal(fromQuestion.phase, 'finished');
  assert.equal(fromQuestion.endReason, 'host');
  assert.equal(fromQuestion.players.a.score, 0, 'half a round is not credited');
  const fromReveal = reduceQuiz(reduceQuiz(s, { t: 'close', deadline: /** @type {any} */ (s.round).deadline }), { t: 'endGame', id: 'a' });
  assert.ok(fromReveal.players.a.score > 0);
  assert.equal(reduceQuiz(fromQuestion, { t: 'endGame', id: 'a' }), fromQuestion, 'nothing left to end');
  assert.equal(reduceQuiz(s, { t: 'endGame', id: 'b' }), s, 'not the host');
});

test('leave: mid-quiz marks left, closes the round if they were the last awaited', () => {
  let s = choiceRound();
  s = reduceQuiz(s, { t: 'answer', id: 'a', choice: 1, now: T0 + 1000, verdict: 'right' });
  s = reduceQuiz(s, { t: 'leave', id: 'b' });
  assert.equal(s.players.b.left, true);
  assert.equal(s.phase, 'reveal', 'nobody else to wait for');
  assert.equal(reduceQuiz(s, { t: 'answer', id: 'b', choice: 1, now: T0 + 2000, verdict: 'right' }), s);
});

test('ranking shares ties; seated (who plays again) drops the players who left', () => {
  let s = choiceRound();
  s = reduceQuiz(s, { t: 'answer', id: 'a', choice: 1, now: T0 + 1000, verdict: 'right' });
  s = reduceQuiz(s, { t: 'answer', id: 'b', choice: 1, now: T0 + 1000, verdict: 'right' });
  const fin = reduceQuiz(s, { t: 'endGame', id: 'a' });
  assert.deepEqual(quizRanking(fin).map((r) => r.rank), [1, 1], 'same points → shared rank');
  assert.deepEqual(QUIZ_RULES.seated(fin), ['a', 'b']);
  assert.deepEqual(QUIZ_RULES.seated(reduceQuiz(fin, { t: 'leave', id: 'b' })), ['a']);
});

test('resolvePending: a resumed quiz never re-judges, pending → wrong', () => {
  let s = started({ mode: 'text' });
  s = reduceQuiz(s, { t: 'answer', id: 'a', text: 'Hugo', now: T0 + 1000, verdict: 'uncertain' });
  const r = resolvePending(s);
  assert.equal(r.round?.answers.a.ok, false);
  assert.equal(resolvePending(r), r, 'nothing pending → same object');
});

test('the state never holds an answer key (the bank stays on the server)', () => {
  const s = started();
  const json = JSON.stringify(s);
  for (const word of ['answer"', 'accept', '"q":', 'choices":[']) assert.ok(!json.includes(word), word);
});
