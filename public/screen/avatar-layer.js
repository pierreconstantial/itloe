// The avatar layer: every player's walking character on the TV, whatever screen is showing.
// One layer for the whole page: `pos`, `say` and `emote` reach it at every moment, and the screen
// that is showing draws it — a room with its props (avatars and props in one depth-sorted list,
// see ./scene-render.js), or a scene without furniture (the wisp overlay over a running round), where
// the avatars are drawn on top, only those of the players it names.
// Positions are EPHEMERAL (`pos` messages, see PROTOCOL.md); the players come from the last `view`.
// A pos (x, y) is the avatar's feet, in world units (WORLD = 16 × 9).
//
// The layer has no canvas and no loop of its own: the screen calls update(dt) from its loop's fixed
// step and draw(…) from its frame, on its own canvas, with the projection from worldView().

import { drawSprite, SPRITE_SIZE, WALK_FRAMES, WALK_FPS } from '../../shared/sprites.js';
import { WORLD } from '../../shared/world.js';
import { spawnAt } from '../../shared/scene.js';
import { isEmote } from '../../shared/social.js';
import { makeView, renderScene, drawOrder, lerp } from './scene-render.js';
import { drawWisp } from './wisp.js';

/** @typedef {import('../../shared/world.js').Dir} Dir */
/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** @typedef {import('../../shared/scene.js').Scene} Scene */
/** @typedef {import('./scene-render.js').View} View */
/** @typedef {import('./scene-render.js').PropArt} PropArt */
/** @typedef {{ playerId: string, x: number, y: number, dir: Dir, moving: boolean }} PosMsg */
/**
 * @typedef {{
 *   id: string, name: string, color: number, character: string, statuses: string[],
 *   x: number, y: number,      // simulated position (eased towards the target, fixed timestep)
 *   px: number, py: number,    // the same, one update earlier — drawing interpolates between them
 *   tx: number, ty: number,    // last reported position
 *   dir: Dir, moving: boolean, lastPosAt: number, lastActiveAt: number, jumpStartedAt: number,
 * }} Avatar
 */
/** A speech bubble (`text`) or an emote (`kind`) over an avatar. @typedef {{text?: string, kind?: string, until: number, started: number}} Expression */
/** Who is shown: same roster shape as the campaign party. @typedef {{ order: string[], players: Record<string, { name: string, color: number, character: CharacterId, left?: boolean, statuses?: string[] }> }} Roster */

const AVATAR_UNITS = 1.2;   // avatar height in world units
const OFFLINE_ALPHA = 0.4;  // a dropped player's avatar fades (presence.js decides when)
const STALE_MS = 400;       // no update for this long → idle frame
const IDLE_MS = 10_000;     // a character's own activity starts after ten quiet seconds
const JUMP_MS = 650;
const EASE_PER_S = 14;      // interpolation speed (higher = snappier)
const ARRIVED = 0.04;       // units: closer than this counts as standing still
const SAY_MS = 5500;        // how long a speech bubble stays
const EMOTE_MS = 2200;      // how long an emote plays
const DIRS = new Set(['up', 'down', 'left', 'right']);
const IDLE_ART = Object.freeze({
  anna: { icon: '♫', label: 'Dancing' },
  sol: { icon: '🎮', label: 'Playing games' },
  pierre: { icon: '✏️', label: 'Drawing' },
  konz: { icon: '⛰️', label: 'Dreaming of mountains' },
  elodie: { icon: '📖', label: 'Reading' },
  nico: { icon: '💕', label: 'Handsome guys' },
});

/**
 * The world-to-screen projection of the TV: the 16 × 9 world letterboxed into a `w × h` CSS-pixel
 * canvas, on the avatars' art-pixel grid (rooms paint their art on the same grid).
 * @param {number} w @param {number} h @param {number} dpr @returns {View}
 */
export function worldView(w, h, dpr) {
  return makeView(w, h, dpr, WORLD, AVATAR_UNITS, SPRITE_SIZE);
}

