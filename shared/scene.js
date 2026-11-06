// Contract G (M4) — scene geometry: what is solid, where the floor is, and what sorts in front of
// what. Pure data + math, no pixels and no DOM. The phone imports it to resolve its own movement
// (collision is client-side, see PROTOCOL.md) and the TV imports it to place and sort the props it
// draws. A room is DATA: walls derived from a floor rect, plus props. Adding a room means adding a
// Scene here and one draw function per prop kind on the TV (public/screen/scene-render.js).
//
// Zelda rule kept from M3: a blocked move still counts as walking — the caller keeps `moving: true`
// so the walk cycle animates on the spot; only the position stops.

import { WORLD, clampToWorld, spawnPoint } from './world.js';

/** @typedef {import('./characters.js').CharacterId} CharacterId */
/** @typedef {import('./world.js').Spawn} Spawn */
/** @typedef {{ x: number, y: number, w: number, h: number }} Rect world units, x/y = top-left */
/**
 * back: painted under everything (floor decals) · sorted: depth-sorted with the avatars by baseline
 * · front: always on top (a chandelier, the top of a door frame).
 * @typedef {'back' | 'sorted' | 'front'} Layer
 */
/**
 * @typedef {{
 *   id: string,          // unique within the scene; what drawOrder() reports
 *   kind: string,        // which draw function paints it (defaults to the id)
 *   box: Rect,           // where the art goes, in world units
 *   anchorY: number,     // floor contact line: the baseline it sorts by
 *   solid: Rect | null,  // what stops the feet — the visible base, never the whole sprite
 *   layer: Layer,
 * }} Prop
 */
/** @typedef {{ id: string, floor: Rect, solids: Rect[], props: Prop[] }} Scene */

/**
 * The feet box: the only thing that collides. As wide as the sprite's shoes (a 16 px sprite drawn
 * 1.2 units tall) and shallow, so that two props one unit apart stay walkable and an avatar can
 * stand on a 1.2-deep door rug without its box reaching through the back wall.
 */
export const FEET = Object.freeze({ w: 0.6, h: 0.35 });

/** How far we may slide sideways to round a prop's corner instead of snagging on it (world units). */
const CORNER = 0.24;
const CORNER_STEP = 0.06;

/** The feet box of a position: a pos IS the feet. @param {number} x @param {number} y @returns {Rect} */
export function feetBox(x, y) {
  return { x: x - FEET.w / 2, y: y - FEET.h, w: FEET.w, h: FEET.h };
}

/** Every solid of a scene (walls + the props that have one), built once per scene. @type {WeakMap<Scene, Rect[]>} */
const solidCache = new WeakMap();

/** @param {Scene} scene @returns {Rect[]} */
function solidsOf(scene) {
  let all = solidCache.get(scene);
  if (!all) {
    all = [...scene.solids];
    for (const p of scene.props) if (p.solid) all.push(p.solid);
    solidCache.set(scene, all);
  }
  return all;
}

/** @param {Rect} a @param {Rect} b */
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Does a box overlap any solid of the scene? Touching edges do not count. @param {Scene} scene @param {Rect} box */
export function blocked(scene, box) {
  const all = solidsOf(scene);
  for (let i = 0; i < all.length; i++) if (hit(box, all[i])) return true;
  return false;
}

/** blocked(scene, feetBox(x, y)) without allocating — this runs several times per frame on a phone. */
/** @param {Scene} scene @param {number} x @param {number} y */
function blockedAt(scene, x, y) {
  const x0 = x - FEET.w / 2, x1 = x0 + FEET.w, y0 = y - FEET.h, y1 = y;
  const all = solidsOf(scene);
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    if (x0 < s.x + s.w && x1 > s.x && y0 < s.y + s.h && y1 > s.y) return true;
  }
  return false;
}

/** Can an avatar stand here: feet inside the world and clear of every solid. @param {Scene} scene @param {number} x @param {number} y */
export function isWalkable(scene, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x - FEET.w / 2 < 0 || x + FEET.w / 2 > WORLD.w || y - FEET.h < 0 || y > WORLD.h) return false;
  return !blockedAt(scene, x, y);
}

/**
 * One move against the scene, axis by axis: take the x component alone, then the y component alone,
 * dropping whichever one would end inside a solid. That is what makes a diagonal push slide along a
 * wall instead of sticking to it. A move that is blocked on both axes gets one chance to round the
 * corner it snagged on: up to CORNER sideways, perpendicular to the dominant axis.
 *
 * The move is swept in sub-steps no longer than half a feet box, so a long step (a stalled tab
 * catching up, a teleport) stops AT the sofa instead of tunnelling through it.
 *
 * Starting inside a solid (a spawn that predates a prop, or the server's echo of an old position)
 * lets the move through untouched — otherwise every direction is blocked and the avatar is stuck
 * there for good.
 *
 * @param {Scene} scene @param {{ x: number, y: number }} from @param {{ x: number, y: number }} to
 * @returns {{ x: number, y: number }}
 */
