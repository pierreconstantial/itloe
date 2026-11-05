// M3 party room, M4 (Contract G) the hub's scene: the lobby room with every joined guest's avatar
// walking in it, among props they collide with and sort against.
// Positions are EPHEMERAL (`pos` messages, see PROTOCOL.md); the joined players come from the
// last `view`. A pos (x, y) is the avatar's feet, in world units (WORLD = 16 × 9).
//
// This file is ONE room: its backdrop painting, its scene's prop art, and the plumbing of the
// avatars into the engine. The engine itself is generic — geometry in shared/scene.js, draw order
// and the loop in ./scene-render.js. Three passes per frame:
//   #party-bg  painted once on resize: wall, floor, window, door, chandelier, bunting, balloons
//   #party-fg  per frame: the campaign doorways (flat on the back wall), then the engine's draw
//              list — 'back' props, then 'sorted' props and avatars interleaved by baseline Y,
//              then 'front' props.

import { drawSprite, SPRITE_SIZE, WALK_FRAMES, WALK_FPS } from '../../shared/sprites.js';
import { WORLD } from '../../shared/world.js';
import { PARTY_ROOM, APARTMENT_ROOM, DOOR_FOUR_ROOM, spawnAt } from '../../shared/scene.js';
import { INTRO_KEY, INTRO_KEY_SPOT, PORTAL } from '../../shared/campaign/story.js';
import { CHARACTERS } from '../../shared/characters.js';
import { OBJECT_ACTIONS } from '../../shared/interactions.js';
import { makeView, renderScene, drawOrder, createLoop, lerp, py as snapY } from './scene-render.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/world.js').Dir} Dir */
/** @typedef {{ playerId: string, x: number, y: number, dir: Dir, moving: boolean }} PosMsg */
/**
 * @typedef {{
 *   id: string, name: string, color: number, character: string,
 *   x: number, y: number,      // simulated position (eased towards the target, fixed timestep)
 *   px: number, py: number,    // the same, one update earlier — drawing interpolates between them
 *   tx: number, ty: number,    // last reported position
 *   dir: Dir, moving: boolean, lastPosAt: number,
 * }} Avatar
 */

const AVATAR_UNITS = 1.2;   // avatar height in world units
const OFFLINE_ALPHA = 0.4;  // a dropped player's avatar fades (presence.js decides when)
const STALE_MS = 400;       // no update for this long → idle frame
const EASE_PER_S = 14;      // interpolation speed (higher = snappier)
const ARRIVED = 0.04;       // units: closer than this counts as standing still
const UPDATE_HZ = 60;       // fixed simulation rate; drawing interpolates between two updates
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

// ---- prop art ----------------------------------------------------------------------
// Pixel grids, same letter-per-pixel convention as shared/sprites.js: '.' is transparent, every
// other letter indexes the prop's palette. The grid is painted bottom-centred on the prop's box,
// its last row on the anchorY — so a grid grows upwards from the floor contact, like a sprite.

/** Velvet two-seater (o outline · c/C/l fabric · w/d wooden feet). */
const SOFA_PAL = { o: '#2b3a33', c: '#4f7a68', C: '#3c6153', l: '#669a84', w: '#6b4a2c', d: '#4a3220' };
const SOFA = [
  '..ooooooooooooooooooo..',
  '.olllllllllllllllllllo.',
  '.occccccccccccccccccco.',
  '.occccccccccccccccccco.',
  '.oCcccccccccccccccccCo.',
  '.oCCCCCCCCCCCCCCCCCCCo.',
  'ooooooooooooooooooooooo',
  'olllocccccccoccccccclo.',
  'olllocccccccoccccccclo.',
  'olllocccccccoccccccclo.',
  'olllocCCCCCCoCCCCCCclo.',
  'ooooooooooooooooooooooo',
  'oCCCCCCCCCCCCCCCCCCCCCo',
  '.ooooooooooooooooooooo.',
  '.ww...............ww...',
  '.dd...............dd...',
];

