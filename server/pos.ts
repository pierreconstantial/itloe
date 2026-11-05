// M3 — avatar positions: ephemeral, client-authoritative, relayed to screens (plus a player's own
// pos right after its welcome). Never enters the reducer State or the save file; reset on restart.
// Walking belongs to the evening: whoever is in the party (and has not left) moves. During a round, `pos`
// belongs to its minigame's game area instead: those positions are the round's own (server/round.ts), apart
// from the room's, which stay where everyone stood.

import { clampToWorld } from '../shared/world.js';
import type { Campaign } from './campaign.ts';

type Party = Campaign['party'];

const DIRS = ['up', 'down', 'left', 'right'] as const;
export type Dir = (typeof DIRS)[number];
export type Pos = { x: number, y: number, dir: Dir, moving: boolean };

const MAX_PER_SECOND = 30;

/** Validated, clamped pos from a wire message, or null when malformed. */
export function parsePos(m: any): Pos | null {
  if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return null;
  if (!DIRS.includes(m.dir) || typeof m.moving !== 'boolean') return null;
  return { ...clampToWorld(m.x, m.y), dir: m.dir, moving: m.moving };
}

/** A player whose avatar may move: in the party and has not left the evening. */
export const canMove = (party: Party, playerId: string): boolean => {
  const p = party.players[playerId];
  return !!p && !p.left;
};

/**
 * Last known position per player, plus a per-sender rate guard (fixed 1 s window, excess dropped).
 * `S` is the socket type; only identity is used.
 */
export function makePositions<S extends object>() {
  const last = new Map<string, Pos>();
  const rate = new WeakMap<S, { since: number, count: number }>();

  return {
    /** False when this sender is over its budget for the current second. */
    allow(sender: S, now = Date.now()): boolean {
      const r = rate.get(sender);
      if (!r || now - r.since >= 1000) { rate.set(sender, { since: now, count: 1 }); return true; }
      return ++r.count <= MAX_PER_SECOND;
    },

    set(playerId: string, pos: Pos): void { last.set(playerId, pos); },

    get(playerId: string): Pos | undefined { return last.get(playerId); },

    /** Change hook: forget players who left the evening. */
    prune(party: Party): void {
      for (const id of last.keys()) if (!canMove(party, id)) last.delete(id);
    },

    entries(): [string, Pos][] { return [...last.entries()]; },

    clear(): void { last.clear(); },
  };
}

export const posMsg = (playerId: string, p: Pos): string => JSON.stringify({ t: 'pos', playerId, ...p });
