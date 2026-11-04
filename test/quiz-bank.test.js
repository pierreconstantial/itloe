// Contract E — bank validation, candidates, server-side judging, and the public projection:
// THE ANSWER IS NEVER IN A QUESTION-PHASE VIEW.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBank, candidatesFor, judgeAnswer, projectQuiz, answerText } from '../shared/quiz/bank.js';
import { expectedAnswers } from '../shared/quiz/judge-local.js';
import { initQuiz, reduceQuiz, QUIZ_DEFAULTS } from '../shared/quiz/index.js';

/** @type {import('../shared/quiz/bank.js').Question[]} */
const BANK = JSON.parse(readFileSync(new URL('../data/quiz/placeholder.json', import.meta.url), 'utf8')).questions;
const byId = new Map(BANK.map((q) => [q.id, q]));
const lookup = (/** @type {string} */ id) => byId.get(id);
const T0 = 1_700_000_000_000;

test('the placeholder bank is valid, mixed (choice + text), marked placeholder in its source', () => {
  assert.deepEqual(validateBank(BANK), []);
  assert.ok(BANK.filter((q) => q.anecdote).length >= 2, 'some questions carry an anecdote');
  assert.ok(BANK.length >= 10);
  assert.ok(BANK.some((q) => q.choices) && BANK.some((q) => !q.choices));
  assert.ok(BANK.every((q) => /placeholder/.test(q.source)));
});

test('validateBank lists every problem', () => {
  const bad = validateBank([
    { id: 'a', q: 'Q?', answer: 'x', category: 'c', level: 1, source: 's' },
    { id: 'a', q: '', choices: ['1', '2', '3'], answer: 5, category: '', level: 4 },
    { id: 'c', q: 'Q?', choices: ['A', 'a', 'B', 'C'], answer: 0, category: 'c', level: 2, source: 's' },
    { q: 'Q?', answer: '', category: 'c', level: 1, source: 's', accept: 'nope' },
    { id: 'd', q: 'Q?', answer: 'x', category: 'c', level: 1, source: 's', anecdote: '' },
  ]);
  for (const part of ['duplicate id', 'missing question text', 'choices must be 4', 'answer must be the right choice', 'missing category',
    'level must be', 'missing source', 'duplicate choices', 'missing id', 'answer must be a non-empty string', 'accept must be',
    'anecdote must be']) {
    assert.ok(bad.some((p) => p.includes(part)), part);
  }
});

test('candidatesFor: settings filters and never a question asked earlier this evening', () => {
  const all = candidatesFor(BANK, QUIZ_DEFAULTS, []);
  assert.equal(all.length, BANK.length);
  const choice = candidatesFor(BANK, { ...QUIZ_DEFAULTS, mode: 'choice' }, []);
  assert.ok(choice.length > 0 && choice.every((c) => c.choices === 4));
  const geo = candidatesFor(BANK, { ...QUIZ_DEFAULTS, categories: ['géographie'] }, []);
  assert.ok(geo.every((c) => lookup(c.id)?.category === 'géographie'));
  const lvl2 = candidatesFor(BANK, { ...QUIZ_DEFAULTS, level: 2 }, []);
  assert.ok(lvl2.every((c) => lookup(c.id)?.level === 2));
  const fresh = candidatesFor(BANK, QUIZ_DEFAULTS, ['ph-geo-canberra', 'ph-lit-miserables']);
  assert.equal(fresh.length, BANK.length - 2);
  assert.ok(!fresh.some((c) => c.id === 'ph-geo-canberra'));
});

test('judgeAnswer: a displayed choice maps through the round permutation; text uses the local judge', () => {
  const q = /** @type {any} */ (lookup('ph-geo-canberra')); // answer index 1
  const round = { asChoice: true, perm: [3, 1, 0, 2] }; // Canberra is displayed second (index 1)
  assert.equal(judgeAnswer(q, round, { choice: 1 }), 'right');
  assert.equal(judgeAnswer(q, round, { choice: 0 }), 'wrong');
  assert.equal(judgeAnswer(q, round, { choice: 9 }), 'wrong');
  assert.equal(judgeAnswer(q, { asChoice: false, perm: null }, { text: 'canbera' }), 'right', 'a choice question asked as text');
  assert.equal(judgeAnswer(/** @type {any} */ (lookup('ph-lit-miserables')), { asChoice: false, perm: null }, { text: 'Hugo' }), 'right', 'accept list');
});