export function createAvatarLayer() {
  /** @type {Map<string, Avatar>} */
  const avatars = new Map();
  /** Last pos per player, kept even before the player shows up in a view. @type {Map<string, PosMsg & { at: number }>} */
  const lastPos = new Map();
  /** @type {Map<string, Expression>} */
  const expressions = new Map();
  /** @type {Set<string>} */
  let offline = new Set();
  let frameNow = 0;                    // the timestamp of the frame being drawn (walk cycle, expressions)
  let frameAlpha = 0;                  // …and how far it sits between the last two updates
  /** Reused between frames so a steady screen allocates nothing. @type {import('./scene-render.js').Item[]} */
  const drawList = [];

  // ---- players & positions ----

  /** Players shown offline (debounced by presence.js): their avatar is dimmed and tagged. @param {Set<string>} ids */
  function setOffline(ids) {
    offline = ids;
  }

  /**
   * Who is shown: a roster in the campaign party's shape. A player without a known position starts
   * at their spawn point in `scene`, nudged out of its props.
   * @param {Roster} s @param {Scene} scene
   */
  function setPlayers(s, scene) {
    const present = new Set();
    for (const id of s.order) {
      const p = s.players[id];
      if (!p || /** @type {{ left?: boolean }} */ (p).left) continue;
      present.add(id);
      const character = p.character;
      let a = avatars.get(id);
      if (!a) {
        // a fresh avatar starts on walkable floor: the shared spawn point, nudged out of a prop
        const spawn = spawnAt(scene, character);
        const known = lastPos.get(id);
        const start = known ?? { x: spawn.x, y: spawn.y, dir: spawn.dir, moving: false, at: 0 };
        a = {
          id, name: p.name, color: p.color, character, statuses: p.statuses ?? [],
          x: start.x, y: start.y, px: start.x, py: start.y, tx: start.x, ty: start.y,
          dir: start.dir, moving: start.moving, lastPosAt: start.at, lastActiveAt: performance.now(), jumpStartedAt: -Infinity,
        };
        avatars.set(id, a);
      }
      a.name = p.name;
      a.color = p.color;
      a.character = character;
      if (p.statuses) a.statuses = p.statuses;
    }
    for (const id of avatars.keys()) if (!present.has(id)) avatars.delete(id);
    for (const id of lastPos.keys()) if (!s.players[id]) lastPos.delete(id);
  }

  /** The campaign party remains authoritative when a round's view omits statuses.
   * @param {Record<string, {statuses: string[]}>} members */
  function setStatuses(members) {
    for (const [id, a] of avatars) a.statuses = members[id]?.statuses ?? [];
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
    if (p.moving || p.x !== a.tx || p.y !== a.ty || p.dir !== a.dir) a.lastActiveAt = now;
    a.tx = p.x; a.ty = p.y; a.dir = p.dir; a.moving = p.moving; a.lastPosAt = now;
  }

  /** A short visual hop; feet stay at the same world position, so doors and collisions do not change. */
  /** @param {unknown} m */
  function onJump(m) {
    const id = /** @type {{playerId?: unknown}} */ (m)?.playerId;
    if (typeof id !== 'string') return;
    const a = avatars.get(id);
    if (!a || a.statuses.includes('wisp')) return;
    a.jumpStartedAt = a.lastActiveAt = performance.now();
  }

  /** A speech bubble over a player's avatar. @param {string} playerId @param {string} text @param {number} [ms] */
  function say(playerId, text, ms = SAY_MS) {
    const now = performance.now();
    const a = avatars.get(playerId);
    if (a) a.lastActiveAt = now;
    expressions.set(playerId, { text, started: now, until: now + ms });
  }

  /** An emote played by a player's avatar. @param {string} playerId @param {string} kind one of EMOTES in shared/social.js */
  function emote(playerId, kind) {
    const now = performance.now();
    const a = avatars.get(playerId);
    if (a) a.lastActiveAt = now;
    expressions.set(playerId, { kind, started: now, until: now + EMOTE_MS });
  }

  /** @param {any} m a `say` or `emote` message from the server */
  function onSocial(m) {
    if (typeof m.playerId !== 'string') return;
    if (m.t === 'say' && typeof m.text === 'string' && !avatars.get(m.playerId)?.statuses.includes('wisp')) say(m.playerId, m.text);
    else if (m.t === 'emote' && isEmote(m.kind)) emote(m.playerId, m.kind);
  }

  /** Forget every avatar and position (reconnect): the next view and pos snapshot rebuild them. */
  function reset() {
    avatars.clear();
    lastPos.clear();
    expressions.clear();
  }

  /** Every avatar stands at its last reported position at once, without walking there (back in the room
   *  after a round). */
  function settle() {
    for (const a of avatars.values()) {
      a.x = a.px = a.tx;
      a.y = a.py = a.ty;
    }
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

  /** Reused between frames, like drawList. @type {Avatar[]} */
  const onlyList = [];
  /** The avatars drawn: every one, or only those of the players in `only`. @param {readonly string[]} [only] */
  function shown(only) {
    if (!only) return avatars.values();
    onlyList.length = 0;
    for (const id of only) {
      const a = avatars.get(id);
      if (a) onlyList.push(a);
    }
    return onlyList;
  }

  /**
   * Draws the avatars into `scene`: a room's props through `art`, sorted with the avatars by
   * baseline; a scene without props draws the avatars on top of what is already there.
   * @param {CanvasRenderingContext2D} g @param {View} v
   * @param {number} alpha how far this frame sits between the last two updates @param {number} now
   * @param {Scene} scene @param {PropArt} [art]
   * @param {readonly string[]} [only] only these players' avatars (the wisps); every one without it
   */
  function draw(g, v, alpha, now, scene, art = {}, only) {
    frameNow = now;
    frameAlpha = alpha;
    renderScene(g, scene, shown(only), art, drawActor, v, drawList);
  }

  /** The engine's actor hook: an avatar, at the interpolated position, on its walk frame. */
  /** @param {CanvasRenderingContext2D} g @param {any} a @param {View} v */
  function drawActor(g, a, v) {
    if (/** @type {Avatar} */ (a).statuses.includes('wisp')) {
      drawWispAvatar(g, /** @type {Avatar} */ (a), v);
      return;
    }
    const walk = WALK_FRAMES[Math.floor((frameNow / 1000) * WALK_FPS) % WALK_FRAMES.length];
    drawAvatar(g, /** @type {Avatar} */ (a), isWalking(a, frameNow) ? walk : 0, v);
  }

  /** @param {Avatar} a @param {number} now */
  function isWalking(a, now) {
    const fresh = now - a.lastPosAt < STALE_MS;
    const travelling = Math.hypot(a.tx - a.x, a.ty - a.y) > ARRIVED;
    return fresh && (a.moving || travelling); // updates stopped → idle, however far the easing got
  }

  /** @param {Avatar} a @param {number} now */
  function isIdle(a, now) {
    return !offline.has(a.id) && !isWalking(a, now) && now - a.lastActiveAt >= IDLE_MS
      && (expressions.get(a.id)?.until ?? 0) <= now;
  }

  /** @param {CanvasRenderingContext2D} g @param {Avatar} a @param {number} spriteFrame @param {View} v */
  function drawAvatar(g, a, spriteFrame, v) {
    const { scale, unit } = v;
    const size = SPRITE_SIZE * scale;
    // keep the whole sprite on screen even at the world's edges
    const x = Math.min(WORLD.w - 0.5, Math.max(0.5, lerp(a.px, a.x, frameAlpha)));
    const y = Math.min(WORLD.h, Math.max(AVATAR_UNITS, lerp(a.py, a.y, frameAlpha)));
    const sx = v.ox + x * unit, sy = v.oy + y * unit;
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
    const idle = isIdle(a, frameNow);
    if (off) g.globalAlpha = OFFLINE_ALPHA;
    const elapsed = active ? frameNow - active.started : 0;
    g.save();
    const jumpAge = frameNow - a.jumpStartedAt;
    if (jumpAge >= 0 && jumpAge < JUMP_MS) g.translate(0, -Math.sin(Math.PI * jumpAge / JUMP_MS) * scale * 5);
    if (idle && a.character === 'anna') {
      g.translate(Math.sin(frameNow / 180) * scale, -Math.abs(Math.sin(frameNow / 230)) * scale * 2);
    } else if (idle && a.character === 'konz') {
      g.translate(Math.sin(frameNow / 260) * scale, 0);
    } else if (active?.kind === 'victory') {
      g.translate(0, -Math.abs(Math.sin(elapsed / 100)) * scale * 2);
    } else if (active?.kind === 'annoy') {
      g.translate(Math.sin(elapsed / 35) * scale, 0);
    }
    drawSprite(g, a.character, a.dir, spriteFrame, left, top, scale);
    g.restore();
    g.globalAlpha = 1;
    if (active) drawExpression(g, active, sx, top, size, v, elapsed);
    else if (idle) drawIdleArt(g, a.character, sx, top, size, v);
    label(g, a, sx, Math.min(v.h - unit * 0.3, sy + scale * 2), off, v);
  }

  /** A small comic bubble keeps each quiet character's activity legible on a TV. */
  /** @param {CanvasRenderingContext2D} g @param {string} character
   * @param {number} sx @param {number} top @param {number} size @param {View} v */
  function drawIdleArt(g, character, sx, top, size, v) {
    const art = IDLE_ART[/** @type {keyof typeof IDLE_ART} */ (character)];
    if (!art) return;
    const font = Math.max(15, Math.round(v.unit * 0.19));
    const icon = character === 'nico' ? '👨  👨' : character === 'konz' ? '🚶 ⛰️' : art.icon;
    g.save();
    g.font = `700 ${font}px system-ui, sans-serif`;
    const width = Math.max(g.measureText(art.label).width, g.measureText(icon).width) + font * 1.15;
    const height = font * 2.65;
    const x = Math.max(5, Math.min(v.w - width - 5, sx + size * 0.18));
    const y = Math.max(5, top - height - v.scale * 2 + Math.sin(frameNow / 380) * v.scale * 0.5);
    g.fillStyle = '#fff9ee';
    g.strokeStyle = '#24202b';
    g.lineWidth = Math.max(2, v.scale * 0.7);
    g.beginPath();
    g.roundRect(x, y, width, height, font * 0.45);
    g.fill(); g.stroke();
    g.fillStyle = '#201b29';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${font * 1.15}px system-ui, sans-serif`;
    g.fillText(icon, x + width / 2, y + font * 0.75);
    g.font = `700 ${font * 0.72}px system-ui, sans-serif`;
    g.fillText(art.label, x + width / 2, y + font * 1.95);
    g.restore();
  }

  /** @param {CanvasRenderingContext2D} g @param {Avatar} a @param {View} v */
  function drawWispAvatar(g, a, v) {
    const x = Math.min(WORLD.w - 0.5, Math.max(0.5, lerp(a.px, a.x, frameAlpha)));
    const y = Math.min(WORLD.h - 0.2, Math.max(0.6, lerp(a.py, a.y, frameAlpha)));
    const sx = v.ox + x * v.unit, sy = v.oy + y * v.unit;
    const expression = expressions.get(a.id);
    const active = !!expression && expression.until > frameNow;
    if (expression && !active) expressions.delete(a.id);
    const tints = ['#f6d77c', '#ffe7a8', '#a9e9ff', '#ffc5ef', '#cbb9ff', '#9dffc0', '#ffd2db', '#f3e0b8'];
    const tint = tints[(a.color - 1) % tints.length];
    if (offline.has(a.id)) g.globalAlpha = OFFLINE_ALPHA;
    drawWisp(g, sx, sy, v.unit, frameNow, active, tint, isWalking(a, frameNow));
    g.globalAlpha = 1;
  }

  /** Comic style accents and speech, anchored to the avatar rather than a screen corner. */
  /** @param {CanvasRenderingContext2D} g @param {{text?: string, kind?: string}} expression
   * @param {number} sx @param {number} top @param {number} size @param {View} v @param {number} elapsed */
  function drawExpression(g, expression, sx, top, size, v, elapsed) {
    const { scale } = v;
    if (expression.text) {
      const font = Math.max(18, Math.round(v.unit * 0.25));
      g.font = `800 ${font}px system-ui, sans-serif`;
      const maxWidth = Math.min(v.w * 0.26, v.unit * 3.8);
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
      const width = Math.min(v.w - 16, Math.max(...lines.map((line) => g.measureText(line).width)) + pad * 2);
      const height = lines.length * lineH + pad * 1.4;
      const x = Math.max(8, Math.min(v.w - width - 8, sx + size * 0.24));
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
    const font = Math.max(26, Math.round(v.unit * 0.55));
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

  /** @param {CanvasRenderingContext2D} g @param {Avatar} a @param {number} cx @param {number} top @param {boolean} off @param {View} v */
  function label(g, a, cx, top, off, v) {
    const text = off ? `${a.name} · 📵 offline` : a.name;
    const fontPx = Math.round(v.unit * 0.26);
    g.font = `800 ${fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    const h = fontPx * 1.35;
    const pad = h * 0.45, dot = h * 0.4, gap = h * 0.3;
    const w = pad + dot + gap + g.measureText(text).width + pad;
    const margin = v.unit * 0.1;
    const x0 = Math.min(v.w - margin - w, Math.max(margin, cx - w / 2));
    g.fillStyle = 'rgba(12, 14, 18, 0.78)';
    g.beginPath();
    g.roundRect(x0, top, w, h, h / 2);
    g.fill();
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(`--p${a.color}`).trim() || '#fff';
    g.fillRect(x0 + pad, top + (h - dot) / 2, dot, dot);
    g.fillStyle = off ? '#b9bcc4' : '#ffffff';
    g.fillText(text, x0 + pad + dot + gap, top + fontPx * 0.17);
  }

  return {
    setPlayers, setStatuses, setOffline, onPos, onJump, onSocial, say, emote, reset, settle, update, draw,
    /**
     * Debug / tests: the ids `draw` paints into `scene`, back to front — prop ids and player ids
     * interleaved. An avatar listed BEFORE a prop is drawn behind it.
     * @param {Scene} scene @param {readonly string[]} [only] @returns {string[]}
     */
    drawOrder: (scene, only) => drawOrder(scene, shown(only)),
    /** Debug / tests: the drawn state of every avatar. */
    snapshot: (now = performance.now()) => [...avatars.values()].map((a) => ({ id: a.id, name: a.name, character: a.character, statuses: a.statuses, x: a.x, y: a.y, dir: a.dir, walking: isWalking(a, now), idle: isIdle(a, now), jumping: now - a.jumpStartedAt < JUMP_MS, offline: offline.has(a.id) })),
  };
}
