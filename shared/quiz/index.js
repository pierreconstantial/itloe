// Quiz activity (Contract E + addendum E1): a pure state machine, nested in the campaign like the
// block game. Pure JSDoc ESM, no I/O, no clock, no randomness outside the seed.
//
// The reducer NEVER sees the bank or an answer: the server judges each answer as it arrives and
// injects the verdict (choice → index compare, text → judge-local, 'uncertain' → a later `verdict`).
// A quiz starts with startQuiz on question 1 (the campaign hands in the players, the settings, the time
// and the candidate questions); phases: question → reveal → question → … → finished (the podium).
//
// Actions (ids, now, deadline and verdicts are injected by the server, never from the wire):
//   leave { id }                    marked left; the round closes if they were the last one awaited
//   answer { id, choice | text, now, verdict }   once per round, before the deadline
//   close { deadline }              server: the round's timer rang (stale deadlines are ignored)
//   verdict { target, ok, index, questionId }   server: the async judge decided an 'uncertain' answer of that
//                                   round (null = wrong); a verdict for another round is ignored
//   override { id, target, ok }     host, on the reveal: fixes any answer, both ways, re-scoring it
//   next { id, now }                host: reveal → next question, or finished after the last
//   endGame { id }                  host: question/reveal → finished
// The last answer of a round closes it at once (no waiting for the timer when everyone answered).
// The host is the party's, passed in by the campaign with every action.

import { CHARACTERS } from '../characters.js';
import { mulberry32 } from '../rng.js';
import { ranking } from '../ranking.js';

/** @typedef {import('../characters.js').CharacterId} CharacterId */
/** @typedef {'choice' | 'text' | 'mixed'} QuizMode */
/** @typedef {{ count: number, seconds: number, mode: QuizMode, categories: string[] | null, level: 1 | 2 | 3 | null }} QuizSettings */
/** @typedef {'right' | 'wrong' | 'uncertain'} Verdict */
/**
 * An answer as the reducer keeps it. `ok`: final correctness (null = waiting for the judge);
 * `points`: what it is worth if right (base + speed bonus, fixed when it was given).
 * @typedef {{ choice?: number, text?: string, at: number, verdict: Verdict, ok: boolean | null, points: number, overridden?: boolean }} Answer
 */
/** @typedef {{ id: string, choices: number }} Candidate  choices: how many the question has (0 = text only) */
/**
 * @typedef {{ index: number, questionId: string, asChoice: boolean, perm: number[] | null,
 *   deadline: number, answers: Record<string, Answer>, credited: boolean }} Round
 * perm: displayed position → the bank's choice index (choices shuffled per round); null for text
 */
/** @typedef {{ id: string, character: CharacterId | null, name: string, color: number, score: number, correct: number, left: boolean }} QuizPlayer */
/**
 * @typedef {{
 *   kind: 'quiz',
 *   phase: 'question' | 'reveal' | 'finished',
 *   seed: number,
 *   rules: QuizSettings,          // the tableau's settings, locked in at the start
 *   order: string[],
 *   players: Record<string, QuizPlayer>,
 *   questions: Candidate[],       // picked at start, in play order
 *   round: Round | null,
 *   asked: string[],              // ids of the questions actually shown (reported to the campaign)
 *   endReason: 'done' | 'host' | null,
 * }} QuizState
 */
/**
 * @typedef {{ t: 'leave', id: string }
 *   | { t: 'answer', id: string, choice?: number, text?: string, now: number, verdict: Verdict }
 *   | { t: 'close', deadline: number }
 *   | { t: 'verdict', target: string, ok: boolean | null, index: number, questionId: string }
 *   | { t: 'override', id: string, target: string, ok: boolean }
 *   | { t: 'next', id: string, now: number }
 *   | { t: 'endGame', id: string }} QuizAction
 */

/** @type {QuizSettings} */
export const QUIZ_DEFAULTS = Object.freeze({ count: 10, seconds: 20, mode: 'mixed', categories: null, level: null });

/**
 * Editable settings, data-driven (validation + a settings UI): like the block game's schema.
 * @type {Readonly<Record<string, { kind: 'range', min: number, max: number, step: number } | { kind: 'choice', values: readonly string[] }>>}
 */
export const QUIZ_SETTINGS_SCHEMA = Object.freeze({
  count: { kind: 'range', min: 3, max: 30, step: 1 },
  seconds: { kind: 'range', min: 10, max: 60, step: 5 },
  mode: { kind: 'choice', values: ['choice', 'text', 'mixed'] },
});

/** Points: a right answer is worth `right` plus up to `speedMax` for answering early (linear on the time left). */
export const SCORING = Object.freeze({ right: 100, speedMax: 50 });

