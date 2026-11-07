// M3 party room, M4 (Contract G) the hub's scene: the lobby room with every joined guest's avatar
// walking in it, among props they collide with and sort against. It draws the party room and the
// story's rooms (content.rooms; sceneAt picks one, without the props the story hides).
//
// This file is ONE room: its backdrop (painted here, or the story's art), its scene's prop art (by prop kind,
// the story's grids in ./art/), the furniture effects of object actions, and what the story's machines put in
// it (docs/story-engine.md): zones by their look (a portal), items lying on the floor, NPC lines and emotes.
// The dream apartment (room id 'apartment-room') adds its cats, friends and keepsakes. The avatars are the avatar layer's (./avatar-layer.js), drawn in this room's scene; the
// engine itself is generic — geometry in shared/scene.js, draw order and the loop in
// ./scene-render.js. Three passes per frame:
//   #party-bg  painted once on resize: wall, floor, window, door, chandelier, bunting, balloons
//   #party-fg  per frame: the campaign doorways (flat on the back wall), then the engine's draw
//              list — 'back' props, then 'sorted' props and avatars interleaved by baseline Y,
//              then 'front' props.

import { PARTY_ROOM } from '../../shared/scene.js';
import { WORLD } from '../../shared/world.js';
import { YOUNG_ADULT_PIXELS } from './art/young-adult.js';
import { createLoop, py as snapY } from './scene-render.js';
import { worldView } from './avatar-layer.js';

const UPDATE_HZ = 60;       // fixed simulation rate; drawing interpolates between two updates

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
/** The dream apartment's room id: its painting holds the furniture, and it has its own residents. */
const APARTMENT = 'apartment-room';
/** NPC emotes as the TV shows them. @type {Record<string, string>} */
const NPC_EMOTES = { joy: '😄', love: '❤️', surprise: '😮', anger: '💢' };

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

/** Every prop grid by prop kind (the party room's furniture, the story's props), also for the test that keeps
 *  them rectangular and inside their palette. */
export const PROP_PIXELS = { sofa: { grid: SOFA, pal: SOFA_PAL }, table: { grid: TABLE, pal: TABLE_PAL },
  plant: { grid: PLANT, pal: PLANT_PAL }, ...YOUNG_ADULT_PIXELS };

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

/**
 * @param {HTMLCanvasElement} bg @param {HTMLCanvasElement} fg
 * @param {ReturnType<typeof import('./avatar-layer.js').createAvatarLayer>} avatars
 */
