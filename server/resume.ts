// Timed-pause fairness: wall time that passed while the server was not running (killed, laptop
// closed or asleep) must not eat a round's clock. Pure: the caller passes the times.

import { minigame } from '../shared/minigames.js';
import type { Campaign } from './campaign.ts';

/** Envelope `savedAt` → epoch ms. Current envelopes store a number; older ones an ISO string or nothing. */
export function savedAtMs(savedAt: unknown): number | null {
  if (typeof savedAt === 'number') return Number.isFinite(savedAt) ? savedAt : null;
  if (typeof savedAt === 'string') {
    const ms = Date.parse(savedAt);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** The round's live deadline (a timed block game being played, an open quiz question), or null. */
export function roundDeadline(at: Campaign['at']): number | null {
  const rules = minigame(at.kind);
  return rules && at.activity ? rules.deadline(at.activity) : null;
}

/**
 * A round with a live deadline keeps its REMAINING time: the deadline moves forward by the downtime
 * (now − since). Anything else (no live deadline, unknown or future `since`) is returned unchanged —
 * same object, so callers can test `next === c`.
 */
export function shiftRound(c: Campaign, since: number | null, now: number): Campaign {
  const rules = minigame(c.at.kind);
  const s = c.at.activity;
  const downtime = since === null ? 0 : now - since;
  if (!rules || !s || !(downtime > 0)) return c; // clock went backwards or no time passed
  const next = rules.shiftDeadline(s, downtime);
  return next === s ? c : { ...c, at: { ...c.at, activity: next } };
}
