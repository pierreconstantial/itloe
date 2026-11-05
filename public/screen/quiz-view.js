// TV quiz screen (Contract E), rendered from the round's view — the PUBLIC projection (shared/quiz/bank.js
// projectQuiz): no answer before the reveal. Question → reveal → …; the finished quiz is the frame's podium.
// Pure helpers (tested) + DOM builders; quiz-screen.js owns timers and sounds.

import { h, colorDot, playerColor, formatScore } from './dom.js';
import { bindScore } from './score-ticker.js';

/** @typedef {import('../../shared/quiz/bank.js').QuizView} QuizView */
/** @typedef {import('../../shared/quiz/bank.js').RoundView} RoundView */

export const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Seated players (a left one is gone). @param {QuizView} q */
export const seatedIds = (q) => q.order.filter((id) => q.players[id] && !q.players[id].left);

/**
 * One row per seated player for the reveal.
 * pending: the judge has not ruled yet (ok null) · none: no answer before the deadline.
 * @param {QuizView} q
 * @returns {{ id: string, state: 'right' | 'wrong' | 'pending' | 'none', points: number, text: string | null, choice: number | null, overridden: boolean }[]}
 */
export function revealRows(q) {
  const answers = q.round?.answers ?? {};
  return seatedIds(q).map((id) => {
    const a = answers[id];
    if (!a) return { id, state: 'none', points: 0, text: null, choice: null, overridden: false };
    const state = a.ok === null ? 'pending' : a.ok ? 'right' : 'wrong';
    return {
      id, state, points: a.points ?? 0,
      text: typeof a.text === 'string' ? a.text : null,
      choice: typeof a.choice === 'number' ? a.choice : null,
      overridden: !!a.overridden,
    };
  });
}

/**
 * Who picked each displayed choice (reveal only; before it, `answers` is null by contract).
 * @param {QuizView} q @returns {string[][]}  index → player ids
 */
export function pickedBy(q) {
  const n = q.round?.question.choices?.length ?? 0;
  /** @type {string[][]} */
  const out = Array.from({ length: n }, () => []);
  for (const r of revealRows(q)) if (r.choice !== null && out[r.choice]) out[r.choice].push(r.id);
  return out;
}

/** "Question 3 / 10 · géographie". @param {QuizView} q */
export function questionHeader(q) {
  const r = q.round;
  if (!r) return '';
  return [`Question ${r.index + 1} / ${r.total}`, r.question.category].filter(Boolean).join(' · ');
}

/** Dataset attribution lines (licences such as CC BY-SA require them), present in every phase. @param {QuizView} q */
export const creditsOf = (q) => (Array.isArray(q.credits) ? q.credits.filter((c) => typeof c === 'string' && c.trim()) : []);

/** The revealed question's own source (from the reveal on). @param {QuizView} q */
export const sourceOf = (q) => {
  const s = q.round?.answer?.source;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
};

/** The reveal's anecdote, when the projection carries one (only ever from the reveal on). @param {QuizView} q */
export const anecdoteOf = (q) => {
  const a = /** @type {{ anecdote?: unknown } | null | undefined} */ (q.round?.answer);
  return typeof a?.anecdote === 'string' && a.anecdote.trim() ? a.anecdote.trim() : null;
};

// ---------------------------------------------------------------- DOM

/** @param {QuizView} q @param {string} id */
function chip(q, id, extra = '') {
  const p = q.players[id];
  const el = h('span', `quiz-chip${extra}`, [colorDot(p.color), h('span', 'quiz-chip-name', [p.name])]);
  el.dataset.id = id;
  el.style.setProperty('--pc', playerColor(p.color));
  return el;
}

/** @param {QuizView} q */
function scoreboard(q) {
  return h('div', 'quiz-scores', seatedIds(q).map((id) => {
    const score = h('span', 'quiz-score');
    bindScore(`quiz:${id}`, q.players[id].score, score); // counts up into the new score on the reveal
    const row = h('div', 'quiz-score-row', [chip(q, id), score]);
    row.dataset.id = id;
    return row;
  }));
}

/**
 * Question: the text big, choices as lettered tiles (or the typed-answer prompt), the countdown ring
 * (main.js drives `--left`), and who has answered — never what.
 * @param {QuizView} q
 */
export function renderQuestion(q) {
  const r = /** @type {RoundView} */ (q.round);
  const answered = new Set(r.answered);
  return h('section', 'quiz quiz-question', [
    h('div', 'quiz-top', [
      h('p', 'quiz-header', [questionHeader(q)]),
      h('div', 'quiz-ring', [h('span', 'quiz-ring-num', [''])]),
    ]),
    h('h1', 'quiz-q', [r.question.q]),
    r.question.choices
      ? h('div', 'quiz-choices', r.question.choices.map((c, i) => h('div', `quiz-choice c${i}`, [h('span', 'quiz-letter', [CHOICE_LETTERS[i] ?? '?']), h('span', 'quiz-choice-text', [c])])))
      : h('p', 'quiz-type-hint', ['✍️ Type your answer on your phone']),
    h('div', 'quiz-chips', seatedIds(q).map((id) => chip(q, id, answered.has(id) ? ' has-answered' : ''))),
  ]);
}

/**
 * Reveal: the right answer lit, who picked what, per player ✓ / ✗ / judging… and points, scores
 * counting up, the anecdote when there is one.
 * @param {QuizView} q
 */
export function renderReveal(q) {
  const r = /** @type {RoundView} */ (q.round);
  const right = r.answer?.choice ?? null;
  const rows = revealRows(q);
  const picks = pickedBy(q);
  const anecdote = anecdoteOf(q);
  return h('section', 'quiz quiz-reveal', [
    h('div', 'quiz-top', [h('p', 'quiz-header', [questionHeader(q)])]),
    h('h1', 'quiz-q is-small', [r.question.q]),
    r.question.choices
      ? h('div', 'quiz-choices', r.question.choices.map((c, i) => h('div', `quiz-choice c${i}${i === right ? ' is-right' : ' is-wrong'}`, [
        h('span', 'quiz-letter', [CHOICE_LETTERS[i] ?? '?']),
        h('span', 'quiz-choice-text', [c]),
        h('span', 'quiz-picks', (picks[i] ?? []).map((id) => colorDot(q.players[id].color))),
      ])))
      : h('p', 'quiz-answer', ['✅ ', h('strong', '', [r.answer?.text ?? ''])]),
    ...(anecdote ? [h('p', 'quiz-anecdote', [`💡 ${anecdote}`])] : []),
    h('div', 'quiz-results', rows.map((row) => {
      const mark = row.state === 'right' ? '✓' : row.state === 'wrong' ? '✗' : row.state === 'pending' ? '⏳' : '—';
      const what = row.state === 'pending' ? 'judging…' : row.state === 'none' ? 'no answer'
        : row.state === 'right' ? `+${formatScore(row.points)}` : '0';
      const el = h('div', `quiz-result is-${row.state}`, [
        chip(q, row.id),
        ...(row.text !== null ? [h('span', 'quiz-typed', [`« ${row.text} »`])] : []),
        h('span', 'quiz-mark', [mark]),
        h('span', 'quiz-points', [what]),
        ...(row.overridden ? [h('span', 'quiz-fixed', ['fixed by the host'])] : []),
      ]);
      el.dataset.id = row.id;
      return el;
    })),
    scoreboard(q),
    ...(sourceOf(q) ? [h('p', 'quiz-source', [`Source: ${sourceOf(q)}`])] : []),
  ]);
}
