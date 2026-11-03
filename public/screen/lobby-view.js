// Lobby: join QR + room code + URL, and 4 player slots filling live.

import { DEFAULT_SETTINGS } from '../../shared/game.js';
import { h, colorDot } from './dom.js';
import { mmss } from './clock.js';

const MAX_PLAYERS = 4;
const QR_SRC = '/api/join-qr.svg';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/game.js').Settings} Settings */

/**
 * How phones join. `code` / `qr` are null/false when the server has no join API (e.g. the mock).
 * @typedef {{ url: string, code: string | null, qr: boolean }} JoinInfo
 */

/** Fallback when /api/join is unavailable: same host/port as this page. @returns {JoinInfo} */
export function fallbackJoinInfo() {
  return { url: `http://${location.host}/play`, code: null, qr: false };
}

/**
 * Fetches the join info once (GET /api/join); falls back to the location-derived URL.
 * @returns {Promise<JoinInfo>}
 */
export async function fetchJoinInfo() {
  try {
    const res = await fetch('/api/join', { cache: 'no-store' });
    if (!res.ok) return fallbackJoinInfo();
    const body = /** @type {{ url?: unknown, code?: unknown }} */ (await res.json());
    if (typeof body.url !== 'string') return fallbackJoinInfo();
    return { url: body.url, code: typeof body.code === 'string' ? body.code : null, qr: true };
  } catch {
    return fallbackJoinInfo();
  }
}

/**
 * URL as people type it: the room code is shown separately, so the query string is dropped.
 * @param {string} url
 */
export function typedUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * One line describing the next game, e.g. "9×9 · timed 3:00 · simple set".
 * Size and mode always; the rest only when they differ from the defaults.
 * @param {Settings} st
 * @returns {string}
 */
export function settingsSummary(st) {
  const parts = [
    `${st.size}×${st.size}`,
    st.mode === 'timed' ? `timed ${mmss(st.timedSeconds)}` : 'marathon',
  ];
  if (st.pieceSet !== DEFAULT_SETTINGS.pieceSet) parts.push(`${st.pieceSet} set`);
  if (st.grace !== DEFAULT_SETTINGS.grace) parts.push(st.grace === 0 ? 'no combo grace' : `combo grace ${st.grace}`);
  if (st.cleanBoardBonus !== DEFAULT_SETTINGS.cleanBoardBonus) parts.push(`clean board +${st.cleanBoardBonus}`);
  return parts.join(' · ');
}

/** @type {HTMLImageElement | null} */
let qrImg = null;
let qrBroken = false;

/**
 * One <img> reused across renders: re-appending a node doesn't reload it (no flicker, no refetch).
 * @returns {HTMLImageElement | null} null once the QR failed to load
 */
function qrImage() {
  if (qrBroken) return null;
  if (!qrImg) {
    const img = /** @type {HTMLImageElement} */ (h('img', 'join-qr'));
    img.alt = 'QR code to join';
    img.addEventListener('error', () => { qrBroken = true; img.remove(); });
    img.src = QR_SRC;
    qrImg = img;
  }
  return qrImg;
}

/** @param {JoinInfo} join */
function renderJoin(join) {
  const info = h('div', 'join-info', [h('p', 'lobby-invite', ['Scan to join'])]);
  if (join.code) {
    info.append(h('p', 'join-label', ['Room code']), h('div', 'room-code', [join.code]));
  }
  info.append(h('p', 'join-label', [join.qr ? 'or open' : 'Open']), h('div', 'join-url', [typedUrl(join.url)]));

  const box = h('div', 'join');
  const img = join.qr ? qrImage() : null;
  if (img) {
    box.append(img);
  } else {
    info.querySelector('.lobby-invite')?.remove();
  }
  box.append(info);
  return box;
}

/**
 * @param {State} s
 * @param {State | null} prev  previous view: slots of players not in it pop in
 * @param {JoinInfo} join
 */
export function renderLobby(s, prev, join) {
  const known = new Set(prev?.phase === 'lobby' ? prev.order : s.order);
  const root = h('section', 'lobby', [h('h1', 'title', ['BLOKO']), renderJoin(join)]);

  const slots = h('div', 'slots');
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const id = s.order[i];
    const p = id ? s.players[id] : undefined;
    if (p) {
      const slot = h('div', 'slot slot-taken' + (known.has(id) ? '' : ' just-joined'), [colorDot(p.color), h('span', 'slot-name', [p.name])]);
      if (id === s.hostId) slot.append(h('span', 'host-badge', ['host']));
      slots.append(slot);
    } else {
      slots.append(h('div', 'slot slot-empty', ['Waiting…']));
    }
  }
  root.append(h('p', 'settings-line', [settingsSummary(s.settings)]), slots);

  const n = s.order.length;
  root.append(h('p', 'lobby-count', [`${n}/${MAX_PLAYERS} player${n === 1 ? '' : 's'}`
    + (n > 0 ? ' · the host starts the game from their phone' : '')]));
  return root;
}