/** A whole quiz over the real bank: Anna answers right, Sol wrong, every round. */
/** @param {'choice' | 'text' | 'mixed'} mode */
function playAll(mode) {
  let s = initQuiz(7, { mode, count: 10 });
  s = reduceQuiz(s, { t: 'join', id: 'a', character: 'anna' });
  s = reduceQuiz(s, { t: 'join', id: 'b', character: 'sol' });
  s = reduceQuiz(s, { t: 'start', id: 'a', now: T0, candidates: candidatesFor(BANK, s.settings, []) });
  /** @type {{ phase: string, json: string, q: import('../shared/quiz/bank.js').Question }[]} */
  const seen = [];
  let now = T0;
  while (s.phase === 'question') {
    const r = /** @type {any} */ (s.round);
    const q = /** @type {any} */ (lookup(r.questionId));
    seen.push({ phase: s.phase, json: JSON.stringify(projectQuiz(s, lookup)), q });
    const right = r.asChoice ? { choice: r.perm.indexOf(q.answer) } : { text: answerText(q) };
    const wrong = r.asChoice ? { choice: (r.perm.indexOf(q.answer) + 1) % 4 } : { text: 'zzz' };
    s = reduceQuiz(s, { t: 'answer', id: 'a', ...right, now: now + 1000, verdict: judgeAnswer(q, r, right) });
    seen.push({ phase: s.phase, json: JSON.stringify(projectQuiz(s, lookup)), q }); // after one answer, still a question
    s = reduceQuiz(s, { t: 'answer', id: 'b', ...wrong, now: now + 2000, verdict: judgeAnswer(q, r, wrong) });
    seen.push({ phase: s.phase, json: JSON.stringify(projectQuiz(s, lookup)), q });
    now += 30_000;
    s = reduceQuiz(s, { t: 'next', id: 'a', now });
  }
  return { s, seen };
}

for (const mode of /** @type {const} */ (['choice', 'text', 'mixed'])) {
  test(`projection (${mode}): no answer, verdict, typed text or given choice in ANY question-phase view`, () => {
    const { s, seen } = playAll(mode);
    assert.equal(s.phase, 'finished');
    assert.equal(s.players.a.correct, s.questions.length, 'Anna right every round (judging through the server path works)');
    assert.equal(s.players.b.correct, 0);
    const questionViews = seen.filter((v) => v.phase === 'question');
    assert.ok(questionViews.length >= s.questions.length);
    for (const { json, q } of questionViews) {
      const view = JSON.parse(json);
      assert.equal(view.round.answer, null, `${q.id}: answer null`);
      assert.equal(view.round.answers, null, `${q.id}: no answers`);
      assert.ok(!('questions' in view) && !('seed' in view), 'no future picks, no seed');
      // grep: no accepted spelling of the answer as a JSON string value, other than a displayed choice
      const shown = new Set(view.round.question.choices ?? []);
      for (const text of expectedAnswers(q)) {
        if (shown.has(text)) continue; // it is one of the 4 displayed choices: that is the question itself
        assert.ok(!json.includes(JSON.stringify(text)), `${q.id}: "${text}" leaked in ${json}`);
      }
      if (q.anecdote) assert.ok(!json.includes(q.anecdote) && !json.includes('anecdote'), `${q.id}: the anecdote leaked before the reveal`);
      assert.ok(!/"(ok|verdict|text|choice)":/.test(json.replace(/"choices":\[[^\]]*\]/, '')), `${q.id}: no verdict/text/choice fields`);
    }
    for (const { json, q } of seen.filter((v) => v.phase === 'reveal')) {
      const view = JSON.parse(json);
      assert.equal(view.round.answer.text, answerText(q), 'reveal: the answer');
      assert.equal(view.round.answer.anecdote, q.anecdote, 'reveal: the anecdote when there is one');
      assert.ok(view.round.answers.a.ok === true && view.round.answers.b.ok === false, 'reveal: verdicts');
    }
  });
}