/** The birthday table: cloth, cake, two candles (o outline · w/W cloth · k icing · z sponge · y candle · A flame). */
const TABLE_PAL = { o: '#6b4a2c', w: '#f6f0e3', W: '#d8ccb4', k: '#ff7eb9', z: '#f3c88a', y: '#fff3d6', A: '#ffcf5a' };
const TABLE = [
  '............A.A............',
  '............y.y............',
  '..........ookkkoo..........',
  '..........okkkkko..........',
  '..........ozzzzzo..........',
  '..........ooooooo..........',
  '...ooooooooooooooooooooo...',
  '..owwwwwwwwwwwwwwwwwwwwwo..',
  '..oWWWWWWWWWWWWWWWWWWWWWo..',
  '..ooooooooooooooooooooooo..',
  '...owwwwwwwwwwwwwwwwwwwo...',
  '...owWwWwWwWwWwWwWwWwWwo...',
  '...owWwWwWwWwWwWwWwWwWwo...',
  '....oWWWWWWWWWWWWWWWWWo....',
  '....ooooooooooooooooooo....',
];

/** Tall potted plant (o outline · G/g leaves · s stem · t/T terracotta). */
const PLANT_PAL = { o: '#1e2b22', G: '#3f8a52', g: '#5fae6d', s: '#4a6b3a', t: '#b5633a', T: '#8e4a2a' };
const PLANT = [
  '.....ooo.....',
  '....oGGGo....',
  '..ooGgGgGoo..',
  '.oGGGgGgGGGo.',
  'oGGgGGGGGggGo',
  'oGgGGGgGGGgGo',
  '.oGGGGsGGGGo.',
  '..oGGGsGGGo..',
  '...oGGsGGo...',
  '....oGsGo....',
  '.....oso.....',
  '.....oso.....',
  '..ooooooooo..',
  '..ottttttto..',
  '..oTTTTTTTo..',
  '..ottttttto..',
  '...ottttto...',
  '...otTTTto...',
  '...ottttto...',
  '....ooooo....',
];