export function resolve(scene, from, to) {
  const fx = Number.isFinite(from.x) ? from.x : 0, fy = Number.isFinite(from.y) ? from.y : 0;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return { x: fx, y: fy };
  const t = clampToWorld(to.x, to.y);
  if (blockedAt(scene, fx, fy)) return t;
  const dx = t.x - fx, dy = t.y - fy;
  if (dx === 0 && dy === 0) return { x: fx, y: fy };
  const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / SWEEP)));
  let x = fx, y = fy;
  for (let i = 1; i <= n; i++) {
    const nx = fx + (dx * i) / n, ny = fy + (dy * i) / n;
    const sx = x, sy = y;
    if (nx !== x && !blockedAt(scene, nx, y)) x = nx;
    if (ny !== y && !blockedAt(scene, x, ny)) y = ny;
    if (x === sx && y === sy) {
      const c = roundCorner(scene, sx, sy, nx, ny, dx, dy);
      if (!c) break;            // genuinely against a wall: stop here, the caller keeps walking on the spot
      x = c.x; y = c.y;
    }
  }
  return { x, y };
}

/** Max length of one swept sub-step and the ceiling on how many we take for a single move. */
const SWEEP = FEET.w / 2;
const MAX_SUBSTEPS = 64;

/**
 * A sub-step blocked on both axes: try to slip up to CORNER sideways, perpendicular to the push,
 * so a prop's corner does not snag someone walking past it. Null when there is no way round.
 * @param {Scene} scene @param {number} x @param {number} y @param {number} nx @param {number} ny
 * @param {number} dx @param {number} dy
 * @returns {{ x: number, y: number } | null}
 */
function roundCorner(scene, x, y, nx, ny, dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) {
    for (let k = CORNER_STEP; k <= CORNER + 1e-9; k += CORNER_STEP) {
      if (isWalkable(scene, nx, y - k)) return { x: nx, y: y - k };
      if (isWalkable(scene, nx, y + k)) return { x: nx, y: y + k };
    }
  } else {
    for (let k = CORNER_STEP; k <= CORNER + 1e-9; k += CORNER_STEP) {
      if (isWalkable(scene, x - k, ny)) return { x: x - k, y: ny };
      if (isWalkable(scene, x + k, ny)) return { x: x + k, y: ny };
    }
  }
  return null;
}

// ---- building a room -----------------------------------------------------------------

/**
 * The four walls around a floor rect, as solids: they keep the feet box inside `floor`, so a scene
 * never needs to special-case the world edges — sliding along the world's edge is the same code as
 * sliding along a sofa.
 * @param {Rect} floor @returns {Rect[]}
 */
export function wallsAround(floor) {
  const hw = FEET.w / 2;
  return [
    { x: 0, y: 0, w: WORLD.w, h: Math.max(0, floor.y - FEET.h) },    // back wall
    { x: 0, y: 0, w: Math.max(0, floor.x - hw), h: WORLD.h },        // left
    { x: floor.x + floor.w + hw, y: 0, w: WORLD.w, h: WORLD.h },     // right
    { x: 0, y: floor.y + floor.h, w: WORLD.w, h: WORLD.h },          // front
  ];
}

/**
 * One prop. `box` is where the art goes; `anchorY` defaults to the box's bottom edge (its floor
 * contact) and `solid` to nothing — a prop is only solid if you say so, and its solid should match
 * the base you can bump into, not the whole sprite.
 * @param {string} id @param {Rect} box
 * @param {{ kind?: string, anchorY?: number, solid?: Rect | null, layer?: Layer }} [opts]
 * @returns {Prop}
 */
export function prop(id, box, opts = {}) {
  return {
    id,
    kind: opts.kind ?? id,
    box: { ...box },
    anchorY: opts.anchorY ?? box.y + box.h,
    solid: opts.solid ? { ...opts.solid } : null,
    layer: opts.layer ?? 'sorted',
  };
}

/**
 * A room: its walkable floor rect (walls are derived from it), its props, and any extra solid that
 * is not a prop.
 * @param {string} id @param {Rect} floor @param {Prop[]} props @param {Rect[]} [extraSolids]
 * @returns {Scene}
 */
export function room(id, floor, props, extraSolids = []) {
  return { id, floor: { ...floor }, solids: [...wallsAround(floor), ...extraSolids], props: [...props] };
}

/**
 * Where a character starts in a scene: the shared spawn point, nudged onto walkable floor if a prop
 * (or a later room) stands on it. Searches outwards, preferring the open floor towards the camera,
 * and rounds to the wire's 2 decimals.
 * @param {Scene} scene @param {CharacterId} characterId
 * @returns {Spawn}
 */
export function spawnAt(scene, characterId) {
  const s = spawnPoint(characterId);
  if (isWalkable(scene, s.x, s.y)) return s;
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  for (let r = 0.25; r <= 4; r += 0.25) {
    for (const [dx, dy] of NUDGES) {
      const x = s.x + dx * r, y = s.y + dy * r;
      if (isWalkable(scene, x, y)) return { x: r2(x), y: r2(y), dir: s.dir };
    }
  }
  return s;
}

