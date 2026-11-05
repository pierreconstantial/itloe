// TV quiz screen helpers (public/screen/quiz-view.js) over the real reducer + public projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initQuiz, reduceQuiz as reduceRound } from '../shared/quiz/index.js';
import { projectQuiz } from '../shared/quiz/bank.js';
import { anecdoteOf, pickedBy, questionHeader, revealRows, seatedIds } from '../public/screen/quiz-view.js';
import { summarizeQuiz } from '../public/commun/quiz-text.js';

/** The quiz reducer, with the tableau's settings the campaign passes: the ones the quiz was created with. */
const reduceQuiz = (/** @type {import('../shared/quiz/index.js').QuizState} */ s, /** @type {import('../shared/quiz/index.js').QuizAction} */ a) => reduceRound(s, a, { settings: s.rules });

const T0 = 1_700_000_000_000;
/** @type {Record<string, any>} */
const BANK = {
  q1: { id: 'q1', q: 'Quelle est la capitale de l’Australie ?', choices: ['Sydney', 'Canberra', 'Melbourne', 'Perth'], answer: 1, category: 'géographie', level: 2 },
  q2: { id: 'q2', q: 'Qui a écrit Les Misérables ?', answer: 'Victor Hugo', category: 'littérature', level: 1 },
};
const lookup = (/** @type {string} */ id) => BANK[id];

/** A three-player quiz on its first (choice) question. */
function question() {
  let s = initQuiz(7, { count: 2, seconds: 20, mode: 'mixed' });
  for (const [id, c] of [['a', 'anna'], ['b', 'sol'], ['c', 'pierre']]) s = reduceQuiz(s, { t: 'join', id, character: /** @type {any} */ (c) });
  s = reduceQuiz(s, { t: 'start', id: 'a', now: T0, candidates: [{ id: 'q1', choices: 4 }, { id: 'q2', choices: 0 }] });
  return s;
}

test('question: header, seated players, no answers leaked before the reveal', () => {
  let s = question();
  const asked = s.round?.questionId;
  const q0 = projectQuiz(s, lookup);
  assert.equal(q0.phase, 'question');
  assert.match(questionHeader(q0), /^Question 1 \/ 2 · /);
  assert.deepEqual(seatedIds(q0), ['a', 'b', 'c']);
  const isChoice = !!q0.round?.question.choices;
  s = reduceQuiz(s, isChoice
    ? { t: 'answer', id: 'a', choice: 0, now: T0 + 2000, verdict: 'wrong' }
    : { t: 'answer', id: 'a', text: 'x', now: T0 + 2000, verdict: 'wrong' });
  const q1 = projectQuiz(s, lookup);
  assert.deepEqual(q1.round?.answered, ['a']);
  assert.equal(q1.round?.answers, null, 'what they answered stays hidden');
  assert.deepEqual(revealRows(q1).map((r) => r.state), ['none', 'none', 'none'], 'nothing to show before the reveal');
  assert.ok(asked);
});

test('reveal: right / wrong / pending / none per seated player, points, who picked what', () => {
  let s = question();
  const choice = !!s.round?.asChoice;
  const ans = (/** @type {string} */ id, /** @type {any} */ verdict, /** @type {number} */ k) => (choice
    ? { t: 'answer', id, choice: k, now: T0 + 1000 * (k + 1), verdict }
    : { t: 'answer', id, text: `t${k}`, now: T0 + 1000 * (k + 1), verdict });
  s = reduceQuiz(s, /** @type {any} */ (ans('a', 'right', 0)));
  s = reduceQuiz(s, /** @type {any} */ (ans('b', 'uncertain', 1))); // waiting for the judge
  s = reduceQuiz(s, { t: 'close', deadline: /** @type {number} */ (s.round?.deadline) });
  const q = projectQuiz(s, lookup);
  assert.equal(q.phase, 'reveal');
  const rows = revealRows(q);
  assert.deepEqual(rows.map((r) => [r.id, r.state]), [['a', 'right'], ['b', 'pending'], ['c', 'none']]);
  assert.ok(rows[0].points > 0);
  if (choice) {
    const picks = pickedBy(q);
    assert.equal(picks.length, 4);
    assert.deepEqual(picks[0], ['a']);
    assert.deepEqual(picks[1], ['b']);
  } else {
    assert.equal(rows[0].text, 't0');
  }
  assert.equal(anecdoteOf(q), null, 'no anecdote in this projection');
  const withAnecdote = /** @type {any} */ ({ ...q, round: { ...q.round, answer: { choice: null, text: 'x', anecdote: '  Canberra fut choisie en 1908.  ' } } });
  assert.equal(anecdoteOf(withAnecdote), 'Canberra fut choisie en 1908.');
});

test('summarizeQuiz wording', () => {
  assert.equal(summarizeQuiz({ count: 10, seconds: 20, mode: 'mixed' }), '10 questions · 20 s each · choices and typed answers');
  assert.equal(summarizeQuiz({ count: 5, seconds: 30, mode: 'choice' }), '5 questions · 30 s each · multiple choice');
});

test('credits in every phase; the question source only from the reveal on', async () => {
  const { creditsOf, sourceOf } = await import('../public/screen/quiz-view.js');
  const s = question();
  const credits = ['OpenQuizzDB — CC BY-SA 4.0'];
  const q = projectQuiz(s, (id) => ({ ...BANK[id], source: 'OpenQuizzDB #123 (CC BY-SA)' }), credits);
  assert.deepEqual(creditsOf(q), credits, 'question phase: credits shown');
  assert.equal(sourceOf(q), null, 'no source before the reveal');
  const closed = reduceQuiz(s, { t: 'close', deadline: /** @type {number} */ (s.round?.deadline) });
  const r = projectQuiz(closed, (id) => ({ ...BANK[id], source: 'OpenQuizzDB #123 (CC BY-SA)' }), credits);
  assert.equal(sourceOf(r), 'OpenQuizzDB #123 (CC BY-SA)');
  assert.deepEqual(creditsOf({ ...r, credits: /** @type {any} */ (undefined) }), [], 'older server without credits');
});
