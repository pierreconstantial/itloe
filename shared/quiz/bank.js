// Question bank helpers (Contract E + E1): validation, candidate selection, judging a choice, and the
// PUBLIC projection of a quiz. Pure; the bank itself stays on the server (data/quiz/*.json, never
// served): only these helpers' outputs travel, and the projection never carries an answer before the
// reveal.
import { judgeLocal, expectedAnswers } from './judge-local.js';

/** @typedef {import('./index.js').QuizState} QuizState */
/** @typedef {import('./index.js').QuizSettings} QuizSettings */
/** @typedef {import('./index.js').Candidate} Candidate */
/** @typedef {import('./index.js').Verdict} Verdict */
/**
 * @typedef {{
 *   id: string, q: string,
 *   choices?: string[],            // exactly 4 when present; `answer` is then the right one's index
 *   answer: string | number,
 *   accept?: string[],             // other spellings accepted when typed
 *   category: string, level: 1 | 2 | 3,
 *   source: string,                // dataset + licence (attribution is kept)
 * }} Question
 */

export const CHOICES = 4;

/**
 * Every problem in a bank (empty = valid). Run at boot: a broken bank refuses to start.
 * @param {unknown[]} questions @returns {string[]}
 */
export function validateBank(questions) {
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  const nonEmpty = (/** @type {unknown} */ x) => typeof x === 'string' && x.trim() !== '';
  questions.forEach((raw, i) => {
    const q = /** @type {Partial<Question>} */ (raw ?? {});
    const at = `question #${i}${nonEmpty(q.id) ? ` (${q.id})` : ''}`;
    if (!nonEmpty(q.id)) problems.push(`${at}: missing id`);
    else if (seen.has(q.id)) problems.push(`${at}: duplicate id`);
    else seen.add(q.id);
    if (!nonEmpty(q.q)) problems.push(`${at}: missing question text "q"`);
    if (q.choices !== undefined) {
      const c = q.choices;
      if (!Array.isArray(c) || c.length !== CHOICES || !c.every(nonEmpty)) problems.push(`${at}: choices must be ${CHOICES} non-empty strings`);
      else if (new Set(c.map((x) => x.trim().toLowerCase())).size !== CHOICES) problems.push(`${at}: duplicate choices`);
      if (!Number.isInteger(q.answer) || /** @type {number} */ (q.answer) < 0 || /** @type {number} */ (q.answer) >= CHOICES) problems.push(`${at}: answer must be the right choice's index 0..${CHOICES - 1}`);
    } else if (!nonEmpty(q.answer)) {
      problems.push(`${at}: answer must be a non-empty string (no choices)`);
    }
    if (q.accept !== undefined && !(Array.isArray(q.accept) && q.accept.every(nonEmpty))) problems.push(`${at}: accept must be a list of strings`);
    if (!nonEmpty(q.category)) problems.push(`${at}: missing category`);
    if (![1, 2, 3].includes(/** @type {number} */ (q.level))) problems.push(`${at}: level must be 1, 2 or 3`);
    if (!nonEmpty(q.source)) problems.push(`${at}: missing source (dataset + licence)`);
  });
  return problems;
}

/**
 * The questions a quiz may pick from: matching the settings, never asked earlier this evening.
 * @param {Question[]} bank @param {QuizSettings} settings @param {readonly string[]} asked
 * @returns {Candidate[]}
 */
export function candidatesFor(bank, settings, asked) {
  const done = new Set(asked);
  return bank
    .filter((q) => !done.has(q.id))
    .filter((q) => settings.mode !== 'choice' || !!q.choices)
    .filter((q) => !settings.categories || settings.categories.includes(q.category))
    .filter((q) => settings.level === null || q.level === settings.level)
    .map((q) => ({ id: q.id, choices: q.choices ? q.choices.length : 0 }));
}

/**
 * The verdict for a submitted answer, computed by the server before it enters the reducer.
 * @param {Question} q @param {{ asChoice: boolean, perm: number[] | null }} round
 * @param {{ choice?: number, text?: string }} given @returns {Verdict}
 */
export function judgeAnswer(q, round, given) {
  if (round.asChoice) {
    const bankIndex = round.perm?.[/** @type {number} */ (given.choice)];
    return bankIndex !== undefined && bankIndex === q.answer ? 'right' : 'wrong';
  }
  return judgeLocal(q, String(given.text ?? ''));
}

/** The text of the right answer, as shown on the reveal. @param {Question} q */
export const answerText = (q) => expectedAnswers(q)[0] ?? '';

/**
 * @typedef {{
 *   index: number, total: number, deadline: number,
 *   question: { q: string, category: string, level: number, choices: string[] | null },
 *   answered: string[],                       // who has answered (never what, before the reveal)
 *   answers: Record<string, { choice?: number, text?: string, ok: boolean | null, points: number, overridden?: boolean }> | null,
 *   answer: { choice: number | null, text: string } | null,   // null until the reveal
 * }} RoundView
 */
/**
 * @typedef {Omit<QuizState, 'round' | 'questions' | 'seed'> & { total: number, round: RoundView | null }} QuizView
 */

/**
 * The public quiz: what TVs and phones may see. During a question: the question and who answered,
 * NO verdicts, texts, choices given, nor the answer. From the reveal on: everything for that round.
 * @param {QuizState} s @param {(id: string) => Question | undefined} lookup @returns {QuizView}
 */
export function projectQuiz(s, lookup) {
  const { round, questions, seed: _seed, ...rest } = s;
  /** @type {RoundView | null} */
  let rv = null;
  if (round) {
    const q = lookup(round.questionId);
    const open = s.phase === 'reveal' || s.phase === 'finished';
    const choices = round.asChoice && q?.choices && round.perm ? round.perm.map((i) => /** @type {string[]} */ (q.choices)[i]) : null;
    rv = {
      index: round.index, total: questions.length, deadline: round.deadline,
      question: { q: q?.q ?? '?', category: q?.category ?? '', level: q?.level ?? 0, choices },
      answered: Object.keys(round.answers),
      answers: open
        ? Object.fromEntries(Object.entries(round.answers).map(([id, a]) => [id, {
          ...(a.choice !== undefined ? { choice: a.choice } : {}), ...(a.text !== undefined ? { text: a.text } : {}),
          ok: a.ok, points: a.points, ...(a.overridden ? { overridden: true } : {}),
        }]))
        : null,
      answer: open && q
        ? { choice: round.asChoice && round.perm ? round.perm.indexOf(/** @type {number} */ (q.answer)) : null, text: answerText(q) }
        : null,
    };
  }
  return { ...rest, total: questions.length, round: rv };
}