/** The quiz's own counters, recorded with its result (content conditions may read them). */
export const QUIZ_COUNTER = {
  /** @param {string} character — right answers across every quiz of the evening */
  correctBy: (character) => `quiz.correct.${character}`,
  /** @param {string} node — right answers in that quiz tableau, everyone together (content: "≥ 4 right") */
  nodeCorrect: (node) => `node.${node}.correct`,
  /** @param {string} node @param {string} character — right answers in that quiz tableau by one character */
  nodeCorrectBy: (node, character) => `node.${node}.correct.${character}`,
};

/** Longest typed answer kept (anything longer is cut). */
export const MAX_TEXT = 120;

const LEVELS = [1, 2, 3];


/**
 * Settings from a partial patch: unknown keys and invalid values are dropped (like the block game).
 * @param {QuizSettings} base @param {unknown} patch @returns {QuizSettings}
 */
export function mergeQuizSettings(base, patch) {
  const out = { ...base };
  if (!patch || typeof patch !== 'object') return out;
  const p = /** @type {Record<string, unknown>} */ (patch);
  for (const [key, spec] of Object.entries(QUIZ_SETTINGS_SCHEMA)) {
    const v = p[key];
    if (v === undefined) continue;
    if (spec.kind === 'range' && typeof v === 'number' && Number.isInteger(v) && v >= spec.min && v <= spec.max && (v - spec.min) % spec.step === 0) {
      /** @type {any} */ (out)[key] = v;
    }
    if (spec.kind === 'choice' && typeof v === 'string' && spec.values.includes(v)) /** @type {any} */ (out)[key] = v;
  }
  if (p.categories === null || (Array.isArray(p.categories) && p.categories.every((c) => typeof c === 'string'))) {
    out.categories = p.categories === null || p.categories.length === 0 ? null : [...new Set(/** @type {string[]} */ (p.categories))];
  }
  if (p.level === null || LEVELS.includes(/** @type {number} */ (p.level))) out.level = /** @type {QuizSettings['level']} */ (p.level);
  return out;
}

/**
 * Problems in content settings, as readable lines (empty = valid): an unknown key, or a value
 * mergeQuizSettings would drop or change.
 * @param {unknown} settings @returns {string[]}
 */
export function validateQuizSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return ['settings must be an object'];
  return Object.entries(settings).flatMap(([key, v]) => {
    if (!Object.hasOwn(QUIZ_DEFAULTS, key)) return [`unknown setting "${key}"`];
    const kept = /** @type {Record<string, unknown>} */ (mergeQuizSettings(QUIZ_DEFAULTS, { [key]: v }))[key];
    return JSON.stringify(kept) === JSON.stringify(v) ? [] : [`setting "${key}" can't be ${JSON.stringify(v)}`];
  });
}

/**
 * A new quiz on its first question: the players handed in, the settings locked in as its rules, `count`
 * questions picked (seeded) among the candidates (`inputs`). null when there is no player, no finite `now`,
 * or nothing left to ask.
 * @param {import('../minigames.js').RoundStart<Partial<QuizSettings>>} start @returns {QuizState | null}
 */
export function startQuiz({ seed, settings, players, now, inputs }) {
  const rules = mergeQuizSettings(QUIZ_DEFAULTS, settings);
  if (players.length === 0 || !Number.isFinite(now) || !Array.isArray(inputs)) return null;
  const pool = askable(inputs, rules.mode);
  if (pool.length === 0) return null; // nothing left to ask
  const s = seed >>> 0;
  /** @type {Record<string, QuizPlayer>} */
  const seated = {};
  for (const { id, character } of players) {
    const { name, color } = CHARACTERS[character];
    seated[id] = { id, character, name, color, score: 0, correct: 0, left: false };
  }
  const questions = shuffle(pool, mulberry32(s)).slice(0, rules.count);
  return openRound({
    kind: 'quiz', phase: 'question', seed: s, rules, order: players.map((p) => p.id), players: seated,
    questions, round: null, asked: [], endReason: null,
  }, 0, now);
}

/** Is a quiz under way (answers can come in)? @param {Pick<QuizState, 'phase'>} s */
export const quizRunning = (s) => s.phase === 'question' || s.phase === 'reveal';

/** Seated players who can still answer. @param {QuizState} s */
const active = (s) => s.order.filter((id) => !s.players[id].left);

/** Seeded Fisher–Yates. @template T @param {T[]} list @param {() => number} rnd @returns {T[]} */
function shuffle(list, rnd) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The questions a mode can ask. @param {Candidate[]} cs @param {QuizMode} mode */
const askable = (cs, mode) => cs.filter((c) => c && typeof c.id === 'string' && (mode !== 'choice' || c.choices > 0));

/**
 * Speed bonus: the share of the round's time still left when the answer came, × speedMax.
 * @param {number} at @param {number} deadline @param {number} seconds @returns {number}
 */
