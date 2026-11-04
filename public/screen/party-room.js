// M3 party room: the lobby scene with every joined guest's avatar walking on the TV.
// Positions are EPHEMERAL (`pos` messages, see PROTOCOL.md); the joined players come from the
// last `view`. A pos (x, y) is the avatar's feet, in world units (WORLD = 16 × 9).
// Two fixed canvases: #party-bg (scene, under the lobby UI) and #party-fg (avatars, above it).

import { drawSprite, SPRITE_SIZE } from '../../shared/sprites.js';
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
const WALK_FPS = 6;         // walk frame flips per second
const STALE_MS = 400;       // no update for this long → idle frame
const EASE_PER_S = 14;      // interpolation speed (higher = snappier)
const ARRIVED = 0.04;       // units: closer than this counts as standing still
const DIRS = new Set(['up', 'down', 'left', 'right']);
const FALLBACK_CHARACTERS = Object.keys(CHARACTERS); // by colour, for players without a character

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

  // ---- static scene ----

  function paintScene() {
    const g = bgCtx;
    const { unit, w, h, dpr, scale } = geo;
    const px = scale; // one "art pixel", same grid as the sprites
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;

    const floorTop = Math.round(geo.oy + 4.6 * unit);
    // wall
    g.fillStyle = '#2a2140';
    g.fillRect(0, 0, w, floorTop);
    g.fillStyle = '#31274b';
    for (let x = 0; x < w; x += px * 8) g.fillRect(x, 0, px * 4, floorTop); // soft wallpaper stripes
    // floor planks
    const plank = Math.round(unit / 2);
    for (let y = floorTop, i = 0; y < h; y += plank, i++) {
      g.fillStyle = i % 2 ? '#7a4e33' : '#86573a';
      g.fillRect(0, y, w, plank);
      g.fillStyle = '#5e3b26';
      g.fillRect(0, y, w, px);
      for (let x = ((i * 3) % 5) * unit; x < w; x += unit * 2.5) g.fillRect(Math.round(x), y, px, plank);
    }
    // skirting board
    g.fillStyle = '#1c1630';
    g.fillRect(0, floorTop - px * 2, w, px * 2);
    // bunting garland along the top
    const colors = ['#e4572e', '#3b8ea5', '#f3a712', '#9b5de5', '#ff5fa2'];
    g.fillStyle = '#d9d2c3';
    g.fillRect(0, Math.round(px * 3), w, px);
    for (let x = 0, i = 0; x < w; x += px * 10, i++) {
      g.fillStyle = colors[i % colors.length];
      for (let r = 0; r < 6; r++) g.fillRect(x + r * px, px * 4 + r * px, (12 - 2 * r) * px, px);
    }
    // balloon bunches tied in the bottom corners (the wall is taken by the join panels)
    balloon(g, geo.ox + 0.55 * unit, geo.oy + 6.7 * unit, '#ff5fa2', px);
    balloon(g, geo.ox + 1.15 * unit, geo.oy + 7.1 * unit, '#ffd23f', px);
    balloon(g, geo.ox + 15.45 * unit, geo.oy + 6.7 * unit, '#3b8ea5', px);
    balloon(g, geo.ox + 14.85 * unit, geo.oy + 7.1 * unit, '#9b5de5', px);
  }

  /** @param {CanvasRenderingContext2D} g @param {number} cx @param {number} cy @param {string} color @param {number} px */
  function balloon(g, cx, cy, color, px) {
    const rows = [2, 4, 5, 5, 5, 4, 2];
    g.fillStyle = color;
    rows.forEach((half, r) => g.fillRect(Math.round(cx - half * px), Math.round(cy + (r - 3) * px * 2), half * 2 * px, px * 2));
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(Math.round(cx - 3 * px), Math.round(cy - 4 * px), px * 2, px * 2);
    g.fillStyle = '#d9d2c3';
    g.fillRect(Math.round(cx), Math.round(cy + 8 * px), px, px * 18);
  }

  // ---- players & positions ----

  /** @param {State} s */
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
        const spawn = spawnPoint(p.character ?? null);
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
    const walkFrame = 1 + (Math.floor((now / 1000) * WALK_FPS) % 2);
    const list = [...avatars.values()];
    for (const a of list) {
      a.x += (a.tx - a.x) * k;
      a.y += (a.ty - a.y) * k;
    }
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
    drawSprite(g, a.character, a.dir, spriteFrame, left, top, scale);
    label(g, a, sx, Math.min(geo.h - unit * 0.3, sy + scale * 2));
  }

  /** @param {CanvasRenderingContext2D} g @param {Avatar} a @param {number} cx @param {number} top */
  function label(g, a, cx, top) {
    const fontPx = Math.round(geo.unit * 0.26);
    g.font = `800 ${fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    const h = fontPx * 1.35;
    const pad = h * 0.45, dot = h * 0.4, gap = h * 0.3;
    const w = pad + dot + gap + g.measureText(a.name).width + pad;
    const margin = geo.unit * 0.1;
    const x0 = Math.min(geo.w - margin - w, Math.max(margin, cx - w / 2));
    g.fillStyle = 'rgba(12, 14, 18, 0.78)';
    g.beginPath();
    g.roundRect(x0, top, w, h, h / 2);
    g.fill();
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--p${a.color}`).trim() || '#fff';
    g.fillRect(x0 + pad, top + (h - dot) / 2, dot, dot);
    g.fillStyle = '#ffffff';
    g.fillText(a.name, x0 + pad + dot + gap, top + fontPx * 0.17);
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

  addEventListener('resize', () => { if (visible) layout(); });

  return {
    setPlayers, onPos, setVisible,
    /** Debug / tests: the drawn state of every avatar. */
    snapshot: () => [...avatars.values()].map((a) => ({ id: a.id, name: a.name, character: a.character, x: a.x, y: a.y, dir: a.dir, walking: isWalking(a, performance.now()) })),
  };
}
