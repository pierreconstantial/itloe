// Avatar movement, integrated on the phone (client-authoritative, see PROTOCOL.md `pos`).
// Pure functions over the shared geometry (shared/world.js): the server clamps with the same
// clampToWorld, and the TV spawns from the same spawnPoint.
//
// Contract G: collision is the phone's job. The server keeps only its world clamp, so the walls and
// props of shared/scene.js are enforced here, on the device that integrates the movement. The TV
// draws what the phone sends. That means a phone could in principle walk through the sofa — it is
// a party game on a LAN, and the alternative (the server re-simulating every step) buys nothing.
import { WALK_SPEED, clampToWorld } from '../../shared/world.js';
import { resolve } from '../../shared/scene.js';

/** @typedef {import('../../shared/world.js').Dir} Dir */
/** @typedef {import('../../shared/scene.js').Scene} Scene */
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
 * One integration step against the scene (screen y grows downwards). The candidate position goes
 * through `resolve`, which clamps it to the world AND slides it along whatever it ran into, so a
 * diagonal push against a wall keeps the component that is free.
 *
 * `moving` is what the stick says, not what the position did: pushing into a wall keeps the walk
 * cycle running on the spot (the Zelda rule — only the position stops). It is also what the TV
 * needs, since `moving` drives the animation there.
 *
 * Called every frame while the stick is held: `resolve` allocates nothing per solid (the scene's
 * collider list is cached on the Scene) and this adds one candidate object on top of the Pos it
 * already returned.
 *
 * @param {Pos} pos @param {number} vx @param {number} vy @param {number} dt seconds
 * @param {Scene} scene the room being walked
 * @returns {Pos}
 */
export function step(pos, vx, vy, dt, scene) {
  const to = { x: pos.x + vx * WALK_SPEED * dt, y: pos.y + vy * WALK_SPEED * dt };
  const at = resolve(scene, pos, to);
  return {
    x: at.x,
    y: at.y,
    dir: facing(vx, vy, pos.dir),
    moving: vx !== 0 || vy !== 0,
  };
}

/** Within this distance of a free spot's centre, a walker snaps onto it… */
export const SNAP_IN = 0.45;
/** …and stays there until the stick has pushed it this far from the centre: further than SNAP_IN, so it never
 *  flickers on and off at the edge. Both are inside a spot, so snapping never changes which spot one is on. */
export const SNAP_OUT = 0.7;

/**
 * Snapping onto a spot's centre on a walkable lobby. `free` is where the stick alone has taken the walker;
 * `snapped` the centre it was held at, or null. A held walker stays at its centre while `free` is within SNAP_OUT
 * of it; otherwise it snaps to the nearest centre within SNAP_IN of `free`, if any.
 * @param {{ x: number, y: number }} free @param {{ x: number, y: number } | null} snapped
 * @param {readonly { x: number, y: number }[]} centres
 * @returns {{ x: number, y: number } | null} the centre it's held at now, or null: it stands at `free`
 */
export function snapTo(free, snapped, centres) {
  const d = (/** @type {{ x: number, y: number }} */ c) => Math.hypot(free.x - c.x, free.y - c.y);
  if (snapped && d(snapped) <= SNAP_OUT) return snapped;
  let best = null;
  for (const c of centres) if (d(c) <= SNAP_IN && (!best || d(c) < d(best))) best = c;
  return best;
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