/** Every prop grid, for the test that keeps them rectangular and inside their palette. */
export const PROP_PIXELS = { sofa: { grid: SOFA, pal: SOFA_PAL }, table: { grid: TABLE, pal: TABLE_PAL }, plant: { grid: PLANT, pal: PLANT_PAL } };

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
  /** @type {Map<string, {text?: string, kind?: string, until: number, started: number}>} */
  const expressions = new Map();
  let geo = makeView(1, 1, 1, WORLD, AVATAR_UNITS, SPRITE_SIZE);
  let visible = false;
  /** @type {'lobby' | 'apartment' | 'second-room'} */ let mode = 'lobby';
  let portalVisible = false;
  let keyVisible = false;
  /** @type {string[]} */ let hubPeople = [];
  /** @type {{id: string, icon: string}[]} */ let decorations = [];
  let frameNow = 0;                    // the timestamp of the frame being drawn (walk cycle, door sparkles)
  let frameAlpha = 0;                  // …and how far it sits between the last two updates
  /** Reused between frames so a steady room allocates nothing. @type {import('./scene-render.js').Item[]} */
  const drawList = [];

  // ---- geometry ----

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = innerWidth, h = innerHeight;
    for (const c of [bg, fg]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    geo = makeView(w, h, dpr, WORLD, AVATAR_UNITS, SPRITE_SIZE);
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

    if (mode === 'second-room') {
      rect(g, 0, 0, w, floorTop, '#b8a998');
      rect(g, 0, floorTop, w, h - floorTop, '#8a6951');
      rect(g, 0, floorTop - p * 3, w, p * 3, PAL.stucco);
      paintDoor(g, X(6.6), X(9.4), Y(1.15), floorTop, p);
      return;
    }

    paintWall(g, w, floorTop, p, Y);
    paintFloor(g, floorTop, w, h, p);
    paintWindow(g, X(SCENE.window.x0), X(SCENE.window.x1), Y(SCENE.window.top), floorTop - Y(SCENE.sill) + Y(0), p);
    if (mode === 'apartment') {
      paintTerrace(g, X, Y, w, h, floorTop, p);
      paintChandelier(g, X(5.4), Y(SCENE.cornice), Y(SCENE.chandelier.y), p, unit);
      paintLight(g, X(5.4), Y(SCENE.chandelier.y), X(10.5), h, unit);
      return;
    }
    paintDoor(g, X(SCENE.door.x0), X(SCENE.door.x1), Y(SCENE.door.top), floorTop, p);
    const cx = X(SCENE.chandelier.x), cy = Y(SCENE.chandelier.y);
    paintBunting(g, [[0, Y(0.3)], [cx - p * 7, cy], [cx + p * 7, cy], [w, Y(0.3)]], p);
    paintChandelier(g, cx, Y(SCENE.cornice), cy, p, unit);
    for (const b of SCENE.balloons) balloon(g, geo.ox + b.x * unit, geo.oy + b.y * unit, b.color, p);
    paintLight(g, cx, cy, w, h, unit);
  }

  /** Sunny terrace on the right third; an indoor-outdoor threshold keeps the apartment airy. */
  /** @param {CanvasRenderingContext2D} g @param {(u: number) => number} X @param {(u: number) => number} Y
   * @param {number} w @param {number} h @param {number} floorTop @param {number} p */
  function paintTerrace(g, X, Y, w, h, floorTop, p) {
    const edge = X(10.7);
    rect(g, edge, 0, w - edge, floorTop, '#a9dbee');
    rect(g, edge, Y(2.9), w - edge, floorTop - Y(2.9), '#d7eef3');
    g.fillStyle = '#fff0a2';
    g.beginPath(); g.arc(X(14.1), Y(1.2), p * 10, 0, Math.PI * 2); g.fill();
    rect(g, edge, floorTop, w - edge, h - floorTop, '#d8b18b');
    for (let x = edge; x < w; x += p * 9) rect(g, x, floorTop, p, h - floorTop, '#bc9272');
    rect(g, edge, Y(4.25), w - edge, p * 2, '#efe6d3');
    for (let x = edge + p * 4; x < w; x += p * 12) rect(g, x, Y(3.65), p * 2, Y(4.25) - Y(3.65), '#f5eee3');
    rect(g, edge - p * 3, 0, p * 6, h, '#f4efe4');
    // terrace café table, ashtray and beer
    rect(g, X(13.15), Y(6.7), p * 16, p * 2, '#694c3d');
    rect(g, X(13.55), Y(6.7) + p * 2, p * 2, p * 14, '#694c3d');
    rect(g, X(13.35), Y(6.7) + p * 16, p * 7, p * 2, '#694c3d');
    rect(g, X(13.28), Y(6.7) - p * 2, p * 5, p * 2, '#bcc5c5');
    rect(g, X(13.95), Y(6.7) - p * 8, p * 3, p * 8, '#e8b74a');
    rect(g, X(13.95), Y(6.7) - p * 8, p * 3, p, '#fff4cc');
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

  // ---- props (the scene's furniture, PARTY_ROOM in shared/scene.js) ----
  // Each prop is a pixel grid on the same art-pixel grid as the sprites, painted bottom-centred on
  // its box: the last row sits ON the prop's anchorY, which is both its floor contact and what it
  // sorts by. Adding furniture = one grid + one line in PROP_ART; the engine does the rest.

  /**
   * @param {CanvasRenderingContext2D} g @param {string[]} grid @param {Record<string, string>} pal
   * @param {number} cx centre, CSS px @param {number} bottom baseline, CSS px @param {number} p art pixel
   */
  function paintGrid(g, grid, pal, cx, bottom, p) {
    const x0 = snap(cx - (grid[0].length * p) / 2, p);
    const y0 = bottom - grid.length * p;
    for (let ry = 0; ry < grid.length; ry++) {
      const row = grid[ry];
      for (let rx = 0; rx < row.length; rx++) {
        const color = pal[row[rx]];
        if (color) rect(g, x0 + rx * p, y0 + ry * p, p, p, color);
      }
    }
  }

  /** @type {Map<string, {started: number, until: number}>} */
  const objectEffects = new Map();

  /** One prop's art from a pixel grid. @param {string[]} grid @param {Record<string, string>} pal */
  const pixelProp = (grid, pal) =>
    /** @type {import('./scene-render.js').DrawProp} */ ((g, prop, v) => {
      const effect = objectEffects.get(prop.id);
      const active = effect && effect.until > frameNow ? effect : null;
      if (effect && !active) objectEffects.delete(prop.id);
      const cx = geo.ox + (prop.box.x + prop.box.w / 2) * v.unit;
      const bottom = snapY(v, prop.anchorY);
      const elapsed = active ? frameNow - active.started : 0;
      g.save();
      if (active && prop.id === 'plant') {
        g.translate(cx, bottom);
        g.rotate(Math.sin(elapsed / 65) * 0.13 * Math.max(0, 1 - elapsed / 2500));
        g.translate(-cx, -bottom);
      } else if (active && prop.id === 'sofa') {
        g.translate(0, Math.abs(Math.sin(elapsed / 110)) * v.scale * 1.5);
      }
      if (mode === 'apartment' && prop.id === 'sofa') {
        g.translate(cx, 0);
        g.scale(1.7, 1);
        g.translate(-cx, 0);
      }
      // The birthday candles go dark for a moment when blown out.
      paintGrid(g, grid, active && prop.id === 'table' ? { ...pal, A: '' } : pal, cx, bottom, v.scale);
      g.restore();
      if (active) {
        g.save();
        g.font = `${Math.round(v.unit * 0.55)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const glyph = prop.id === 'table' ? '💨' : prop.id === 'plant' ? '🍃' : '✨';
        g.fillText(glyph, cx + Math.sin(elapsed / 160) * v.scale * 2,
          bottom - prop.box.h * v.unit - v.scale * 3 - Math.min(elapsed * 0.025, v.unit * 0.4));
        g.restore();
      }
    });

  /** prop.kind → art. The only place this room's furniture is named. @type {import('./scene-render.js').PropArt} */
  const PROP_ART = {
    sofa: pixelProp(SOFA, SOFA_PAL),
    table: pixelProp(TABLE, TABLE_PAL),
    plant: pixelProp(PLANT, PLANT_PAL),
  };

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
        // a fresh avatar starts on walkable floor: the shared spawn point, nudged out of a prop
        const spawn = spawnAt(PARTY_ROOM, /** @type {import("../../shared/characters.js").CharacterId | null} */ (p.character ?? null));
        const known = lastPos.get(id);
        const start = known ?? { x: spawn.x, y: spawn.y, dir: spawn.dir, moving: false, at: 0 };
        a = {
          id, name: p.name, color: p.color, character,
          x: start.x, y: start.y, px: start.x, py: start.y, tx: start.x, ty: start.y,
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

  /** @param {any} m short lived speech or reaction, shown by the avatar */
  function onSocial(m) {
    if (typeof m.playerId !== 'string') return;
    const now = performance.now();
    if (m.t === 'say' && typeof m.text === 'string') {
      expressions.set(m.playerId, { text: m.text, started: now, until: now + 5500 });
    } else if (m.t === 'emote' && ['victory', 'fart', 'annoy'].includes(m.kind)) {
      expressions.set(m.playerId, { kind: m.kind, started: now, until: now + 2200 });
    }
  }

  /** @param {any} m a server-validated action at an object */
  function onInteract(m) {
    if (typeof m.playerId !== 'string' || typeof m.object !== 'string' || !Object.hasOwn(OBJECT_ACTIONS, m.object)) return;
    const now = performance.now();
    objectEffects.set(m.object, { started: now, until: now + 2800 });
    expressions.set(m.playerId, {
      text: OBJECT_ACTIONS[/** @type {keyof typeof OBJECT_ACTIONS} */ (m.object)].feedback,
      started: now, until: now + 2000,
    });
  }

  // ---- animation: fixed-step simulation, interpolated drawing ----

  /** One simulation step: every avatar eases towards its last reported position. @param {number} dt */
  function update(dt) {
    const k = 1 - Math.exp(-EASE_PER_S * dt);
    for (const a of avatars.values()) {
      a.px = a.x; a.py = a.y;
      a.x += (a.tx - a.x) * k;
      a.y += (a.ty - a.y) * k;
    }
  }

  /** @param {number} alpha how far this frame sits between the last two updates @param {number} now */
  function draw(alpha, now) {
    frameNow = now;
    frameAlpha = alpha;
    const g = fgCtx;
    g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    g.clearRect(0, 0, geo.w, geo.h);
    g.imageSmoothingEnabled = false;
    for (const d of doors) drawDoorway(g, d, now); // the doorways lie flat on the back wall, under everything
    if (portalVisible && mode === 'lobby') drawPortal(g, now);
    renderScene(g, mode === 'second-room' ? DOOR_FOUR_ROOM : mode === 'apartment' ? APARTMENT_ROOM : PARTY_ROOM,
      avatars.values(), PROP_ART, drawActor, geo, drawList);
    if (mode === 'apartment') {
      drawCats(g, now);
      drawHubPeople(g, now);
      drawDecorations(g);
      if (keyVisible) drawIntroKey(g, now);
    }
  }

  /** Friends without a player avatar gather here after their reunion has been earned. */
  /** @param {CanvasRenderingContext2D} g @param {number} now */
  function drawHubPeople(g, now) {
    const spots = {
      nico: { x: 3.9, y: 7.2, color: '#577aa4', name: 'Nico' },
      father: { x: 5.25, y: 7.6, color: '#8c6650', name: 'Father' },
      mother: { x: 9.2, y: 7.2, color: '#a86a82', name: 'Mother' },
    };
    for (const id of hubPeople) {
      const person = spots[/** @type {keyof typeof spots} */ (id)];
      if (!person) continue;
      const { sx, sy } = toScreen(person.x, person.y);
      const p = geo.scale;
      const bob = Math.sin(now / 700 + person.x) * p;
      g.fillStyle = '#e2b899';
      g.fillRect(sx - p * 4, sy - p * 16 + bob, p * 8, p * 7);
      g.fillStyle = person.color;
      g.fillRect(sx - p * 6, sy - p * 9 + bob, p * 12, p * 9);
      g.fillStyle = '#303047';
      g.fillRect(sx - p * 5, sy - p * 1 + bob, p * 4, p * 3);
      g.fillRect(sx + p, sy - p * 1 + bob, p * 4, p * 3);
      g.fillStyle = '#fff4da';
      g.font = `800 ${Math.round(geo.unit * 0.2)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(person.name, sx, sy + p * 7);
    }
  }

  /** Catalogue objects collected by Elo become small keepsakes on the apartment wall. */
  /** @param {CanvasRenderingContext2D} g */
  function drawDecorations(g) {
    decorations.slice(0, 8).forEach((item, index) => {
      const { sx, sy } = toScreen(1.4 + index * 1.05, 3.65);
      const p = geo.scale;
      rect(g, sx - p * 8, sy - p * 7, p * 16, p * 14, '#6d4a38');
      rect(g, sx - p * 6, sy - p * 5, p * 12, p * 10, '#e9d9b3');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${Math.round(geo.unit * 0.4)}px system-ui, sans-serif`;
      g.fillText(item.icon, sx, sy);
    });
  }

  /** @param {CanvasRenderingContext2D} g @param {number} now */
  function drawPortal(g, now) {
    const { sx, sy } = toScreen(PORTAL.x, PORTAL.y);
    const pulse = 1 + Math.sin(now / 230) * 0.08;
    g.save();
    g.translate(sx, sy); g.scale(pulse, pulse);
    const glow = g.createRadialGradient(0, 0, 2, 0, 0, geo.unit * 1.25);
    glow.addColorStop(0, '#fff7b8'); glow.addColorStop(0.3, '#ce8cff'); glow.addColorStop(0.7, '#7047ccaa'); glow.addColorStop(1, '#7047cc00');
    g.fillStyle = glow; g.beginPath(); g.ellipse(0, 0, geo.unit * 1.25, geo.unit * 0.9, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e3aaff'; g.lineWidth = geo.scale * 2;
    g.beginPath(); g.ellipse(0, 0, geo.unit * 0.78, geo.unit * 0.61, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  /** @param {CanvasRenderingContext2D} g @param {number} now */
  function drawCats(g, now) {
    for (const cat of [{ name: 'Silex', x: 3.4, y: 7.8, color: '#4d555d' }, { name: 'Taïga', x: 8.5, y: 7.1, color: '#c69057' }]) {
      const { sx, sy } = toScreen(cat.x, cat.y);
      const p = geo.scale;
      const sway = Math.sin(now / 350 + cat.x) * p;
      g.fillStyle = cat.color;
      g.fillRect(sx - p * 5, sy - p * 4, p * 9, p * 4);
      g.fillRect(sx - p * 3, sy - p * 8, p * 6, p * 5);
      g.beginPath(); g.moveTo(sx - p * 3, sy - p * 7); g.lineTo(sx - p * 2, sy - p * 11); g.lineTo(sx, sy - p * 8);
      g.moveTo(sx + p, sy - p * 8); g.lineTo(sx + p * 3, sy - p * 11); g.lineTo(sx + p * 3, sy - p * 7); g.fill();
      g.fillRect(sx + p * 4, sy - p * 6 + sway, p * 2, p * 4);
      g.fillStyle = '#fff6d8'; g.fillRect(sx - p * 2, sy - p * 6, p, p); g.fillRect(sx + p, sy - p * 6, p, p);
      g.font = `800 ${Math.round(geo.unit * 0.22)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.fillText(cat.name, sx, sy + p * 3);
    }
  }

  /** @param {CanvasRenderingContext2D} g @param {number} now */
  function drawIntroKey(g, now) {
    const { sx, sy } = toScreen(INTRO_KEY_SPOT.x, INTRO_KEY_SPOT.y);
    const bob = Math.sin(now / 250) * geo.scale * 2;
    g.font = `${Math.round(geo.unit * 0.55)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.fillText('🗝️', sx, sy - geo.unit * 0.3 + bob);
    g.font = `800 ${Math.round(geo.unit * 0.2)}px system-ui, sans-serif`;
    g.fillStyle = '#fff3d6'; g.fillText('PICK UP', sx, sy + geo.scale * 2);
  }

  const loop = createLoop(update, draw, UPDATE_HZ);

  /** The engine's actor hook: an avatar, at the interpolated position, on its walk frame. */
  /** @param {CanvasRenderingContext2D} g @param {any} a @param {import('./scene-render.js').View} v */
  function drawActor(g, a, v) {
    const walk = WALK_FRAMES[Math.floor((frameNow / 1000) * WALK_FPS) % WALK_FRAMES.length];
    drawAvatar(g, /** @type {Avatar} */ (a), isWalking(a, frameNow) ? walk : 0, v);
  }

  /** @param {Avatar} a @param {number} now */
  function isWalking(a, now) {
    const fresh = now - a.lastPosAt < STALE_MS;
    const travelling = Math.hypot(a.tx - a.x, a.ty - a.y) > ARRIVED;
    return fresh && (a.moving || travelling); // updates stopped → idle, however far the easing got
  }

  /** @param {CanvasRenderingContext2D} g @param {Avatar} a @param {number} spriteFrame @param {import('./scene-render.js').View} v */
  function drawAvatar(g, a, spriteFrame, v) {
    const { scale, unit } = v;
    const size = SPRITE_SIZE * scale;
    // keep the whole sprite on screen even at the world's edges
    const x = Math.min(WORLD.w - 0.5, Math.max(0.5, lerp(a.px, a.x, frameAlpha)));
    const y = Math.min(WORLD.h, Math.max(AVATAR_UNITS, lerp(a.py, a.y, frameAlpha)));
    const { sx, sy } = toScreen(x, y);
    const left = Math.round(sx - size / 2);
    const top = Math.round(sy - size);
    // shadow
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(sx, sy - scale, size * 0.32, scale * 1.6, 0, 0, Math.PI * 2);
    g.fill();
    const off = offline.has(a.id);
    const expression = expressions.get(a.id);
    const active = expression && expression.until > frameNow ? expression : null;
    if (expression && !active) expressions.delete(a.id);
    if (off) g.globalAlpha = OFFLINE_ALPHA;
    const elapsed = active ? frameNow - active.started : 0;
    g.save();
    if (active?.kind === 'victory') {
      g.translate(0, -Math.abs(Math.sin(elapsed / 100)) * scale * 2);
    } else if (active?.kind === 'annoy') {
      g.translate(Math.sin(elapsed / 35) * scale, 0);
    }
    drawSprite(g, a.character, a.dir, spriteFrame, left, top, scale);
    g.restore();
    g.globalAlpha = 1;
    if (active) drawExpression(g, active, sx, top, size, scale, elapsed);
    label(g, a, sx, Math.min(geo.h - unit * 0.3, sy + scale * 2), off);
  }

  /** Comic style accents and speech, anchored to the avatar rather than a screen corner. */
  /** @param {CanvasRenderingContext2D} g @param {{text?: string, kind?: string}} expression
   * @param {number} sx @param {number} top @param {number} size @param {number} scale @param {number} elapsed */
  function drawExpression(g, expression, sx, top, size, scale, elapsed) {
    if (expression.text) {
      const font = Math.max(18, Math.round(geo.unit * 0.25));
      g.font = `800 ${font}px system-ui, sans-serif`;
      const maxWidth = Math.min(geo.w * 0.26, geo.unit * 3.8);
      const words = expression.text.split(' ').flatMap((word) => {
        if (g.measureText(word).width <= maxWidth) return [word];
        const chunks = [];
        let chunk = '';
        for (const char of word) {
          if (chunk && g.measureText(chunk + char).width > maxWidth) { chunks.push(chunk); chunk = char; }
          else chunk += char;
        }
        if (chunk) chunks.push(chunk);
        return chunks;
      });
      const lines = [''];
      for (const word of words) {
        const last = lines.length - 1;
        const proposed = lines[last] ? `${lines[last]} ${word}` : word;
        if (lines[last] && g.measureText(proposed).width > maxWidth) lines.push(word);
        else lines[last] = proposed;
      }
      const pad = font * 0.65;
      const lineH = font * 1.22;
      const width = Math.min(geo.w - 16, Math.max(...lines.map((line) => g.measureText(line).width)) + pad * 2);
      const height = lines.length * lineH + pad * 1.4;
      const x = Math.max(8, Math.min(geo.w - width - 8, sx + size * 0.24));
      const y = Math.max(8, top - height - scale * 2);
      g.fillStyle = '#fff9ee';
      g.strokeStyle = '#24202b';
      g.lineWidth = Math.max(3, scale);
      g.beginPath();
      g.roundRect(x, y, width, height, font * 0.55);
      g.fill(); g.stroke();
      g.beginPath();
      g.moveTo(Math.max(x + 14, Math.min(x + width - 14, sx + size * 0.3)), y + height);
      g.lineTo(sx + size * 0.15, top - scale);
      g.stroke();
      g.fillStyle = '#201b29';
      g.textBaseline = 'top';
      lines.forEach((line, i) => g.fillText(line, x + pad, y + pad * 0.55 + i * lineH));
      return;
    }
    const kind = expression.kind;
    const font = Math.max(26, Math.round(geo.unit * 0.55));
    g.font = `900 ${font}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(3, scale);
    g.strokeStyle = '#201b29';
    const glyph = kind === 'victory' ? '✌' : kind === 'annoy' ? '💢' : '💨';
    const gx = kind === 'fart' ? sx - size * 0.58 - elapsed * 0.02 : sx + size * 0.44;
    const gy = kind === 'fart' ? top + size * 0.75 - elapsed * 0.035 : top - font * 0.2 - Math.sin(elapsed / 120) * scale;
    g.strokeText(glyph, gx, gy);
    g.fillText(glyph, gx, gy);
    if (kind === 'annoy') {
      g.strokeStyle = '#ee4058';
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(sx + side * size * 0.7, top + size * 0.12);
        g.lineTo(sx + side * size * 0.95, top - size * 0.1);
        g.stroke();
      }
    }
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
    const grand = d.id === 'hub.door4';
    const dw = Math.max(p * 14, snap((rx1 - rx0) * (grand ? 0.92 : 0.7), p));
    const dh = snap(unit * (grand ? 2.65 : 1.75), p);
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
      loop.start();
    } else {
      loop.stop();
    }
  }

  /** @param {'lobby' | 'apartment' | 'second-room'} next */
  function setMode(next) {
    if (mode === next) return;
    mode = next;
    if (visible) paintScene();
  }

  /** Forget every avatar and position (reconnect): the next view and pos snapshot rebuild the room. */
  function reset() {
    avatars.clear();
    lastPos.clear();
    expressions.clear();
    objectEffects.clear();
  }

  addEventListener('resize', () => { if (visible) layout(); });

  return {
    setPlayers, setOffline, setDoors, onPos, onSocial, onInteract, setVisible, setMode,
    setPortal: (/** @type {boolean} */ on) => { portalVisible = on; },
    setKey: (/** @type {boolean} */ on) => { keyVisible = on; },
    setHubPeople: (/** @type {string[]} */ people) => { hubPeople = people; },
    setDecorations: (/** @type {{id: string, icon: string}[]} */ items) => { decorations = items; },
    reset,
    /** Debug / tests: the doors drawn. */
    doors: () => doors.map((d) => ({ id: d.id, state: d.state, title: d.title })),
    /** Debug / tests: the drawn state of every avatar. */
    snapshot: () => [...avatars.values()].map((a) => ({ id: a.id, name: a.name, character: a.character, x: a.x, y: a.y, dir: a.dir, walking: isWalking(a, performance.now()), offline: offline.has(a.id) })),
    /**
     * Debug / tests: the ids painted this frame, back to front — prop ids (sofa, table, plant) and
     * player ids interleaved. An avatar listed BEFORE a prop is drawn behind it.
     * @returns {string[]}
     */
    drawOrder: () => drawOrder(PARTY_ROOM, avatars.values()),
    /** Debug / tests: the room's geometry (colliders and anchors), to assert against. */
    scene: () => ({
      id: PARTY_ROOM.id,
      floor: PARTY_ROOM.floor,
      solids: PARTY_ROOM.solids,
      props: PARTY_ROOM.props.map((p) => ({ id: p.id, anchorY: p.anchorY, layer: p.layer, solid: p.solid })),
    }),
  };
}