export function pointsFor(at, deadline, seconds) {
  const left = Math.max(0, Math.min(1, (deadline - at) / (seconds * 1000)));
  return SCORING.right + Math.round(SCORING.speedMax * left);
}

/**
 * Opens round `index` (seeded choice shuffle).
 * @param {QuizState} s @param {number} index @param {number} now @returns {QuizState}
 */
function openRound(s, index, now) {
  const q = s.questions[index];
  const asChoice = s.rules.mode === 'text' ? false : q.choices > 0;
  const rnd = mulberry32(s.seed ^ Math.imul(index + 1, 0x9e3779b1));
  const perm = asChoice ? shuffle(Array.from({ length: q.choices }, (_, i) => i), rnd) : null;
  return {
    ...s, phase: 'question',
    round: { index, questionId: q.id, asChoice, perm, deadline: now + s.rules.seconds * 1000, answers: {}, credited: false },
    asked: s.asked.includes(q.id) ? s.asked : [...s.asked, q.id],
  };
}

/**
 * Adds (sign = 1) or removes (−1) an answer's points and correct count to its player.
 * @param {Record<string, QuizPlayer>} players @param {string} id @param {Answer} a @param {1 | -1} sign
 */
function credit(players, id, a, sign) {
  const p = players[id];
  if (!p) return players;
  return { ...players, [id]: { ...p, score: p.score + sign * a.points, correct: p.correct + sign } };
}

/**
 * Round over → reveal: every answer judged right so far is credited; waiting ones credit when judged.
 * @param {QuizState} s @returns {QuizState}
 */
function reveal(s) {
  const r = /** @type {Round} */ (s.round);
  let players = s.players;
  for (const [id, a] of Object.entries(r.answers)) if (a.ok === true) players = credit(players, id, a, 1);
  return { ...s, phase: 'reveal', players, round: { ...r, credited: true } };
}

/** Answers still waiting for the judge count as wrong (next / endGame / load). @param {Round} r @returns {Round} */
function settlePending(r) {
  /** @type {Record<string, Answer>} */
  const answers = {};
  let changed = false;
  for (const [id, a] of Object.entries(r.answers)) {
    answers[id] = a.ok === null ? (changed = true, { ...a, ok: false }) : a;
  }
  return changed ? { ...r, answers } : r;
}

/**
 * The pending verdicts of a resumed quiz are never re-judged (E1): they become wrong; the host can
 * still override them on the reveal. Same object when nothing was pending.
 * @param {QuizState} s @returns {QuizState}
 */
export function resolvePending(s) {
  if (!s.round) return s;
  const r = settlePending(s.round);
  return r === s.round ? s : { ...s, round: r };
}

/** The party's host, passed in by the campaign. @param {{ hostId: string | null }} ctx @param {string} id */
const isHost = (ctx, id) => ctx.hostId !== null && ctx.hostId === id;

/**
 * @param {QuizState} s
 * @param {QuizAction} a
 * @param {import('../minigames.js').RoundCtx} ctx  the party's host (the host-only actions)
 * @returns {QuizState}  the SAME object when the action is refused
 */
