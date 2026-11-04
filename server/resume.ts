// Timed-pause fairness: wall time that passed while the server was not running (killed, laptop
// closed or asleep) must not eat a timed game's clock. Pure: the caller passes the times.

import type { State } from './rules.ts';
import type { QuizState } from '../shared/quiz/index.js';

/** Envelope `savedAt` → epoch ms. Current envelopes store a number; older ones an ISO string or nothing. */
export function savedAtMs(savedAt: unknown): number | null {
  if (typeof savedAt === 'number') return Number.isFinite(savedAt) ? savedAt : null;
  if (typeof savedAt === 'string') {
    const ms = Date.parse(savedAt);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * A playing game with a live deadline keeps its REMAINING time: the deadline moves forward by the
 * downtime (now − since). Anything else (no deadline, not playing, unknown or future `since`) is
 * returned unchanged — same object, so callers can test `next === state`.
 */
export function shiftDeadline(state: State, since: number | null, now: number): State {
  const d = state.deadline;
  if (state.phase !== 'playing' || typeof d !== 'number' || since === null) return state;
  const downtime = now - since;
  if (!(downtime > 0)) return state; // clock went backwards or no time passed
  return { ...state, deadline: d + downtime };
}

// ---------- any nested activity (Contract E: the quiz round has a deadline too) ----------

/** The campaign's nested activity: the block game or a quiz. */
export type ActivityState = State | QuizState;

export const isQuiz = (s: ActivityState | null | undefined): s is QuizState => (s as QuizState | null)?.kind === 'quiz';

/** The live deadline of an activity: a timed block game being played, or an open quiz question. */
export function activityDeadline(s: ActivityState | null): number | null {
  if (!s) return null;
  if (isQuiz(s)) return s.phase === 'question' && s.round ? s.round.deadline : null;
  return s.phase === 'playing' && typeof s.deadline === 'number' ? s.deadline : null;
}

/** shiftDeadline for any activity: a quiz question keeps its remaining time too. Same object when unchanged. */
export function shiftActivityDeadline<S extends ActivityState>(s: S, since: number | null, now: number): S {
  if (!isQuiz(s)) return shiftDeadline(s as State, since, now) as S;
  const d = activityDeadline(s);
  if (d === null || since === null || !(now - since > 0)) return s;
  return { ...s, round: { ...s.round!, deadline: d + (now - since) } } as S;
}
