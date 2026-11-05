// Lobby: join QR + room code + URL, and the guest count filling live.

import { h, colorDot } from './dom.js';
import { ROSTER_SIZE } from '../../shared/characters.js';

/** The game holds one player per character: the roster is the cap (the server refuses a join
 *  only once every character is held). */
const MAX_PLAYERS = ROSTER_SIZE;
const QR_SRC = '/api/join-qr.svg';

/** @typedef {import('../../shared/game.js').State} State */

/**
 * How phones join. `code` / `qr` are null/false when /api/join is unavailable.
 * @typedef {{ url: string, code: string | null, qr: boolean }} JoinInfo
 */

/** Fallback when /api/join is unavailable: same host/port as this page. @returns {JoinInfo} */
export function fallbackJoinInfo() {
  return { url: `${location.origin}/play`, code: null, qr: false };
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
 * Keep the access token in hosted invitations; the room code is shown separately.
 * @param {string} url
 */
export function typedUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('room');
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
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
 * Party-room lobby: a top band (join box + title, next-game settings, status); the guests
 * themselves are the avatars walking below it (party-room.js), so there are no slot cards.
 * Every minigame's tableau shows the same band with its own title and settings line.
 * @param {Pick<State, 'order'> & { players: Record<string, { name: string, color: number }> }} s
 * @param {unknown} _prev
 * @param {JoinInfo} join
 * @param {{ title: string, settings: string }} band the minigame's title and the tableau's settings, summarized
 * @param {{ hostId: string | null, required?: number, status?: string }} options hostId: the party's host;
 *   required: the guests a round needs; status: replaces the guest count when no round starts here
 */
export function renderLobby(s, _prev, join, band, options) {
  const n = s.order.length;
  const max = options.required ?? MAX_PLAYERS;
  const host = options.hostId ? s.players[options.hostId] : undefined;
  const status = options.status ?? (n === 0
    ? 'Waiting for the first guest…'
    : `${n}/${max} guest${n === 1 ? '' : 's'}${host ? ` · ${host.name} starts the game from their phone` : ''}`);
  const side = h('div', 'lobby-side', [
    h('h1', 'title', [band.title]),
    h('p', 'settings-line', [band.settings]),
    h('p', 'lobby-count', [status]),
  ]);
  if (host && !options.status) side.querySelector('.lobby-count')?.prepend(colorDot(host.color), ' ');
  return h('section', 'lobby', [renderJoin(join), side]);
}
