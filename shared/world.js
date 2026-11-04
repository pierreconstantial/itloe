// Contract C amendment (M3, 2026-11-04) — the single source of movement geometry:
// the server clamps with it, the phone integrates with it, the TV spawns/interpolates with it.

import { CHARACTERS, ROSTER_SIZE, isCharacterId } from './characters.js';

/**
 * @typedef {import('./characters.js').CharacterId} CharacterId
 * @typedef {'up' | 'down' | 'left' | 'right'} Dir
 * @typedef {{ x: number, y: number, dir: Dir }} Spawn
 */

/** World size in units (16:9). Positions live in x ∈ [0, w], y ∈ [0, h]. */
export const WORLD = Object.freeze({ w: 16, h: 9 });

/** Walking speed, units per second. */
export const WALK_SPEED = 4;

/**
 * The spawn row. y sits below the party room's furniture (its table reaches y = 7.15, see
 * PARTY_ROOM in shared/scene.js) so that no character ever starts inside a prop; the margin keeps
 * the whole row inside that room's walkable floor (x 0.5 … 15.5).
 */
const SPAWN_Y = 7.6;
const SPAWN_MARGIN = 1.5;

/**
 * Deterministic spawn point of a character: the roster is spread evenly along the spawn row, in
 * colour order, each character on the centre of its own band — so the row re-spaces itself when the
 * roster grows instead of running off the end of the world. Anything that is not a known character
 * (pre-M3 players have character null) spawns at the centre of the row, so a client never crashes
 * on old state.
 * @param {CharacterId | null | undefined} characterId
 * @returns {Spawn}
 */
export function spawnPoint(characterId) {
  const slot = isCharacterId(characterId) ? CHARACTERS[characterId].color - 1 : (ROSTER_SIZE - 1) / 2;
  const span = WORLD.w - 2 * SPAWN_MARGIN;
  const x = SPAWN_MARGIN + (span * (slot + 0.5)) / ROSTER_SIZE;
  return { x: Math.round(x * 100) / 100, y: SPAWN_Y, dir: 'down' };
}

/**
 * Clamps a position into the world (helper for the server's clamp and the phone's integration).
 * Non-finite coordinates become the nearest bound's lower edge (0).
 * @param {number} x
 * @param {number} y
 * @returns {{ x: number, y: number }}
 */
export function clampToWorld(x, y) {
  const c = (/** @type {number} */ v, /** @type {number} */ max) => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
  return { x: c(x, WORLD.w), y: c(y, WORLD.h) };
}
