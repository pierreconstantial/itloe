// Contract G (M4) — the TV's little scene engine. Three jobs, none of them room-specific:
//   · a View: world units → screen px, with the art-pixel grid the whole TV draws on
//   · a draw list: back props, then the 'sorted' props AND the actors interleaved by baseline Y
//     (stable tie-break on id), then front props — this is what puts an avatar behind a table
//   · a fixed-timestep loop: update() at a steady rate, draw(alpha) interpolating between the last
//     two updates, so easing stays smooth on a TV that misses frames.
//
// It knows nothing about any particular room. A room = scene data (shared/scene.js) + a PropArt
// registry: { [prop.kind]: (ctx, prop, view) => void }. Nothing here may ever name a room.

/** @typedef {import('../../shared/scene.js').Scene} Scene */
/** @typedef {import('../../shared/scene.js').Prop} Prop */
/** @typedef {import('../../shared/scene.js').Rect} Rect */
/** Anything that walks on the floor and sorts with the props: `y` is its feet. @typedef {{ id: string, y: number }} Actor */
/** @typedef {{ unit: number, ox: number, oy: number, scale: number, w: number, h: number, dpr: number }} View */
/** @typedef {(ctx: CanvasRenderingContext2D, prop: Prop, view: View) => void} DrawProp */
/** @typedef {Record<string, DrawProp>} PropArt */
/** One entry of the draw list. @typedef {{ id: string, y: number, rank: number, seq: number, prop: Prop | null, actor: Actor | null }} Item */

/**
 * Letterboxed projection of a `world` (units) into a `w × h` CSS-pixel canvas, plus the art-pixel
 * size: every sprite and every prop snaps to that grid, which is what keeps the pixel art crisp.
 * @param {number} w @param {number} h @param {number} dpr
 * @param {{ w: number, h: number }} world
 * @param {number} spriteUnits height of a 16 px sprite in world units
 * @param {number} spritePx the sprite's pixel size (16)
 * @returns {View}
 */
export function makeView(w, h, dpr, world, spriteUnits, spritePx) {
  const unit = Math.min(w / world.w, h / world.h);
  return {
    unit, w, h, dpr,
    ox: (w - unit * world.w) / 2,
    oy: (h - unit * world.h) / 2,
    scale: Math.max(1, Math.round((spriteUnits * unit) / spritePx)),
  };
}

/** World x → CSS px. @param {View} v @param {number} u */
export const sx = (v, u) => v.ox + u * v.unit;
/** World y → CSS px. @param {View} v @param {number} u */
export const sy = (v, u) => v.oy + u * v.unit;
/** World x → CSS px, snapped to the art-pixel grid. @param {View} v @param {number} u */
export const px = (v, u) => Math.round((v.ox + u * v.unit) / v.scale) * v.scale;
/** World y → CSS px, snapped to the art-pixel grid. @param {View} v @param {number} u */
export const py = (v, u) => Math.round((v.oy + u * v.unit) / v.scale) * v.scale;

/** A prop's box in snapped screen px: what a draw function paints into. @param {View} v @param {Rect} box */
export function boxOf(v, box) {
  const x = px(v, box.x), y = py(v, box.y);
  return { x, y, w: px(v, box.x + box.w) - x, h: py(v, box.y + box.h) - y };
}

const RANK = { back: 0, sorted: 1, front: 2 };

/**
 * The scene's props and the actors, in paint order: back props (declaration order), then everything
 * on the sorted layer by baseline Y with the id as tie-break (so equal baselines never flicker),
 * then front props (declaration order).
 *
 * `out` is reused between frames — entries are objects kept in place, so a steady room allocates
 * nothing per frame. The returned array IS `out`; don't hold on to it across frames.
 *
 * @param {Scene} scene @param {Iterable<Actor>} actors @param {Item[]} [out]
 * @returns {Item[]}
 */
export function buildDrawList(scene, actors, out = []) {
  let n = 0;
  /** @param {string} id @param {number} y @param {number} rank @param {Prop | null} prop @param {Actor | null} actor */
  const push = (id, y, rank, prop, actor) => {
    const e = out[n] ?? (out[n] = { id: '', y: 0, rank: 1, seq: 0, prop: null, actor: null });
    e.id = id; e.y = y; e.rank = rank; e.seq = n; e.prop = prop; e.actor = actor;
    n++;
  };
  for (const p of scene.props) push(p.id, p.anchorY, RANK[p.layer] ?? 1, p, null);
  for (const a of actors) push(a.id, a.y, RANK.sorted, null, a);
  out.length = n;
  out.sort(cmp);
  return out;
}

/** @param {Item} a @param {Item} b */
function cmp(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.rank !== RANK.sorted) return a.seq - b.seq;          // back / front keep declaration order
  if (a.y !== b.y) return a.y - b.y;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;             // stable: same baseline → by id
}

/**
 * The ids of buildDrawList, back to front. The TV exposes this for the e2e: an avatar id appearing
 * before a prop id means the prop is drawn over it.
 * @param {Scene} scene @param {Iterable<Actor>} actors @returns {string[]}
 */
export function drawOrder(scene, actors) {
  return buildDrawList(scene, actors).map((e) => e.id);
}

/**
 * Paints one frame of a scene: every prop through its own art function, every actor through
 * `drawActor`. A prop kind with no art is skipped (a room can declare a collider before it has a
 * sprite).
 * @param {CanvasRenderingContext2D} ctx @param {Scene} scene @param {Iterable<Actor>} actors
 * @param {PropArt} art
 * @param {(ctx: CanvasRenderingContext2D, actor: any, view: View) => void} drawActor
 * @param {View} view @param {Item[]} [out] reusable scratch list
 */
export function renderScene(ctx, scene, actors, art, drawActor, view, out) {
  const list = buildDrawList(scene, actors, out);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.prop) art[e.prop.kind]?.(ctx, e.prop, view);
    else if (e.actor) drawActor(ctx, e.actor, view);
  }
}

// ---- the loop ------------------------------------------------------------------------

const MAX_FRAME = 0.25; // s of real time a single frame may advance (a tab that was asleep)
const MAX_STEPS = 8;    // fixed steps per frame before we give up catching up

/**
 * Fixed-timestep loop: `update(dt)` always sees the same dt, `draw(alpha, now)` gets how far the
 * frame sits between the last two updates (0 … 1) so motion interpolates instead of stuttering.
 * @param {(dt: number) => void} update
 * @param {(alpha: number, now: number) => void} draw
 * @param {number} [hz]
 */
export function createLoop(update, draw, hz = 60) {
  const fixed = 1 / hz;
  let raf = 0, last = 0, acc = 0;
  /** @param {number} now */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    acc += Math.min(MAX_FRAME, (now - (last || now)) / 1000);
    last = now;
    let steps = 0;
    while (acc >= fixed && steps < MAX_STEPS) { update(fixed); acc -= fixed; steps++; }
    if (steps === MAX_STEPS) acc = 0; // too far behind: drop the backlog rather than spiral
    draw(acc / fixed, now);
  }
  return {
    start() {
      if (raf) return;
      last = 0; acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    running: () => raf !== 0,
    hz,
  };
}

/** @param {number} a @param {number} b @param {number} t */
export const lerp = (a, b, t) => a + (b - a) * t;