export function reduceQuiz(s, a, ctx) {
  switch (a.t) {
    case 'leave': {
      const p = s.players[a.id];
      if (!p || p.left) return s;
      const next = { ...s, players: { ...s.players, [a.id]: { ...p, left: true } } };
      // the leaver was the last one we were waiting for: the round closes
      return next.phase === 'question' && everyoneAnswered(next) ? reveal(next) : next;
    }

    case 'answer': {
      const r = s.round;
      const p = s.players[a.id];
      if (s.phase !== 'question' || !r || !p || p.left || r.answers[a.id]) return s;
      if (!Number.isFinite(a.now) || a.now > r.deadline) return s;
      if (!['right', 'wrong', 'uncertain'].includes(a.verdict)) return s;
      /** @type {Answer} */
      const base = {
        at: a.now, verdict: a.verdict, ok: a.verdict === 'uncertain' ? null : a.verdict === 'right',
        points: pointsFor(a.now, r.deadline, s.rules.seconds),
      };
      /** @type {Answer} */
      let answer;
      if (r.asChoice) {
        if (!Number.isInteger(a.choice) || /** @type {number} */ (a.choice) < 0 || /** @type {number} */ (a.choice) >= (r.perm?.length ?? 0)) return s;
        answer = { ...base, choice: a.choice };
      } else {
        const text = typeof a.text === 'string' ? a.text.trim().slice(0, MAX_TEXT) : '';
        if (!text) return s;
        answer = { ...base, text };
      }
      const next = { ...s, round: { ...r, answers: { ...r.answers, [a.id]: answer } } };
      return everyoneAnswered(next) ? reveal(next) : next;
    }

    case 'close': {
      if (s.phase !== 'question' || !s.round || a.deadline !== s.round.deadline) return s;
      return reveal(s);
    }

    case 'verdict': {
      const r = s.round;
      const ans = r?.answers[a.target];
      if (!r || !ans || ans.ok !== null || !quizRunning(s)) return s;
      // only for the round it was asked about: a late verdict never lands on the next question's answer
      if (r.index !== a.index || r.questionId !== a.questionId) return s;
      const ok = a.ok === true;
      const answers = { ...r.answers, [a.target]: { ...ans, ok } };
      const players = r.credited && ok ? credit(s.players, a.target, ans, 1) : s.players;
      return { ...s, players, round: { ...r, answers } };
    }

    case 'override': {
      const r = s.round;
      const ans = r?.answers[a.target];
      if (!isHost(ctx, a.id) || s.phase !== 'reveal' || !r || !ans || typeof a.ok !== 'boolean') return s;
      if (ans.ok === a.ok) return s;
      let players = s.players;
      if (ans.ok === true) players = credit(players, a.target, ans, -1);
      if (a.ok) players = credit(players, a.target, ans, 1);
      return { ...s, players, round: { ...r, answers: { ...r.answers, [a.target]: { ...ans, ok: a.ok, overridden: true } } } };
    }

    case 'next': {
      if (!isHost(ctx, a.id) || s.phase !== 'reveal' || !s.round || !Number.isFinite(a.now)) return s;
      const done = { ...s, round: settlePending(s.round) };
      const index = s.round.index + 1;
      return index < s.questions.length ? openRound(done, index, a.now) : { ...done, phase: 'finished', endReason: 'done' };
    }

    case 'endGame': {
      if (!isHost(ctx, a.id) || !quizRunning(s)) return s;
      // a round still open is dropped (nobody is credited for half a question); a reveal keeps its credit
      const round = s.round && s.phase === 'reveal' ? settlePending(s.round) : s.round;
      return { ...s, phase: 'finished', endReason: 'host', round };
    }

    default:
      return s;
  }
}

/** Every seated, present player has answered the current round. @param {QuizState} s */
function everyoneAnswered(s) {
  const r = s.round;
  const here = active(s);
  return !!r && here.length > 0 && here.every((id) => !!r.answers[id]);
}

/**
 * Final standings: the shared ranking (shared/ranking.js), with each player's right answers.
 * @param {QuizState} s @returns {{ id: string, rank: number, score: number, correct: number }[]}
 */
export function quizRanking(s) {
  return ranking(s).map((r) => ({ ...r, correct: s.players[r.id].correct }));
}

/**
 * The quiz's entry in the rules list (shared/minigames.js).
 * @type {import('../minigames.js').MinigameRules<QuizState, QuizAction, QuizSettings>}
 */
export const QUIZ_RULES = {
  init: startQuiz,
  reduce: reduceQuiz,
  status: (s) => (quizRunning(s) ? 'running' : s.phase === 'finished' ? 'finished' : null),
  result: (s, node) => {
    const ranking = quizRanking(s);
    /** @type {Record<string, number>} */
    const counters = {};
    let right = 0;
    for (const r of ranking) {
      const character = s.players[r.id].character;
      if (r.correct > 0) right += r.correct;
      if (r.correct > 0 && character) {
        counters[QUIZ_COUNTER.correctBy(character)] = r.correct;
        counters[QUIZ_COUNTER.nodeCorrectBy(node, character)] = r.correct;
      }
    }
    if (right > 0) counters[QUIZ_COUNTER.nodeCorrect(node)] = right;
    return {
      ranking: ranking.map((r) => ({ character: s.players[r.id].character ?? null, score: r.score, rank: r.rank })),
      endReason: s.endReason, counters, asked: [...s.asked],
    };
  },
  settings: (patch, base = QUIZ_DEFAULTS) => mergeQuizSettings(base, patch),
  validateSettings: validateQuizSettings,
  sampleSettings: { count: 3, seconds: 20, mode: 'mixed' },
  deadline: (s) => (s.phase === 'question' && s.round ? s.round.deadline : null),
  deadlineAction: (deadline) => ({ t: 'close', deadline }),
  shiftDeadline: (s, by) => (s.phase === 'question' && s.round ? { ...s, round: { ...s.round, deadline: s.round.deadline + by } } : s),
  resume: resolvePending, // an answer still waiting for the judge is never re-judged (E1)
  describe: (s) => `quiz ${s.phase}${s.round ? ` q${s.round.index + 1}/${s.questions.length}` : ''}`
    + `${s.order.length ? ` (${s.order.map((id) => `${s.players[id].name} ${s.players[id].score}`).join(', ')})` : ''}`,
};
