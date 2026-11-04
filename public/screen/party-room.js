// M3 party room: the lobby scene with every joined guest's avatar walking on the TV.
// Positions are EPHEMERAL (`pos` messages, see PROTOCOL.md); the joined players come from the
// last `view`. A pos (x, y) is the avatar's feet, in world units (WORLD = 16 × 9).
// Two fixed canvases: #party-bg (scene, under the lobby UI) and #party-fg (avatars, above it).

import { drawSprite, SPRITE_SIZE, WALK_FRAMES, WALK_FPS } from '../../shared/sprites.js';
import { WORLD, spawnPoint } from '../../shared/world.js';
import { CHARACTERS } from '../../shared/characters.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/world.js').Dir} Dir */
/** @typedef {{ playerId: string, x: number, y: number, dir: Dir, moving: boolean }} PosMsg */
/**
 * @typedef {{
 *   id: string, name: string, color: number, character: string,
 *   x: number, y: number,      // drawn position (eased towards the target)
 *   tx: number, ty: number,    // last reported position
 *   dir: Dir, moving: boolean, lastPosAt: number,
 * }} Avatar
 */

const AVATAR_UNITS = 1.2;   // avatar height in world units
const OFFLINE_ALPHA = 0.4;  // a dropped player's avatar fades (presence.js decides when)
const STALE_MS = 400;       // no update for this long → idle frame
const EASE_PER_S = 14;      // interpolation speed (higher = snappier)
const ARRIVED = 0.04;       // units: closer than this counts as standing still
const DIRS = new Set(['up', 'down', 'left', 'right']);
const FALLBACK_CHARACTERS = Object.keys(CHARACTERS); // by colour, for players without a character

/** Scene layout in world units (16 × 9). The lobby panels (screen-main.css) fill the wall between window and door. */
const SCENE = {
  floorTop: 4.6,
  cornice: 0.22,
  sill: 0.75,                         // window sill / chair rail height above the floor
  window: { x0: 0.35, x1: 1.85, top: 0.75 },
  door: { x0: 14.05, x1: 15.65, top: 1.0 },
  chandelier: { x: 8, y: 0.66 },
  balloons: [
    { x: 0.55, y: 6.7, color: '#ff5fa2' }, { x: 1.15, y: 7.1, color: '#ffd23f' },
    { x: 15.45, y: 6.7, color: '#3b8ea5' }, { x: 14.85, y: 7.1, color: '#9b5de5' },
  ],
};
const PAL = {
  wall: '#e4d6bb', wallHigh: '#dccdae', wallShade: '#bfae8c',
  stucco: '#f6f0e3', stuccoShade: '#d8ccb4',
  frame: '#f4efe4', reveal: '#b9a682',
  door: '#efe9dc', doorLine: '#cfc5b2', doorHigh: '#fbf8f1',
  brass: '#d4a640', brassDark: '#8a6a2a', candle: '#fff3d6', flame: '#ffcf5a', crystal: '#e9f6ff',
  roofs: '#2a2238', star: '#fff6c8', cord: '#efe6d2',
  plankGap: '#7a5030', floorShade: '#4a2e1a', buntingCord: '#7d6a55',
};
const PLANKS = ['#a8733f', '#a06d3b', '#ad7843', '#9d6a39'];
const SKY = ['#1f2a55', '#2f3570', '#53407e', '#8a4f84', '#c86a6e', '#f09a5c']; // dusk, top → horizon
const FLAGS = ['#e4572e', '#3b8ea5', '#f3a712', '#9b5de5', '#ff5fa2'];
const PLANK_W = 3; // art pixels across a plank
const PLANK_N = 4; // plank length in plank widths

/** @param {number} v @param {number} p */
const snap = (v, p) => Math.round(v / p) * p;

/** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} w @param {number} h @param {string} color */
function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

/**
 * Colour of one art pixel of the herringbone floor. Cells are PLANK_W art pixels square; a strand of
 * planks runs along the diagonal: d = (cx − cy) mod 2N picks a horizontal plank (d < N, one per row)
 * or a vertical one (d ≥ N, one per column). Each plank draws its top and left edge as a gap line.
 * @param {number} ax @param {number} ay art-pixel coordinates from the floor's top-left
 */
