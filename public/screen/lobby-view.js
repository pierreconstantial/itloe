// The room at a tableau's band (the file keeps its old name): join QR + room code + URL, the minigame waiting
// here, and the guest count filling live.

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
 * Fetches the join info (GET /api/join); falls back to the location-derived URL.
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
 * A new room code (a fresh evening) loads the new QR.
 * @param {string | null} code
 * @returns {HTMLImageElement | null} null once the QR failed to load
 */
function qrImage(code) {
  if (qrBroken) return null;
  if (!qrImg) {
    const img = /** @type {HTMLImageElement} */ (h('img', 'join-qr'));
    img.alt = 'QR code to join';
    img.addEventListener('error', () => { qrBroken = true; img.remove(); });
    qrImg = img;
  }
  if (qrImg.dataset.code !== (code ?? '')) {
    qrImg.src = code ? `${QR_SRC}?room=${encodeURIComponent(code)}` : QR_SRC;
    qrImg.dataset.code = code ?? '';
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
  const img = join.qr ? qrImage(join.code) : null;
  if (img) {
    box.append(img);
  } else {
    info.querySelector('.lobby-invite')?.remove();
  }
  box.append(info);
  return box;
}

/**
 * The room at a tableau: a top band (join box + the minigame's title, status); the guests themselves are the
 * avatars walking below it (party-room.js), so there are no slot cards. Every minigame's tableau shows the
 * same band with its own title.
 * @param {Pick<State, 'order'> & { players: Record<string, { name: string, color: number }> }} s
 * @param {unknown} _prev
 * @param {JoinInfo} join
 * @param {{ title: string, name: string }} band the minigame's title, and its name in a sentence
 * @param {{ gameMasterId: string | null, status?: string }} options gameMasterId: who starts the minigame;
 *   status: replaces the guest count
 */
export function renderLobby(s, _prev, join, band, options) {
  const n = s.order.length;
  const gm = options.gameMasterId ? s.players[options.gameMasterId] : undefined;
  const status = options.status ?? (n === 0
    ? 'Waiting for the first guest…'
    : `${n}/${MAX_PLAYERS} guest${n === 1 ? '' : 's'}${gm ? ` · ${gm.name} starts the ${band.name} from their phone` : ''}`);
  const side = h('div', 'lobby-side', [
    h('h1', 'title', [band.title]),
    h('p', 'lobby-count', [status]),
  ]);
  if (gm && !options.status) side.querySelector('.lobby-count')?.prepend(colorDot(gm.color), ' ');
  return h('section', 'lobby', [renderJoin(join), side]);
}