export function createPartyRoom(bg, fg, avatars) {
  const bgCtx = /** @type {CanvasRenderingContext2D} */ (bg.getContext('2d'));
  const fgCtx = /** @type {CanvasRenderingContext2D} */ (fg.getContext('2d'));

  let geo = worldView(1, 1, 1);
  let visible = false;
  /** @type {import('../../shared/scene.js').Scene} */ let room = PARTY_ROOM;
  /** The painted background (the story's roomArt), or null: this file paints the room. @type {string | null} */
  let art = null;
  /** @type {import('../../shared/campaign/types.js').Zone[]} */ let zones = [];
  /** @type {{ x: number, y: number, icon: string }[]} */ let pickups = [];
  /** @type {Record<string, import('../../shared/campaign/types.js').Npc>} */ let npcs = {};
  /** @type {Map<string, HTMLImageElement>} */ const placeImages = new Map();
  /** @type {string[]} */ let hubPeople = [];
  /** @type {{id: string, icon: string}[]} */ let decorations = [];
  let frameNow = 0;                    // the timestamp of the frame being drawn (furniture effects)

  // ---- geometry ----

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = innerWidth, h = innerHeight;
    for (const c of [bg, fg]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    geo = worldView(w, h, dpr);
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

    const src = art;
    if (src) {
      rect(g, 0, 0, w, h, '#211528');
      let image = placeImages.get(src);
      if (!image) {
        image = new Image();
        image.onload = () => { if (visible && art === src) paintScene(); };
        image.src = src;
        placeImages.set(src, image);
      }
      if (image.complete && image.naturalWidth) g.drawImage(image, geo.ox, geo.oy, unit * WORLD.w, unit * WORLD.h);
      return;
    }

    paintWall(g, w, floorTop, p, Y);
    paintFloor(g, floorTop, w, h, p);
    paintWindow(g, X(SCENE.window.x0), X(SCENE.window.x1), Y(SCENE.window.top), floorTop - Y(SCENE.sill) + Y(0), p);
    if (room.id === APARTMENT) {
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
  /** A prop's own line after someone used it (`speaker: 'object'`): until when. @type {Map<string, { text: string, until: number }>} */
  const propSpeech = new Map();

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
      if (room.id === APARTMENT && prop.id === 'sofa') {
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

  /** prop.kind → art, from PROP_PIXELS. @type {import('./scene-render.js').PropArt} */
  const PROP_ART = Object.fromEntries(Object.entries(PROP_PIXELS).map(([kind, { grid, pal }]) => [kind, pixelProp(grid, pal)]));

  // ---- players, doors & object actions ----

  /** Campaign doors on the map screens (empty in the block lobby). @type {import('./doors.js').DoorView[]} */
  let doors = [];

  /** Hub / world map: the doors to draw (see doors.js). @param {import('./doors.js').DoorView[]} list */
  function setDoors(list) {
    doors = list;
  }

  /**
   * Who is in the room: a block State (lobby) or the campaign party (map screens) — same roster shape.
   * A fresh avatar starts at its spawn point in the current room.
   * @param {import('./avatar-layer.js').Roster} s
   */
  function setPlayers(s) {
    avatars.setPlayers(s, room);
  }

  /** @param {any} m a server-validated action at an object: the prop says its line, or the furniture moves and the
   *  player says the feedback */
  function onInteract(m) {
    if (typeof m.playerId !== 'string' || typeof m.object !== 'string') return;
    const now = performance.now();
    const feedback = typeof m.feedback === 'string' ? m.feedback : '';
    if (m.speaker === 'object') {
      if (feedback) propSpeech.set(m.object, { text: feedback, until: now + 4000 });
      return;
    }
    objectEffects.set(m.object, { started: now, until: now + 2800 });
    if (feedback) avatars.say(m.playerId, feedback.replace(/\n/g, ' '), 2000);
  }

  // ---- animation: the avatar layer's fixed-step simulation, interpolated drawing ----

  /** @param {number} alpha how far this frame sits between the last two updates @param {number} now */
  function draw(alpha, now) {
    frameNow = now;
    const g = fgCtx;
    g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    g.clearRect(0, 0, geo.w, geo.h);
    g.imageSmoothingEnabled = false;
    // a painted room has its doors in its painting
    if (!art) for (const d of doors) drawDoorway(g, d, now);
    for (const z of zones) drawZone(g, z, now);
    // The apartment's sofa and plants are painted into its background; the scene props remain
    // for collision and object interactions without drawing duplicate pixel furniture over them.
    avatars.draw(g, geo, alpha, now, room, room.id === APARTMENT ? {} : PROP_ART);
    if (room.id === APARTMENT) {
      drawCats(g, now);
      drawHubPeople(g, now);
      drawDecorations(g);
    }
    for (const p of pickups) drawPickup(g, p, now);
    drawNpcs(g, now);
  }

  /** NPC lines over their props: the story's (a dog barking every other few seconds, Toni's thanks) and a prop's
   *  answer after someone used it; their emotes above. @param {CanvasRenderingContext2D} g @param {number} now */
  function drawNpcs(g, now) {
    const bubble = (/** @type {number} */ x, /** @type {number} */ y, /** @type {string[]} */ lines) => {
      const size = Math.max(12, Math.round(geo.unit * 0.23));
      g.font = `bold ${size}px monospace`;
      const width = Math.max(...lines.map((line) => g.measureText(line).width)) + size;
      const height = lines.length * size * 1.3 + size * 0.5;
      const cx = geo.ox + x * geo.unit;
      const top = geo.oy + y * geo.unit - height;
      const left = Math.max(geo.ox + 5, Math.min(cx - width / 2, geo.ox + WORLD.w * geo.unit - width - 5));
      g.fillStyle = '#241c2b';
      g.fillRect(left - 3, top - 3, width + 6, height + 6);
      g.fillStyle = '#f8e8cf';
      g.fillRect(left, top, width, height);
      g.fillStyle = '#241c2b';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      lines.forEach((line, i) => g.fillText(line, left + width / 2, top + size * (i + 0.8) * 1.3));
    };
    for (const prop of room.props) {
      const spoken = propSpeech.get(prop.id);
      if (spoken && spoken.until <= now) propSpeech.delete(prop.id);
      const npc = npcs[prop.id];
      const line = spoken && spoken.until > now ? spoken.text
        : npc?.say && (!npc.blink || Math.floor(now / 3600) % 2 === 0) ? npc.say : null;
      const x = prop.box.x + prop.box.w / 2;
      if (line) bubble(x, prop.box.y - 0.1, line.split('\n'));
      const emote = npc?.emote ? NPC_EMOTES[npc.emote] ?? npc.emote : null;
      if (emote) {
        const { sx, sy } = toScreen(x, prop.box.y - (line ? 1.1 : 0.3));
        g.font = `${Math.round(geo.unit * 0.6)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.fillText(emote, sx, sy + Math.sin(now / 200) * geo.scale * 2);
      }
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
      const { sx, sy } = toScreen(3.2 + (index % 4) * 1.12, 1.8 + Math.floor(index / 4) * 1.05);
      const p = geo.scale;
      rect(g, sx - p * 8, sy - p * 7, p * 16, p * 14, '#6d4a38');
      rect(g, sx - p * 6, sy - p * 5, p * 12, p * 10, '#e9d9b3');
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${Math.round(geo.unit * 0.4)}px system-ui, sans-serif`;
      g.fillText(item.icon, sx, sy);
    });
  }

  /** A story zone, by its look (only 'portal' so far; a zone without a look is invisible).
   * @param {CanvasRenderingContext2D} g @param {import('../../shared/campaign/types.js').Zone} z @param {number} now */
  function drawZone(g, z, now) {
    if (z.look === 'portal') drawPortal(g, z, now);
  }

  /** @param {CanvasRenderingContext2D} g @param {{ x: number, y: number }} at @param {number} now */
  function drawPortal(g, at, now) {
    const { sx, sy } = toScreen(at.x, at.y);
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

  /** An item lying on the floor, bobbing, to pick up.
   * @param {CanvasRenderingContext2D} g @param {{ x: number, y: number, icon: string }} p @param {number} now */
  function drawPickup(g, p, now) {
    const { sx, sy } = toScreen(p.x, p.y);
    const bob = Math.sin(now / 250) * geo.scale * 2;
    g.font = `${Math.round(geo.unit * 0.55)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.fillText(p.icon, sx, sy - geo.unit * 0.3 + bob);
    g.font = `800 ${Math.round(geo.unit * 0.2)}px system-ui, sans-serif`;
    g.fillStyle = '#fff3d6'; g.fillText('PICK UP', sx, sy + geo.scale * 2);
  }

  const loop = createLoop(avatars.update, draw, UPDATE_HZ);

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
      loop.start();
    } else {
      loop.stop();
    }
  }

  /** @param {import('../../shared/scene.js').Scene} next a room from ROOMS, by roomAt */
  function setRoom(next) {
    if (room === next) return;
    room = next;
    if (visible) paintScene();
  }

  /** The painted background (the story's roomArt for this room now), or null. @param {string | null} src */
  function setArt(src) {
    if (art === src) return;
    art = src;
    if (visible) paintScene();
  }

  /** Forget the furniture effects (reconnect); the avatar layer resets its own. */
  function reset() {
    objectEffects.clear();
    propSpeech.clear();
  }

  addEventListener('resize', () => { if (visible) layout(); });

  return {
    setPlayers, setDoors, onInteract, setVisible, setRoom, setArt,
    setZones: (/** @type {import('../../shared/campaign/types.js').Zone[]} */ list) => { zones = list; },
    setPickups: (/** @type {{ x: number, y: number, icon: string }[]} */ list) => { pickups = list; },
    setNpcs: (/** @type {Record<string, import('../../shared/campaign/types.js').Npc>} */ map) => { npcs = map; },
    setHubPeople: (/** @type {string[]} */ people) => { hubPeople = people; },
    setDecorations: (/** @type {{id: string, icon: string}[]} */ items) => { decorations = items; },
    reset,
    /** Debug / tests: the doors drawn. */
    doors: () => doors.map((d) => ({ id: d.id, state: d.state, title: d.title })),
    /**
     * Debug / tests: the ids painted this frame, back to front — prop ids (sofa, table, plant) and
     * player ids interleaved. An avatar listed BEFORE a prop is drawn behind it.
     * @returns {string[]}
     */
    drawOrder: () => avatars.drawOrder(PARTY_ROOM),
    /** Debug / tests: the room's geometry (colliders and anchors), to assert against. */
    scene: () => ({
      id: PARTY_ROOM.id,
      floor: PARTY_ROOM.floor,
      solids: PARTY_ROOM.solids,
      props: PARTY_ROOM.props.map((p) => ({ id: p.id, anchorY: p.anchorY, layer: p.layer, solid: p.solid })),
    }),
  };
}
