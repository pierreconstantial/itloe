// Timed-pause fairness: wall time that passed while the server was not running (killed, laptop
// closed or asleep) must not eat a timed game's clock. Pure: the caller passes the times.

import type { State } from './rules.ts';

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
