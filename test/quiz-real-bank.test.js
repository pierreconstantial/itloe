// Contract E — the REAL bank (every data/quiz/*.json the server loads, e.g. OpenQuizzDB): it validates and
// is credited, no question leaks its answer / anecdote / source before the reveal, and the judge accepts
// each question's own right answer. Runs over every question, so a bad import fails here, not at the party.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBank } from '../server/quiz.ts';
import { projectQuiz, judgeAnswer, answerText } from '../shared/quiz/bank.js';
import { expectedAnswers, judgeLocal } from '../shared/quiz/judge-local.js';
import { startQuiz } from '../shared/quiz/index.js';


const bank = loadBank(); // the server's own loader: throws on any invalid question
/** An anecdote shorter than this is an import accident, not a fun fact (e.g. a lone "P"). */
const MIN_ANECDOTE = 12;
const T0 = 1_700_000_000_000;

/** One question alone in a quiz, opened in `mode`; returns its question-phase projection (JSON) and round. */
function open(/** @type {import('../shared/quiz/bank.js').Question} */ q, /** @type {'choice' | 'text'} */ mode) {
  const s = /** @type {import('../shared/quiz/index.js').QuizState} */ (startQuiz({ seed: 1, settings: { mode, count: 3 }, now: T0,
    players: [{ id: 'a', character: 'anna' }], inputs: [{ id: q.id, choices: q.choices ? q.choices.length : 0 }] }));
  return { s, json: JSON.stringify(projectQuiz(s, (id) => bank.byId.get(id), bank.credits)) };
}

test('the real bank loads (validated by the server loader), with stable unique ids and credits', () => {
  assert.ok(bank.questions.length > 10, `${bank.questions.length} questions`);
  assert.equal(new Set(bank.questions.map((q) => q.id)).size, bank.questions.length);
  assert.equal(bank.credits.length, bank.files.length, 'one credit line per dataset file');
  assert.ok(bank.questions.every((q) => q.typed !== false || q.choices), 'typed:false only on choice questions');
});

test('no question leaks its answer, anecdote or source before the reveal (choice and text form)', () => {
  /** @type {string[]} */
  const leaks = [];
  for (const q of bank.questions) {
    for (const mode of /** @type {const} */ (['choice', 'text'])) {
      if (mode === 'choice' && !q.choices) continue;
      if (mode === 'text' && q.typed === false) continue;
      const { s, json } = open(q, mode);
      if (s.phase !== 'question') { leaks.push(`${q.id} (${mode}): did not open`); continue; }
      const view = JSON.parse(json);
      const shown = new Set(view.round.question.choices ?? []);
      for (const text of expectedAnswers(q)) {
        if (!shown.has(text) && json.includes(JSON.stringify(text))) leaks.push(`${q.id} (${mode}): answer "${text}"`);
      }
      // structural: no anecdote field before the reveal; content: its text nowhere (when long enough to mean something)
      if (/"anecdote"/.test(json)) leaks.push(`${q.id} (${mode}): anecdote field`);
      if (q.anecdote && q.anecdote.trim().length >= MIN_ANECDOTE && json.includes(q.anecdote)) leaks.push(`${q.id} (${mode}): anecdote text`);
      if (json.includes(JSON.stringify(q.source))) leaks.push(`${q.id} (${mode}): source`);
      if (view.round.answer !== null || view.round.answers !== null) leaks.push(`${q.id} (${mode}): answer fields`);
    }
  }
  assert.deepEqual(leaks.slice(0, 10), [], `${leaks.length} leak(s)`);
});

test('the judge accepts every question\'s own right answer (as a choice, and typed when it can be)', () => {
  /** @type {string[]} */
  const refused = [];
  for (const q of bank.questions) {
    if (q.choices) {
      const { s } = open(q, 'choice');
      const r = /** @type {any} */ (s.round);
      const displayed = r.perm.indexOf(q.answer);
      if (judgeAnswer(q, r, { choice: displayed }) !== 'right') refused.push(`${q.id}: right choice judged wrong`);
      if (judgeAnswer(q, r, { choice: (displayed + 1) % r.perm.length }) !== 'wrong') refused.push(`${q.id}: a wrong choice judged right`);
    }
    if (q.typed !== false && judgeLocal(q, answerText(q)) !== 'right') refused.push(`${q.id}: typed "${answerText(q)}" not right`);
  }
  assert.deepEqual(refused.slice(0, 10), [], `${refused.length} problem(s)`);
});

test('anecdotes are real sentences (an import accident would show "💡 P" on the TV)', () => {
  const junk = bank.questions.filter((q) => q.anecdote !== undefined && q.anecdote.trim().length < MIN_ANECDOTE);
  assert.deepEqual(junk.map((q) => `${q.id}: ${JSON.stringify(q.anecdote)}`), [], `${junk.length} too-short anecdote(s): drop them in the importer`);
});
