// Quiz activity (Contract E + addendum E1): a pure state machine, nested in the campaign like the
// block game. Pure JSDoc ESM, no I/O, no clock, no randomness outside the seed.
//
// The reducer NEVER sees the bank or an answer: the server judges each answer as it arrives and
// injects the verdict (choice → index compare, text → judge-local, 'uncertain' → a later `verdict`).
// Phases: lobby → question → reveal → question → … → finished.
//
// Actions (ids, now, deadline, candidates and verdicts are injected by the server, never from the wire):
//   join { id, character } · leave { id } · config { id, patch }       (lobby; config also on finished)
//   start { id, now, candidates }   host: lobby/finished → question 1 (seeded pick among candidates)
//   answer { id, choice | text, now, verdict }   once per round, before the deadline
//   close { deadline }              server: the round's timer rang (stale deadlines are ignored)
//   verdict { target, ok }          server: the async judge decided an 'uncertain' answer (null = wrong)
//   override { id, target, ok }     host, on the reveal: fixes any answer, both ways, re-scoring it
//   next { id, now }                host: reveal → next question, or finished after the last
//   endGame { id }                  host: question/reveal → finished
//   newGame { id }                  host: finished → lobby (same players minus left, scores reset)
// The last answer of a round closes it at once (no waiting for the timer when everyone answered).

import { CHARACTERS, isCharacterId } from '../characters.js';
import { mulberry32 } from '../rng.js';

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
 *   phase: 'lobby' | 'question' | 'reveal' | 'finished',
 *   seed: number,
 *   settings: QuizSettings,
 *   rules: QuizSettings,          // settings locked at start
 *   order: string[],
 *   players: Record<string, QuizPlayer>,
 *   hostId: string | null,
 *   questions: Candidate[],       // picked at start, in play order
 *   round: Round | null,
 *   asked: string[],              // ids of the questions actually shown (reported to the campaign)
 *   endReason: 'done' | 'host' | null,
 * }} QuizState
 */
/**
 * @typedef {{ t: 'join', id: string, character: CharacterId }
 *   | { t: 'leave', id: string }
 *   | { t: 'config', id: string, patch: Partial<QuizSettings> }
 *   | { t: 'start', id: string, now: number, candidates: Candidate[] }
 *   | { t: 'answer', id: string, choice?: number, text?: string, now: number, verdict: Verdict }
 *   | { t: 'close', deadline: number }
 *   | { t: 'verdict', target: string, ok: boolean | null }
 *   | { t: 'override', id: string, target: string, ok: boolean }
 *   | { t: 'next', id: string, now: number }
 *   | { t: 'endGame', id: string }
 *   | { t: 'newGame', id: string }} QuizAction
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

/** Longest typed answer kept (anything longer is cut). */
export const MAX_TEXT = 120;

const LEVELS = [1, 2, 3];

/** @param {number} s */
const nextSeed = (s) => (Math.imul(s >>> 0, 1103515245) + 12345) >>> 0;

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
 * A fresh quiz in its lobby.
 * @param {number} seed @param {Partial<QuizSettings>} [settings] @returns {QuizState}
 */
export function initQuiz(seed, settings) {
  const s = mergeQuizSettings(QUIZ_DEFAULTS, settings);
  return {
    kind: 'quiz', phase: 'lobby', seed: seed >>> 0, settings: s, rules: s,
    order: [], players: {}, hostId: null, questions: [], round: null, asked: [], endReason: null,
  };
}

/** Is a quiz under way (answers can come in)? @param {QuizState} s */
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

/** @param {QuizState} s @param {string} id */
const isHost = (s, id) => s.hostId !== null && s.hostId === id;

/** @param {Record<string, QuizPlayer>} players @param {string[]} order @param {string} goneId */
const nextHost = (players, order, goneId) => order.find((id) => id !== goneId && !players[id].left) ?? null;

/**
 * @param {QuizState} s
 * @param {QuizAction} a
 * @returns {QuizState}  the SAME object when the action is refused
 */
