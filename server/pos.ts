// M3 — avatar positions: ephemeral, client-authoritative, relayed to screens (plus a player's own
// pos right after its welcome). Never enters the reducer State or the save file; reset on restart.

import { clampToWorld } from '../shared/world.js';
import type { State } from './rules.ts';

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

/** A player whose avatar may move: still in the game and has not left it. */
export const canMove = (s: State, playerId: string): boolean => {
  const p = s.players[playerId];
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

    /** Change hook: forget players who were removed or left. */
    prune(s: State): void {
      for (const id of last.keys()) if (!canMove(s, id)) last.delete(id);
    },

    entries(): [string, Pos][] { return [...last.entries()]; },
  };
}

export const posMsg = (playerId: string, p: Pos): string => JSON.stringify({ t: 'pos', playerId, ...p });
