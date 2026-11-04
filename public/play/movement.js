// Avatar movement, integrated on the phone (client-authoritative, see PROTOCOL.md `pos`).
// Pure functions over the shared geometry (shared/world.js): the server clamps with the same
// clampToWorld, and the TV spawns from the same spawnPoint.
import { WALK_SPEED, clampToWorld } from '../../shared/world.js';

/** @typedef {import('../../shared/world.js').Dir} Dir */
/** @typedef {{ x: number, y: number, dir: Dir, moving: boolean }} Pos */

const DEADZONE = 0.15; // fraction of the stick radius that does nothing
/** Keep the current facing until the other axis is clearly dominant (no flicker on diagonals). */
const FACING_HYSTERESIS = 1.2;
const DIRS = ['up', 'down', 'left', 'right'];

/**
 * Stick offset in px → direction vector of length 0..1 (dead zone removed, rescaled).
 * @param {number} dx @param {number} dy @param {number} radius
 * @returns {{ vx: number, vy: number }}
 */
export function stickVector(dx, dy, radius) {
  const len = Math.hypot(dx, dy);
  const raw = Math.min(1, len / radius);
  if (len === 0 || raw < DEADZONE) return { vx: 0, vy: 0 };
  const mag = (raw - DEADZONE) / (1 - DEADZONE);
  return { vx: (dx / len) * mag, vy: (dy / len) * mag };
}

/**
 * 4-direction facing from the dominant axis; unchanged when not moving.
 * @param {number} vx @param {number} vy @param {Dir} prev @returns {Dir}
 */
export function facing(vx, vy, prev) {
  if (vx === 0 && vy === 0) return prev;
  const ax = Math.abs(vx), ay = Math.abs(vy);
  const prevHorizontal = prev === 'left' || prev === 'right';
  const horizontal = prevHorizontal ? ax * FACING_HYSTERESIS >= ay : ax > ay * FACING_HYSTERESIS;
  return horizontal ? (vx > 0 ? 'right' : 'left') : (vy > 0 ? 'down' : 'up');
}

/**
 * One integration step, clamped to the world (screen y grows downwards).
 * @param {Pos} pos @param {number} vx @param {number} vy @param {number} dt seconds
 * @returns {Pos}
 */
export function step(pos, vx, vy, dt) {
  return {
    ...clampToWorld(pos.x + vx * WALK_SPEED * dt, pos.y + vy * WALK_SPEED * dt),
    dir: facing(vx, vy, pos.dir),
    moving: vx !== 0 || vy !== 0,
  };
}

/** Wire form: 2 decimals is far below a visible pixel on the TV. @param {Pos} p @returns {Pos} */
export function roundPos(p) {
  return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, dir: p.dir, moving: p.moving };
}

/** @param {Pos | null} a @param {Pos | null} b */
export function samePos(a, b) {
  return a !== null && b !== null && a.x === b.x && a.y === b.y && a.dir === b.dir && a.moving === b.moving;
}

/**
 * The server's echo of our own last position (`pos` right after welcome), if well-formed.
 * @param {any} m @returns {Pos | null}
 */
export function posFromEcho(m) {
  if (typeof m.x !== 'number' || typeof m.y !== 'number' || !DIRS.includes(m.dir)) return null;
  return { ...clampToWorld(m.x, m.y), dir: m.dir, moving: false };
}