/** Nudge directions, in preference order: towards the camera first, then sideways, then back. */
const NUDGES = /** @type {const} */ ([[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1]]);

// ---- the hub: the party room ---------------------------------------------------------
// The floor starts under the skirting board (the wall is painted down to y = 4.6) and stops short of
// the bottom edge so a name label still fits under the lowest avatar. Props keep clear of the
// campaign door rugs (y 4.7 … 5.9, see shared/campaign/sample.js) and of every spawn point, so
// walking into a door is never blocked and nobody starts inside the furniture.

/** @type {Rect} */
const PARTY_FLOOR = { x: 0.5, y: 4.8, w: 15, h: 4 };

// `box` is the art's footprint — grid columns × 1/13.33 of a unit, since one art pixel is 1.2/16 of
// the avatar's height. `solid` is only the base you bump into, so you can stand close enough to a
// prop for it to overlap your head.
export const PARTY_ROOM = room('party-room', PARTY_FLOOR, [
  // velvet two-seater under the window, back-left corner, left of the leftmost door rug
  prop('sofa', { x: 0.46, y: 4.65, w: 1.73, h: 1.2 }, { anchorY: 5.85, solid: { x: 0.5, y: 4.8, w: 1.65, h: 1.05 } }),
  // the birthday table, in the open right half: walk behind it (it hides your legs) or in front of it
  prop('table', { x: 10.09, y: 6.03, w: 2.03, h: 1.12 }, { anchorY: 7.15, solid: { x: 10.3, y: 6.4, w: 1.7, h: 0.75 } }),
  // a tall plant in the back-right corner, past the last door rug: it hides whoever stands behind it
  prop('plant', { x: 14.81, y: 4, w: 0.98, h: 1.5 }, { anchorY: 5.5, solid: { x: 14.95, y: 4.95, w: 0.65, h: 0.55 } }),
]);

/** Élodie’s dream apartment uses the same movement engine but has its own furniture and collision map. */
export const APARTMENT_ROOM = room('apartment-room', PARTY_FLOOR, [
  prop('sofa', { x: 0.1, y: 4.2, w: 2.1, h: 1.7 }, { anchorY: 5.9, solid: { x: 0.5, y: 4.85, w: 1.7, h: 1.05 } }),
  prop('plant', { x: 1.55, y: 3, w: 1.05, h: 1.9 }, { anchorY: 4.9, solid: { x: 1.85, y: 4.75, w: 0.55, h: 0.4 } }),
], [
  { x: 2.35, y: 4.9, w: 0.95, h: 0.6 }, // armchair
  { x: 5.5, y: 4.85, w: 1.1, h: 0.55 }, // bookshelf
  { x: 12.35, y: 4.75, w: 2.8, h: 1.1 }, // terrace table and chairs
]);

/** Young Adult backgrounds use their visible furniture as movement obstacles. */
export const TRAM_5_ROOM = room('young-adult/tram-5', { x: 0.5, y: 5.6, w: 15, h: 3.2 }, []);
export const SHELTER_ROOM = room('young-adult/shelter', { x: 0.5, y: 4.4, w: 15, h: 4.4 }, [], [
  { x: 7.1, y: 4.5, w: 2.5, h: 1.2 }, // foosball
  { x: 10.5, y: 4.1, w: 4.8, h: 1.2 }, // bar and pinball machine
  { x: 3.1, y: 6, w: 1.2, h: 0.65 },
  { x: 9, y: 6.1, w: 1.3, h: 0.65 }, // the two central tables
]);
export const APPART_ELO_1_ROOM = room('young-adult/appart-elo-1', { x: 0.5, y: 5.3, w: 15, h: 3.5 }, [], [
  { x: 5.25, y: 5.15, w: 4.6, h: 1.05 }, // mattress
  { x: 9.9, y: 5.1, w: 1.55, h: 0.9 }, // television
]);
export const APPART_PIERRE_ROOM = room('young-adult/appart-pierre', { x: 0.5, y: 5.05, w: 15, h: 3.75 }, [], [
  { x: 1.8, y: 5.05, w: 2.1, h: 1.2 }, // sofa
  { x: 4.2, y: 5.55, w: 2.9, h: 0.55 }, // coffee table; the floor in front stays clear
  { x: 7.65, y: 5.3, w: 1.2, h: 1.05 }, // armchair
  { x: 13.9, y: 4.9, w: 1.4, h: 0.75 }, // tiled stove
]);

/** Every room by its id, which a content node names as its `room` (roomAt in shared/campaign/content.js). */
export const ROOMS = Object.freeze(Object.fromEntries([
  PARTY_ROOM, APARTMENT_ROOM, TRAM_5_ROOM, SHELTER_ROOM, APPART_ELO_1_ROOM, APPART_PIERRE_ROOM,
].map((r) => [r.id, r])));