export function reduceQuiz(s, a) {
  switch (a.t) {
    case 'join': {
      if (s.phase !== 'lobby' || s.players[a.id] || !isCharacterId(a.character)) return s;
      if (s.order.some((id) => s.players[id].character === a.character)) return s;
      const { name, color } = CHARACTERS[a.character];
      return {
        ...s, order: [...s.order, a.id], hostId: s.hostId ?? a.id,
        players: { ...s.players, [a.id]: { id: a.id, character: a.character, name, color, score: 0, correct: 0, left: false } },
      };
    }

    case 'leave': {
      const p = s.players[a.id];
      if (!p || p.left) return s;
      const hostId = s.hostId === a.id ? nextHost(s.players, s.order, a.id) : s.hostId;
      if (s.phase === 'lobby') {
        const { [a.id]: _gone, ...players } = s.players;
        return { ...s, hostId, order: s.order.filter((id) => id !== a.id), players };
      }
      const next = { ...s, hostId, players: { ...s.players, [a.id]: { ...p, left: true } } };
      // the leaver was the last one we were waiting for: the round closes
      return next.phase === 'question' && everyoneAnswered(next) ? reveal(next) : next;
    }

    case 'config': {
      if (!isHost(s, a.id) || quizRunning(s)) return s;
      const settings = mergeQuizSettings(s.settings, a.patch);
      return JSON.stringify(settings) === JSON.stringify(s.settings) ? s : { ...s, settings };
    }

    case 'start': {
      if (!isHost(s, a.id) || (s.phase !== 'lobby' && s.phase !== 'finished') || !Number.isFinite(a.now)) return s;
      if (active(s).length === 0 || !Array.isArray(a.candidates)) return s;
      const rules = s.settings;
      const pool = askable(a.candidates, rules.mode);
      if (pool.length === 0) return s; // nothing left to ask
      const seed = nextSeed(s.seed);
      const questions = shuffle(pool, mulberry32(seed)).slice(0, rules.count);
      /** @type {Record<string, QuizPlayer>} */
      const players = {};
      for (const id of s.order) players[id] = { ...s.players[id], score: 0, correct: 0 };
      return openRound({ ...s, seed, rules, players, questions, endReason: null }, 0, a.now);
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
      const ok = a.ok === true;
      const answers = { ...r.answers, [a.target]: { ...ans, ok } };
      const players = r.credited && ok ? credit(s.players, a.target, ans, 1) : s.players;
      return { ...s, players, round: { ...r, answers } };
    }

    case 'override': {
      const r = s.round;
      const ans = r?.answers[a.target];
      if (!isHost(s, a.id) || s.phase !== 'reveal' || !r || !ans || typeof a.ok !== 'boolean') return s;
      if (ans.ok === a.ok) return s;
      let players = s.players;
      if (ans.ok === true) players = credit(players, a.target, ans, -1);
      if (a.ok) players = credit(players, a.target, ans, 1);
      return { ...s, players, round: { ...r, answers: { ...r.answers, [a.target]: { ...ans, ok: a.ok, overridden: true } } } };
    }

    case 'next': {
      if (!isHost(s, a.id) || s.phase !== 'reveal' || !s.round || !Number.isFinite(a.now)) return s;
      const done = { ...s, round: settlePending(s.round) };
      const index = s.round.index + 1;
      return index < s.questions.length ? openRound(done, index, a.now) : { ...done, phase: 'finished', endReason: 'done' };
    }

    case 'endGame': {
      if (!isHost(s, a.id) || !quizRunning(s)) return s;
      // a round still open is dropped (nobody is credited for half a question); a reveal keeps its credit
      const round = s.round && s.phase === 'reveal' ? settlePending(s.round) : s.round;
      return { ...s, phase: 'finished', endReason: 'host', round };
    }

    case 'newGame': {
      if (!isHost(s, a.id) || s.phase !== 'finished') return s;
      const order = s.order.filter((id) => !s.players[id].left);
      /** @type {Record<string, QuizPlayer>} */
      const players = {};
      for (const id of order) players[id] = { ...s.players[id], score: 0, correct: 0 };
      const hostId = s.hostId !== null && order.includes(s.hostId) ? s.hostId : (order[0] ?? null);
      return { ...s, phase: 'lobby', seed: nextSeed(s.seed), order, players, hostId, questions: [], round: null, endReason: null };
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
 * Final standings: score desc (ties share a rank), seat order breaks display ties.
 * @param {QuizState} s @returns {{ id: string, rank: number, score: number, correct: number }[]}
 */
export function quizRanking(s) {
  const ordered = [...s.order].sort((a, b) => s.players[b].score - s.players[a].score || s.order.indexOf(a) - s.order.indexOf(b));
  let prevScore = NaN, prevRank = 0;
  return ordered.map((id, i) => {
    const { score, correct } = s.players[id];
    const rank = score === prevScore ? prevRank : i + 1;
    prevScore = score;
    prevRank = rank;
    return { id, rank, score, correct };
  });
}