export function parquetColor(ax, ay) {
  const N = PLANK_N;
  const cx = Math.floor(ax / PLANK_W), cy = Math.floor(ay / PLANK_W);
  const ox = ax - cx * PLANK_W, oy = ay - cy * PLANK_W;
  const diag = cx - cy;
  const d = ((diag % (2 * N)) + 2 * N) % (2 * N);
  const strand = Math.floor(diag / (2 * N));
  const horizontal = d < N;
  const edge = horizontal ? oy === 0 || (d === 0 && ox === 0) : ox === 0 || (d === 2 * N - 1 && oy === 0);
  if (edge) return PAL.plankGap;
  const id = horizontal ? cy * 7 + strand * 13 : cx * 11 + strand * 5 + 3;
  return PLANKS[((id % PLANKS.length) + PLANKS.length) % PLANKS.length];
}

/** @param {HTMLCanvasElement} bg @param {HTMLCanvasElement} fg */
export function createPartyRoom(bg, fg) {
  const bgCtx = /** @type {CanvasRenderingContext2D} */ (bg.getContext('2d'));
  const fgCtx = /** @type {CanvasRenderingContext2D} */ (fg.getContext('2d'));

  /** @type {Map<string, Avatar>} */
  const avatars = new Map();
  /** Last pos per player, kept even before the player shows up in a view. @type {Map<string, PosMsg & { at: number }>} */
  const lastPos = new Map();
  let geo = { unit: 1, ox: 0, oy: 0, scale: 1, w: 0, h: 0, dpr: 1 };
  let raf = 0;
  let lastFrame = 0;
  let visible = false;

  // ---- geometry ----

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = innerWidth, h = innerHeight;
    for (const c of [bg, fg]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const unit = Math.min(w / WORLD.w, h / WORLD.h);
    geo = {
      unit, dpr, w, h,
      ox: (w - unit * WORLD.w) / 2,
      oy: (h - unit * WORLD.h) / 2,
      scale: Math.max(1, Math.round((AVATAR_UNITS * unit) / SPRITE_SIZE)),
    };
    paintScene();
  }

  /** world → CSS px @param {number} x @param {number} y */
  const toScreen = (x, y) => ({ sx: geo.ox + x * geo.unit, sy: geo.oy + y * geo.unit });

  // ---- static scene: an Altbau living room in Vienna, decorated for the birthday ----
  // Back wall (pale stucco, cornice, chair rail), a tall casement window on the left and a white
  // double door on the right — the lobby panels sit on the wall between them (screen-main.css keeps
  // that gap) — a chandelier above the panels, herringbone parquet, bunting and balloons.

  function paintScene() {
    const g = bgCtx;
    const { unit, w, h, dpr, scale } = geo;
    const p = scale; // one "art pixel", same grid as the sprites
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    /** world units → screen px, snapped to the art-pixel grid */
    const X = (/** @type {number} */ u) => snap(geo.ox + u * unit, p);
    const Y = (/** @type {number} */ u) => snap(geo.oy + u * unit, p);
    const floorTop = Y(SCENE.floorTop);

    paintWall(g, w, floorTop, p, Y);
    paintFloor(g, floorTop, w, h, p);
    paintWindow(g, X(SCENE.window.x0), X(SCENE.window.x1), Y(SCENE.window.top), floorTop - Y(SCENE.sill) + Y(0), p);
    paintDoor(g, X(SCENE.door.x0), X(SCENE.door.x1), Y(SCENE.door.top), floorTop, p);
    const cx = X(SCENE.chandelier.x), cy = Y(SCENE.chandelier.y);
    paintBunting(g, [[0, Y(0.3)], [cx - p * 7, cy], [cx + p * 7, cy], [w, Y(0.3)]], p);
    paintChandelier(g, cx, Y(SCENE.cornice), cy, p, unit);
    for (const b of SCENE.balloons) balloon(g, geo.ox + b.x * unit, geo.oy + b.y * unit, b.color, p);
    paintLight(g, cx, cy, w, h, unit);
  }

  /** @param {CanvasRenderingContext2D} g @param {number} w @param {number} floorTop @param {number} p @param {(u: number) => number} Y */
  function paintWall(g, w, floorTop, p, Y) {
    rect(g, 0, 0, w, floorTop, PAL.wall);
    rect(g, 0, 0, w, Y(0.9), PAL.wallHigh); // the light falls off towards the high ceiling
    // cornice: a deep white moulding with a dentil row and a shadow line
    const c = Y(SCENE.cornice);
    rect(g, 0, 0, w, c, PAL.stucco);
    for (let x = 0; x < w; x += p * 3) rect(g, x, c - p * 2, p * 2, p, PAL.stuccoShade);
    rect(g, 0, c, w, p, PAL.wallShade);
    // chair rail at sill height
    const rail = floorTop - Y(SCENE.sill) + Y(0);
    rect(g, 0, rail, w, p, PAL.stucco);
    rect(g, 0, rail + p, w, p, PAL.wallShade);
    // skirting board
    rect(g, 0, floorTop - p * 3, w, p * 3, PAL.stucco);
    rect(g, 0, floorTop - p * 3, w, p, PAL.stuccoShade);
  }

  /** Herringbone (Fischgrät) parquet: planks of PLANK_W × PLANK_N·PLANK_W art pixels. */
  /** @param {CanvasRenderingContext2D} g @param {number} top @param {number} w @param {number} h @param {number} p */
  function paintFloor(g, top, w, h, p) {
    const cols = Math.ceil(w / p), rows = Math.ceil((h - top) / p);
    for (let ay = 0; ay < rows; ay++) {
      for (let ax = 0; ax < cols; ax++) {
        rect(g, ax * p, top + ay * p, p, p, parquetColor(ax, ay));
      }
    }
    rect(g, 0, top, w, p, PAL.floorShade); // contact shadow under the skirting
  }

  /** @param {CanvasRenderingContext2D} g @param {number} x0 @param {number} x1 @param {number} top @param {number} bottom @param {number} p */
  function paintWindow(g, x0, x1, top, bottom, p) {
    const W = x1 - x0;
    rect(g, x0 - p, top - p, W + p * 2, bottom - top + p * 2, PAL.reveal); // recess
    rect(g, x0, top, W, bottom - top, PAL.frame);
    // evening sky in a few flat bands (pixel-art gradient)
    const gx = x0 + p * 2, gy = top + p * 2, gw = W - p * 4, gh = bottom - top - p * 4;
    const bands = SKY.length;
    for (let i = 0; i < bands; i++) {
      const y0 = gy + snap((gh * i) / bands, p), y1 = gy + snap((gh * (i + 1)) / bands, p);
      rect(g, gx, y0, gw, y1 - y0, SKY[i]);
    }
    for (const [sx, sy] of [[0.25, 0.08], [0.7, 0.15], [0.45, 0.26]]) rect(g, gx + snap(gw * sx, p), gy + snap(gh * sy, p), p, p, PAL.star);
    // Vienna rooftops and a chimney against the dusk
    const roofs = [[0, 0.86, 0.35], [0.3, 0.8, 0.3], [0.55, 0.88, 0.45]];
    for (const [rx, ry, rw] of roofs) rect(g, gx + snap(gw * rx, p), gy + snap(gh * ry, p), snap(gw * rw, p), gy + gh - (gy + snap(gh * ry, p)), PAL.roofs);
    rect(g, gx + snap(gw * 0.4, p), gy + snap(gh * 0.74, p), p * 2, snap(gh * 0.08, p), PAL.roofs);
    // casement bars: transom, mullion, one glazing bar per leaf
    const transom = top + snap((bottom - top) * 0.27, p);
    rect(g, x0, transom, W, p * 2, PAL.frame);
    rect(g, x0 + snap(W / 2, p) - p, transom, p * 2, bottom - transom, PAL.frame);
    rect(g, x0, transom + snap((bottom - transom) / 2, p), W, p, PAL.frame);
    rect(g, x0 + snap(W / 2, p) - p * 2, transom + snap((bottom - transom) * 0.45, p), p, p * 2, PAL.brass); // latch
    // sill
    rect(g, x0 - p * 2, bottom, W + p * 4, p * 2, PAL.stucco);
    rect(g, x0 - p * 2, bottom + p * 2, W + p * 4, p, PAL.wallShade);
  }

  /** @param {CanvasRenderingContext2D} g @param {number} x0 @param {number} x1 @param {number} top @param {number} floor @param {number} p */
  function paintDoor(g, x0, x1, top, floor, p) {
    const W = x1 - x0;
    rect(g, x0 - p * 3, top - p * 4, W + p * 6, p * 2, PAL.stucco);       // overdoor cornice
    rect(g, x0 - p * 3, top - p * 2, W + p * 6, p, PAL.stuccoShade);
    rect(g, x0 - p * 2, top - p, W + p * 4, floor - top + p, PAL.frame); // architrave
    rect(g, x0 - p, top, W + p * 2, floor - top, PAL.stuccoShade);
    rect(g, x0, top + p, W, floor - top - p, PAL.door);
    const mid = x0 + snap(W / 2, p);
    rect(g, mid, top + p, p, floor - top - p, PAL.doorLine);
    // two raised panels per leaf: tall upper, short lower
    const H = floor - top;
    for (const [lx, lw] of [[x0, mid - x0], [mid + p, x1 - mid - p]]) {
      panelOutline(g, lx + p * 2, top + p * 3, lw - p * 4, snap(H * 0.55, p), p);
      panelOutline(g, lx + p * 2, top + p * 3 + snap(H * 0.55, p) + p * 3, lw - p * 4, snap(H * 0.28, p), p);
    }
    const hy = top + snap(H * 0.55, p) + p * 2;
    rect(g, mid - p * 2, hy, p, p * 2, PAL.brass);
    rect(g, mid + p * 2, hy, p, p * 2, PAL.brass);
  }

  /** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} w @param {number} h @param {number} p */
  function panelOutline(g, x, y, w, h, p) {
    rect(g, x, y, w, p, PAL.doorLine);
    rect(g, x, y, p, h, PAL.doorLine);
    rect(g, x, y + h - p, w, p, PAL.doorHigh);
    rect(g, x + w - p, y, p, h, PAL.doorHigh);
  }

  /** @param {CanvasRenderingContext2D} g @param {number} cx @param {number} ceiling @param {number} cy @param {number} p @param {number} unit */
  function paintChandelier(g, cx, ceiling, cy, p, unit) {
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, unit * 1.6);
    glow.addColorStop(0, 'rgba(255, 214, 140, 0.55)');
    glow.addColorStop(1, 'rgba(255, 214, 140, 0)');
    g.fillStyle = glow;
    g.fillRect(cx - unit * 1.6, cy - unit * 1.6, unit * 3.2, unit * 3.2);
    rect(g, cx - p * 2, ceiling, p * 4, p, PAL.brass);              // ceiling rose
    rect(g, cx, ceiling, p, cy - ceiling, PAL.brassDark);           // chain
    rect(g, cx - p, cy - p * 2, p * 3, p * 3, PAL.brass);            // body
    rect(g, cx - p * 6, cy, p * 13, p, PAL.brass);                   // arms
    rect(g, cx - p * 6, cy - p, p, p, PAL.brass);
    rect(g, cx + p * 6, cy - p, p, p, PAL.brass);
    for (const dx of [-6, -3, 3, 6]) {                               // candles + flames
      rect(g, cx + dx * p, cy - p * 3, p, p * 2, PAL.candle);
      rect(g, cx + dx * p, cy - p * 4, p, p, PAL.flame);
    }
    rect(g, cx, cy + p, p, p * 2, PAL.crystal);                      // crystal drop
    rect(g, cx - p * 4, cy + p, p, p, PAL.crystal);
    rect(g, cx + p * 4, cy + p, p, p, PAL.crystal);
  }

  /**
   * Bunting hung along a polyline (corner → chandelier → corner), one flag every 10 art pixels.
   * @param {CanvasRenderingContext2D} g @param {[number, number][]} points @param {number} p
   */
  function paintBunting(g, points, p) {
    let i = 0;
    for (let s = 1; s < points.length; s++) {
      const [ax, ay] = points[s - 1], [bx, by] = points[s];
      const steps = Math.max(1, Math.round(Math.abs(bx - ax) / p));
      for (let k = 0; k <= steps; k++) { // the cord, sagging slightly
        const t = k / steps;
        rect(g, snap(ax + (bx - ax) * t, p), snap(ay + (by - ay) * t + Math.sin(Math.PI * t) * p * 2, p), p, p, PAL.buntingCord);
      }
      if (steps < 20) continue; // the short span across the chandelier stays a bare cord
      for (let k = 0; k < steps - 4; k += 10, i++) {
        const t = (k + 6) / steps;
        const fx = snap(ax + (bx - ax) * t, p) - p * 5, fy = snap(ay + (by - ay) * t + Math.sin(Math.PI * t) * p * 2, p) + p;
        g.fillStyle = FLAGS[i % FLAGS.length];
        for (let r = 0; r < 5; r++) g.fillRect(fx + r * p, fy + r * p, (10 - 2 * r) * p, p);
      }
    }
  }

  /** Warm evening light: lamp-lit centre, dimmer corners. */
  /** @param {CanvasRenderingContext2D} g @param {number} cx @param {number} cy @param {number} w @param {number} h @param {number} unit */
  function paintLight(g, cx, cy, w, h, unit) {
    const light = g.createRadialGradient(cx, cy + unit * 2, unit, cx, cy + unit * 2, Math.hypot(w, h) * 0.62);
    light.addColorStop(0, 'rgba(255, 196, 120, 0.10)');
    light.addColorStop(0.55, 'rgba(60, 30, 40, 0.06)');
    light.addColorStop(1, 'rgba(30, 14, 30, 0.42)');
    g.fillStyle = light;
    g.fillRect(0, 0, w, h);
  }

  /** @param {CanvasRenderingContext2D} g @param {number} cx @param {number} cy @param {string} color @param {number} px */
  function balloon(g, cx, cy, color, px) {
    const rows = [2, 4, 5, 5, 5, 4, 2];
    g.fillStyle = color;
    rows.forEach((half, r) => g.fillRect(Math.round(cx - half * px), Math.round(cy + (r - 3) * px * 2), half * 2 * px, px * 2));
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(Math.round(cx - 3 * px), Math.round(cy - 4 * px), px * 2, px * 2);
    g.fillStyle = PAL.cord;
    g.fillRect(Math.round(cx), Math.round(cy + 8 * px), px, px * 18);
  }

  // ---- players & positions ----

  /** @type {Set<string>} */
  let offline = new Set();
  /** Campaign doors on the map screens (empty in the block lobby). @type {import('./doors.js').DoorView[]} */
  let doors = [];

  /** Hub / world map: the doors to draw (see doors.js). @param {import('./doors.js').DoorView[]} list */
  function setDoors(list) {
    doors = list;
  }

  /** Players shown offline (debounced by presence.js): their avatar is dimmed and tagged. @param {Set<string>} ids */
  function setOffline(ids) {
    offline = ids;
  }

  /**
   * Who is in the room: a block State (lobby) or the campaign party (map screens) — same roster shape.
   * @param {{ order: string[], players: Record<string, { name: string, color: number, character?: string | null, left?: boolean }> }} s
   */
  function setPlayers(s) {
    const present = new Set();
    for (const id of s.order) {
      const p = s.players[id];
      if (!p || /** @type {{ left?: boolean }} */ (p).left) continue;
      present.add(id);
      const character = (p.character && CHARACTERS[/** @type {keyof typeof CHARACTERS} */ (p.character)])
        ? p.character
        : FALLBACK_CHARACTERS[(p.color - 1 + FALLBACK_CHARACTERS.length) % FALLBACK_CHARACTERS.length];
      let a = avatars.get(id);
      if (!a) {
        const spawn = spawnPoint(/** @type {import("../../shared/characters.js").CharacterId | null} */ (p.character ?? null));
        const known = lastPos.get(id);
        const start = known ?? { x: spawn.x, y: spawn.y, dir: spawn.dir, moving: false, at: 0 };
        a = {
          id, name: p.name, color: p.color, character,
          x: start.x, y: start.y, tx: start.x, ty: start.y,
          dir: start.dir, moving: start.moving, lastPosAt: start.at,
        };
        avatars.set(id, a);
      }
      a.name = p.name;
      a.color = p.color;
      a.character = character;
    }
    for (const id of avatars.keys()) if (!present.has(id)) avatars.delete(id);
    for (const id of lastPos.keys()) if (!s.players[id]) lastPos.delete(id);
  }

  /** @param {unknown} m a `pos` message from the server */
  function onPos(m) {
    const msg = /** @type {Partial<PosMsg>} */ (m);
    if (typeof msg.playerId !== 'string' || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
    const dir = DIRS.has(String(msg.dir)) ? /** @type {Dir} */ (msg.dir) : 'down';
    const now = performance.now();
    const p = { playerId: msg.playerId, x: Number(msg.x), y: Number(msg.y), dir, moving: !!msg.moving, at: now };
    lastPos.set(p.playerId, p);
    const a = avatars.get(p.playerId);
    if (!a) return;
    a.tx = p.x; a.ty = p.y; a.dir = p.dir; a.moving = p.moving; a.lastPosAt = now;
  }

  // ---- animation ----

  /** @param {number} now */
  function frame(now) {
    raf = visible ? requestAnimationFrame(frame) : 0;
    const dt = Math.min(0.5, (now - (lastFrame || now)) / 1000); // generous cap: a slow frame still catches up
    lastFrame = now;
    const g = fgCtx;
    g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    g.clearRect(0, 0, geo.w, geo.h);
    g.imageSmoothingEnabled = false;
    const k = 1 - Math.exp(-EASE_PER_S * dt);
    const walkFrame = WALK_FRAMES[Math.floor((now / 1000) * WALK_FPS) % WALK_FRAMES.length];
    const list = [...avatars.values()];
    for (const a of list) {
      a.x += (a.tx - a.x) * k;
      a.y += (a.ty - a.y) * k;
    }
    for (const d of doors) drawDoorway(g, d, now);
    list.sort((p, q) => p.y - q.y);
    for (const a of list) drawAvatar(g, a, isWalking(a, now) ? walkFrame : 0);
  }

  /** @param {Avatar} a @param {number} now */
  function isWalking(a, now) {
    const fresh = now - a.lastPosAt < STALE_MS;
    const travelling = Math.hypot(a.tx - a.x, a.ty - a.y) > ARRIVED;
    return fresh && (a.moving || travelling); // updates stopped → idle, however far the easing got
  }

  /** @param {CanvasRenderingContext2D} g @param {Avatar} a @param {number} spriteFrame */
  function drawAvatar(g, a, spriteFrame) {
    const { scale, unit } = geo;
    const size = SPRITE_SIZE * scale;
    // keep the whole sprite on screen even at the world's edges
    const x = Math.min(WORLD.w - 0.5, Math.max(0.5, a.x));
    const y = Math.min(WORLD.h, Math.max(AVATAR_UNITS, a.y));
    const { sx, sy } = toScreen(x, y);
    const left = Math.round(sx - size / 2);
    const top = Math.round(sy - size);
    // shadow
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(sx, sy - scale, size * 0.32, scale * 1.6, 0, 0, Math.PI * 2);
    g.fill();
    const off = offline.has(a.id);
    if (off) g.globalAlpha = OFFLINE_ALPHA;
    drawSprite(g, a.character, a.dir, spriteFrame, left, top, scale);
    g.globalAlpha = 1;
    label(g, a, sx, Math.min(geo.h - unit * 0.3, sy + scale * 2), off);
  }

  /** @param {CanvasRenderingContext2D} g @param {Avatar} a @param {number} cx @param {number} top @param {boolean} off */
  function label(g, a, cx, top, off) {
    const text = off ? `${a.name} · 📵 offline` : a.name;
    const fontPx = Math.round(geo.unit * 0.26);
    g.font = `800 ${fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    const h = fontPx * 1.35;
    const pad = h * 0.45, dot = h * 0.4, gap = h * 0.3;
    const w = pad + dot + gap + g.measureText(text).width + pad;
    const margin = geo.unit * 0.1;
    const x0 = Math.min(geo.w - margin - w, Math.max(margin, cx - w / 2));
    g.fillStyle = 'rgba(12, 14, 18, 0.78)';
    g.beginPath();
    g.roundRect(x0, top, w, h, h / 2);
    g.fill();
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--p${a.color}`).trim() || '#fff';
    g.fillRect(x0 + pad, top + (h - dot) / 2, dot, dot);
    g.fillStyle = off ? '#b9bcc4' : '#ffffff';
    g.fillText(text, x0 + pad + dot + gap, top + fontPx * 0.17);
  }

  // ---- campaign doors (map screens) ----
  // A free-standing Altbau doorway per child node: its floor zone (content `door` rect, where walking
  // in enters) is a rug in front; the doorway stands on the rug's back edge with the title on a plaque.

  /** @param {CanvasRenderingContext2D} g @param {import('./doors.js').DoorView} d @param {number} now */
  function drawDoorway(g, d, now) {
    const { unit, scale: p } = geo;
    const r = d.rect;
    const X = (/** @type {number} */ u) => snap(geo.ox + u * unit, p);
    const Y = (/** @type {number} */ u) => snap(geo.oy + u * unit, p);
    const locked = d.state === 'locked';
    const pulse = d.state === 'new' ? 0.5 + 0.5 * Math.sin(now / 260) : 0;
    g.save();
    if (locked) g.globalAlpha = 0.6;

    // rug = the walk-in zone
    const rx0 = X(r.x), rx1 = X(r.x + r.w), ry0 = Y(r.y), ry1 = Y(r.y + r.h);
    rect(g, rx0, ry0, rx1 - rx0, ry1 - ry0, locked ? '#5b4a3c' : '#8c2f39');
    rect(g, rx0 + p * 2, ry0 + p * 2, rx1 - rx0 - p * 4, ry1 - ry0 - p * 4, locked ? '#6a5848' : '#b23a48');
    for (let x = rx0 + p * 4; x < rx1 - p * 4; x += p * 4) rect(g, x, ry0 + p, p * 2, p, locked ? '#7a6858' : '#e9c46a');

    // doorway standing on the rug's back edge
    const dw = Math.max(p * 14, snap((rx1 - rx0) * 0.7, p));
    const dh = snap(unit * 1.75, p);
    const dx0 = snap((rx0 + rx1) / 2 - dw / 2, p), dy1 = ry0 + p * 2, dy0 = dy1 - dh;
    rect(g, dx0 - p * 3, dy0 - p * 3, dw + p * 6, p * 2, PAL.stucco);            // cornice
    rect(g, dx0 - p * 2, dy0 - p, dw + p * 4, dh + p, PAL.frame);                // architrave
    rect(g, dx0 - p, dy0, dw + p * 2, dh, PAL.stuccoShade);
    if (locked) {
      rect(g, dx0, dy0 + p, dw, dh - p, '#8a7a66');                              // closed leaves
      const mid = dx0 + snap(dw / 2, p);
      rect(g, mid, dy0 + p, p, dh - p, '#6d604f');
      // padlock
      const ly = dy0 + snap(dh * 0.5, p);
      rect(g, mid - p * 3, ly, p * 7, p * 5, PAL.brass);
      rect(g, mid - p * 2, ly - p * 3, p, p * 3, PAL.brassDark);
      rect(g, mid + p * 2, ly - p * 3, p, p * 3, PAL.brassDark);
      rect(g, mid - p * 2, ly - p * 4, p * 5, p, PAL.brassDark);
      rect(g, mid, ly + p * 2, p, p * 2, PAL.brassDark);
    } else {
      // open: warm light inside, leaves folded against the jambs
      const glow = g.createLinearGradient(0, dy0, 0, dy1);
      glow.addColorStop(0, '#ffe7a8');
      glow.addColorStop(1, '#ffb84d');
      g.fillStyle = glow;
      g.fillRect(dx0 + p * 2, dy0 + p, dw - p * 4, dh - p);
      rect(g, dx0, dy0 + p, p * 2, dh - p, PAL.door);
      rect(g, dx0 + dw - p * 2, dy0 + p, p * 2, dh - p, PAL.door);
      // light spilling onto the rug
      g.fillStyle = `rgba(255, 214, 140, ${0.22 + pulse * 0.25})`;
      g.fillRect(dx0, dy1, dw, ry1 - dy1);
      if (d.state === 'new') {
        const halo = g.createRadialGradient(dx0 + dw / 2, dy0 + dh / 2, 0, dx0 + dw / 2, dy0 + dh / 2, unit * 1.4);
        halo.addColorStop(0, `rgba(255, 236, 160, ${0.35 + pulse * 0.35})`);
        halo.addColorStop(1, 'rgba(255, 236, 160, 0)');
        g.fillStyle = halo;
        g.fillRect(dx0 - unit, dy0 - unit, dw + unit * 2, dh + unit * 2);
        for (let k = 0; k < 4; k++) {                                            // sparkles
          const t = now / 700 + k * 1.7;
          const sx = dx0 + dw / 2 + Math.cos(t) * (dw / 2 + p * 4);
          const sy = dy0 + dh * 0.4 + Math.sin(t * 1.3) * dh * 0.45;
          rect(g, snap(sx, p), snap(sy, p), p, p, '#fff6c8');
          rect(g, snap(sx, p) - p, snap(sy, p), p * 3, p, `rgba(255, 246, 200, ${0.6 * pulse})`);
        }
      }
    }
    g.restore();
    plaque(g, d, dx0 + dw / 2, dy0 - p * 4);
  }

  /**
   * Title plaque above a doorway, fitted to the door's width (doors sit side by side): the font
   * shrinks, then the title wraps onto two lines, so neighbouring plaques never overlap.
   * @param {CanvasRenderingContext2D} g @param {import('./doors.js').DoorView} d @param {number} cx @param {number} bottom
   */
  function plaque(g, d, cx, bottom) {
    const maxW = d.rect.w * geo.unit * 0.98;
    const mark = d.state === 'done' ? '★ ' : d.state === 'locked' ? '🔒 ' : d.state === 'new' ? '✨ ' : '';
    const text = `${mark}${d.title}`;
    const font = (/** @type {number} */ px) => `800 ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    let fontPx = Math.round(geo.unit * 0.24);
    const minPx = Math.round(geo.unit * 0.17);
    g.font = font(fontPx);
    while (fontPx > minPx && g.measureText(text).width + fontPx * 1.5 > maxW) g.font = font(--fontPx);
    /** @type {string[]} */
    let lines = [text];
    if (g.measureText(text).width + fontPx * 1.5 > maxW) {
      const words = text.split(' ');
      let best = 1, bestW = Infinity;
      for (let k = 1; k < words.length; k++) { // the split that balances the two lines best
        const w = Math.max(g.measureText(words.slice(0, k).join(' ')).width, g.measureText(words.slice(k).join(' ')).width);
        if (w < bestW) { bestW = w; best = k; }
      }
      lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
    }
    const lineH = fontPx * 1.2;
    const h = lineH * lines.length + fontPx * 0.4;
    const w = Math.min(maxW, Math.max(...lines.map((l) => g.measureText(l).width)) + fontPx * 1.2);
    const top = bottom - h;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = d.state === 'locked' ? 'rgba(40, 34, 30, 0.8)' : 'rgba(58, 40, 22, 0.92)';
    g.beginPath();
    g.roundRect(cx - w / 2, top, w, h, fontPx * 0.35);
    g.fill();
    g.strokeStyle = d.state === 'locked' ? '#6d604f' : PAL.brass;
    g.lineWidth = Math.max(1, geo.scale / 2);
    g.stroke();
    g.fillStyle = d.state === 'locked' ? '#b9ad9c' : d.state === 'done' ? '#ffd166' : '#fff3d6';
    lines.forEach((l, k) => g.fillText(l, cx, top + fontPx * 0.2 + lineH * (k + 0.5) + 1, maxW));
  }

  /** Shows the room (lobby) or hides it and stops the animation loop. @param {boolean} on */
  function setVisible(on) {
    if (on === visible) return;
    visible = on;
    bg.hidden = !on;
    fg.hidden = !on;
    if (on) {
      layout();
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  /** Forget every avatar and position (reconnect): the next view and pos snapshot rebuild the room. */
  function reset() {
    avatars.clear();
    lastPos.clear();
  }

  addEventListener('resize', () => { if (visible) layout(); });

  return {
    setPlayers, setOffline, setDoors, onPos, setVisible, reset,
    /** Debug / tests: the doors drawn. */
    doors: () => doors.map((d) => ({ id: d.id, state: d.state, title: d.title })),
    /** Debug / tests: the drawn state of every avatar. */
    snapshot: () => [...avatars.values()].map((a) => ({ id: a.id, name: a.name, character: a.character, x: a.x, y: a.y, dir: a.dir, walking: isWalking(a, performance.now()), offline: offline.has(a.id) })),
  };
}
