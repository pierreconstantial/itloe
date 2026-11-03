// P3 — phone client /play. Renders strictly from the last `view` (PROTOCOL.md);
// the only optimistic paint (local placement) is reconciled by the next `view`/`err`.
// Path ../../shared: resolved on disk by tsc, normalized to /shared/ by the browser.
import { canPlace, place, findClears, applyClears } from '../../shared/board.js';
import { PIECES } from '../../shared/pieces.js';
import { ranking } from '../../shared/game.js';
import { KEYS, load, save, forget } from './storage.js';
import { $, bounds, pieceEl, dotEl, toast } from './dom.js';
import * as haptics from './haptics.js';
import { initMenu } from './menu.js';
import { syncClock, secondsLeft, mmss } from './clock.js';
import { createSettingsSheet, summarize } from './settings-ui.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/game.js').Player} Player */
/** @typedef {import('../../shared/pieces.js').PieceId} PieceId */
/** @typedef {{ score: number, previous: number | null }} Best */

const RANK_BADGES = ['①', '②', '③', '④'];
const MEDALS = ['🥇', '🥈', '🥉', ''];
const GAP = 2; // px between cells, = the `gap` value in play-base.css
const TRAY_CELL = 13; // px per cell for tray miniatures
const LIFT = 1.5; // the dragged piece floats this many cells above the finger
const URGENT_SECONDS = 10; // the countdown turns red from here
const CLOCK_TICK_MS = 250;

/** @type {Record<string, string>} */
const ERR_TOASTS = {
  locked: 'Settings are locked while a game is on.',
  'not-host': 'Only the host can do that.',
};

// ---------- pure helpers ----------

/** @param {number} rank 1-based @returns {string} */
function ordinal(rank) {
  return rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`;
}

/** @param {State} v @param {string} id @returns {number} 1-based, shared with ties */
function rankOf(v, id) {
  return ranking(v).find((r) => r.id === id)?.rank ?? v.order.length;
}

/** Room codes are typed loosely on phones: "ab cd" → "ABCD". @param {string} raw */
function normalizeRoom(raw) {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/**
 * End-of-run event this view brings to the player, for haptics.
 * @param {State} prev @param {State} next @param {string} id
 * @returns {'win' | 'bell' | 'death' | null}
 */
function outcome(prev, next, id) {
  const before = prev.players[id];
  const after = next.players[id];
  if (!before || !after) return null;
  const justFinished = prev.phase === 'playing' && next.phase === 'finished';
  if (justFinished && next.order.length > 1 && rankOf(next, id) === 1) return 'win';
  if (justFinished && next.endReason === 'time' && !before.done) return 'bell';
  if (!before.done && after.done) return 'death';
  return null;
}

// ---------- client state ----------

/** @type {State | null} */ let lastView = null;
/** Solo record for the current (size, mode), sent with views in solo games. @type {Best | null} */
let lastBest = null;
/** @type {string | null} */ let playerId = load(KEYS.id);
/** @type {WebSocket | null} */ let ws = null;
/** Placement sent but not yet confirmed: simulated board + tray slot hidden.
 * @type {{ index: number, board: number[] } | null} */
let pending = null;

/** Room code: the join URL's ?room= wins over the stored one (the TV may show a new code). */
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) save(KEYS.room, normalizeRoom(urlRoom));
/** @type {string | null} */ let room = load(KEYS.room);
/** The server refused our join for the room code: ask for it, then join with this name. */
let roomPrompt = /** @type {{ name: string, retried: boolean } | null} */ (null);
/** Name typed on the name screen, kept for the join that follows a room prompt. */
let wantedName = '';

/** @type {{
 *   pointerId: number, index: number, pieceId: PieceId,
 *   cells: [number, number][], w: number, h: number,
 *   el: HTMLElement, gx: number, gy: number, valid: boolean
 * } | null} */
let drag = null;

/** Board cell elements, rebuilt on every render. @type {HTMLElement[]} */
let cellEls = [];

// ---------- connection ----------

function helloMsg() {
  return {
    t: 'hello', role: 'player',
    ...(room ? { room } : {}),
    ...(playerId ? { playerId } : {}),
  };
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.addEventListener('open', () => {
    $('conn-banner').hidden = true;
    send(helloMsg());
  });
  sock.addEventListener('message', (ev) => receive(String(ev.data)));
  sock.addEventListener('close', () => {
    if (ws !== sock) return;
    $('conn-banner').hidden = false;
    setTimeout(connect, 1000);
  });
}

/** Drop the socket on purpose (no reconnect banner) and open a fresh one. */
function reconnect() {
  const old = ws;
  ws = null;
  old?.close();
  connect();
}

/** @param {unknown} msg */
function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** @param {string} raw */
function receive(raw) {
  /** @type {any} */ let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (m.t === 'welcome' && typeof m.playerId === 'string') {
    playerId = m.playerId;
    roomPrompt = null;
    save(KEYS.id, m.playerId);
    render();
  } else if (m.t === 'view') {
    syncClock(m.now);
    const prev = lastView;
    lastView = m.state;
    lastBest = m.best ?? null;
    pending = null;
    const event = prev && playerId ? outcome(prev, m.state, playerId) : null;
    if (event) haptics.buzz(event);
    render();
  } else if (m.t === 'err') {
    pending = null;
    if (m.code === 'full') showNameError('Sorry, the game is full (4 players max).');
    else if (m.code === 'bad-room') roomPrompt = { name: wantedName, retried: roomPrompt !== null };
    else if (ERR_TOASTS[m.code]) toast(ERR_TOASTS[m.code]);
    render(); // bad-place and friends: repaint from the last view
  }
}

/** Tell the server, forget this phone's player and come back as a stranger. */
function leaveGame() {
  send({ t: 'leave' });
  forget(KEYS.id);
  playerId = null;
  if (drag) endDrag();
  pending = null;
  reconnect();
  render();
}

// ---------- rendering ----------

const VIEWS = ['loading', 'name', 'room', 'waiting', 'lobby', 'game', 'over', 'podium'];

/** @param {string} name */
function show(name) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
}

function render() {
  menu.refresh();
  const v = lastView;
  if (!v) { show('loading'); return; }
  const me = playerId ? v.players[playerId] ?? null : null;
  const isHost = me !== null && me.id === v.hostId;
  const configurable = v.phase !== 'playing';

  settingsSheet.render(v.settings, isHost && configurable);
  if (!isHost || !configurable) menu.close('settings');
  updateClock();

  // the piece being dragged left our hand → the drag is stale
  if (drag && (!me || me.hand[drag.index] !== drag.pieceId)) endDrag();

  if (!me) {
    if (roomPrompt) { show('room'); renderRoomPrompt(roomPrompt); return; }
    show(v.phase === 'lobby' ? 'name' : 'waiting');
    return;
  }
  if (v.phase === 'lobby') { show('lobby'); renderLobby(v, me, isHost); return; }
  if (v.phase === 'finished') { show('podium'); renderPodium(v, me, isHost); return; }
  if (me.done) { show('over'); renderGameOver(v, me); return; }
  show('game');
  renderGame(v, me);
}

/** @param {{ retried: boolean }} prompt */
function renderRoomPrompt(prompt) {
  $('room-error').hidden = !prompt.retried;
}

/** @param {State} v @param {Player} me @param {boolean} isHost */
function renderLobby(v, me, isHost) {
  const ul = $('lobby-players');
  ul.replaceChildren();
  for (const id of v.order) {
    const p = v.players[id];
    const li = document.createElement('li');
    li.append(dotEl(p.color), document.createTextNode(
      p.name + (id === v.hostId ? ' 👑' : '') + (id === me.id ? ' (you)' : '')));
    ul.append(li);
  }
  $('lobby-settings').textContent = summarize(v.settings);
  $('btn-settings-lobby').hidden = !isHost;
  $('btn-start').hidden = !isHost;
  $('lobby-hint').textContent = isHost
    ? (v.order.length === 1 ? 'Play solo, or wait for friends to join.' : 'Everyone in? Hit start!')
    : 'Waiting for the host to start…';
}

/** @param {State} v @param {Player} me */
function renderGame(v, me) {
  $('my-rank').textContent = RANK_BADGES[rankOf(v, me.id) - 1] ?? '';
  $('my-score').textContent = String(me.score);

  const opp = $('opponents');
  opp.replaceChildren();
  for (const id of v.order) {
    if (id === me.id) continue;
    const p = v.players[id];
    const chip = document.createElement('span');
    chip.className = 'opp';
    chip.append(dotEl(p.color), document.createTextNode(`${p.name} ${p.done ? '💀' : p.score}`));
    opp.append(chip);
  }

  renderBoard(pending ? pending.board : me.board, v.size);
  renderTray(me);
  if (drag) paintGhost();
}

/** @param {number[]} board @param {number} size */
function renderBoard(board, size) {
  const el = $('board');
  el.style.setProperty('--n', String(size));
  const frag = document.createDocumentFragment();
  cellEls = [];
  for (let i = 0; i < size * size; i++) {
    const cell = document.createElement('div');
    cell.className = board[i] ? `cell c${board[i]}` : 'cell';
    frag.append(cell);
    cellEls.push(cell);
  }
  el.replaceChildren(frag);
}

/** @param {Player} me */
function renderTray(me) {
  for (let i = 0; i < 3; i++) {
    const slot = $(`slot-${i}`);
    slot.replaceChildren();
    const id = me.hand[i];
    const hidden = (pending !== null && pending.index === i) || (drag !== null && drag.index === i);
    if (id != null && !hidden) slot.append(pieceEl(id, me.color, TRAY_CELL));
  }
}

/** @param {State} v @param {Player} me */
function renderGameOver(v, me) {
  $('final-score').textContent = String(me.score);
  $('final-rank').textContent = v.order.length > 1
    ? `You're ${ordinal(rankOf(v, me.id))} of ${v.order.length} so far.`
    : '';
  const ul = $('final-others');
  ul.replaceChildren();
  for (const { id, score } of ranking(v)) {
    if (id === me.id) continue;
    const p = v.players[id];
    const li = document.createElement('li');
    li.append(dotEl(p.color), document.createTextNode(`${p.name} — ${score}${p.done ? ' 💀' : ''}`));
    ul.append(li);
  }
}

/** Countdown text in the top bar (and on the Done screen while the others still play). */
function updateClock() {
  const v = lastView;
  const deadline = v !== null && v.phase === 'playing' ? v.deadline : null;
  $('clock-game').hidden = deadline === null;
  $('over-clock-line').hidden = deadline === null || v === null || v.order.length < 2;
  if (deadline === null) return;
  const left = secondsLeft(deadline);
  for (const el of document.querySelectorAll('.clock')) {
    el.textContent = mmss(left);
    el.classList.toggle('urgent', left <= URGENT_SECONDS);
  }
}

/** @param {State} v @param {Player} me */
function podiumTitle(v, me) {
  if (v.order.length === 1) return isNewBest(me) ? 'New best! 🎉' : 'Nice run!';
  if (rankOf(v, me.id) !== 1) return 'Podium';
  return ranking(v).filter((r) => r.rank === 1).length > 1 ? "It's a tie! 🎉" : 'You win! 🎉';
}

/** @param {Player} me */
function isNewBest(me) {
  return lastBest !== null && (lastBest.previous === null || me.score > lastBest.previous);
}

/** @param {State} v @param {Player} me @param {boolean} isHost */
function renderPodium(v, me, isHost) {
  $('podium-kicker').hidden = v.endReason !== 'time';
  $('podium-title').textContent = podiumTitle(v, me);
  const best = $('podium-best');
  best.hidden = v.order.length !== 1 || lastBest === null || isNewBest(me);
  if (lastBest) best.textContent = `Your best: ${lastBest.score}`;

  const ol = $('podium-list');
  ol.replaceChildren();
  for (const { id, rank, score } of ranking(v)) {
    const p = v.players[id];
    const li = document.createElement('li');
    if (rank === 1) li.className = 'champion'; // ties share rank 1: co-champions
    if (id === me.id) li.classList.add('me');
    li.append(
      document.createTextNode(`${MEDALS[rank - 1] || `${rank}.`} `),
      dotEl(p.color),
      document.createTextNode(` ${p.name} — ${score}`),
    );
    ol.append(li);
  }
  $('podium-settings').textContent = `Next game: ${summarize(v.settings)}`;
  $('btn-settings-podium').hidden = !isHost;
  $('btn-again').hidden = !isHost;
  $('podium-hint').hidden = isHost;
}

/** @param {string} text */
function showNameError(text) {
  const el = $('name-error');
  el.textContent = text;
  el.hidden = false;
}

// ---------- drag & drop ----------

/** @param {PointerEvent} e @param {number} index */
function startDrag(e, index) {
  if (drag || pending || !lastView || !playerId) return;
  const me = lastView.players[playerId];
  if (!me || lastView.phase !== 'playing' || me.done) return;
  const pieceId = me.hand[index];
  if (pieceId == null || cellEls.length === 0) return;
  e.preventDefault();

  const { cells } = PIECES[pieceId];
  const { w, h } = bounds(cells);
  const el = pieceEl(pieceId, me.color, cellSize());
  el.id = 'floating-piece';
  document.body.append(el);

  drag = { pointerId: e.pointerId, index, pieceId, cells, w, h, el, gx: -99, gy: -99, valid: false };
  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', onDragDrop);
  window.addEventListener('pointercancel', onDragCancel);
  haptics.buzz('pickup');
  onDragMove(e);
  renderTray(me); // hide the lifted piece
}

/** Side of one board cell in px (measured, follows screen and board size). */
function cellSize() {
  return cellEls[0].getBoundingClientRect().width;
}

/** @param {PointerEvent} e */
function onDragMove(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId || !lastView || cellEls.length === 0) return;
  e.preventDefault();

  const cell = cellSize();
  const pitch = cell + GAP;
  const width = d.w * pitch - GAP;
  const height = d.h * pitch - GAP;
  const left = e.clientX - width / 2;
  const top = e.clientY - LIFT * cell - height;
  d.el.style.transform = `translate(${left}px, ${top}px)`;

  const origin = cellEls[0].getBoundingClientRect();
  d.gx = Math.round((left - origin.left) / pitch);
  d.gy = Math.round((top - origin.top) / pitch);
  const me = playerId ? lastView.players[playerId] : null;
  d.valid = me != null && canPlace(me.board, lastView.size, d.cells, d.gx, d.gy);
  paintGhost();
}

/** Ghost under the piece: green/red + preview of the lines that would clear. */
function paintGhost() {
  const d = drag;
  const v = lastView;
  clearGhost();
  if (!d || !v || !playerId) return;
  const n = v.size;
  const cls = d.valid ? 'ghost-ok' : 'ghost-bad';
  let onBoard = false;
  for (const [cx, cy] of d.cells) {
    const x = d.gx + cx, y = d.gy + cy;
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    cellEls[y * n + x].classList.add(cls);
    onBoard = true;
  }
  if (!onBoard || !d.valid) return;
  const me = v.players[playerId];
  const after = place(me.board, n, d.cells, d.gx, d.gy, me.color);
  const { rows, cols } = findClears(after, n);
  for (const r of rows) for (let c = 0; c < n; c++) cellEls[r * n + c].classList.add('clear-preview');
  for (const c of cols) for (let r = 0; r < n; r++) cellEls[r * n + c].classList.add('clear-preview');
}

function clearGhost() {
  for (const cell of cellEls) cell.classList.remove('ghost-ok', 'ghost-bad', 'clear-preview');
}

/** @param {PointerEvent} e */
function onDragDrop(e) {
  const d = drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const v = lastView;
  endDrag();
  if (d.valid && v && playerId) {
    const me = v.players[playerId];
    send({ t: 'place', piece: d.index, x: d.gx, y: d.gy });
    // optimistic paint: same simulation as the server, reconciled by the next view/err
    const after = place(me.board, v.size, d.cells, d.gx, d.gy, me.color);
    const clears = findClears(after, v.size);
    const lines = clears.rows.length + clears.cols.length;
    pending = { index: d.index, board: applyClears(after, v.size, clears) };
    if (lines > 0) haptics.buzzClear(lines);
    else haptics.buzz('place');
  }
  render();
}

/** @param {PointerEvent} e */
function onDragCancel(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  endDrag();
  render();
}

/** Removes floating piece, ghost and listeners. Does not re-render. */
function endDrag() {
  if (!drag) return;
  drag.el.remove();
  drag = null;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragDrop);
  window.removeEventListener('pointercancel', onDragCancel);
  clearGhost();
}

// ---------- wiring ----------

const menu = initMenu({
  canLeave: () => playerId !== null && lastView !== null && lastView.players[playerId] !== undefined,
  onLeave: leaveGame,
});
const settingsSheet = createSettingsSheet({ send });

const nameInput = /** @type {HTMLInputElement} */ ($('name-input'));
nameInput.value = load(KEYS.name) ?? '';

$('name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  save(KEYS.name, name);
  wantedName = name;
  $('name-error').hidden = true;
  send({ t: 'join', name });
});

const roomInput = /** @type {HTMLInputElement} */ ($('room-input'));
roomInput.value = room ?? '';

$('room-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeRoom(roomInput.value);
  if (!code) { roomInput.focus(); return; }
  room = code;
  save(KEYS.room, code);
  // a second hello on the same socket updates the room check, then the held join goes through
  send(helloMsg());
  send({ t: 'join', name: roomPrompt?.name || wantedName || nameInput.value.trim() || 'Player' });
});

$('btn-start').addEventListener('click', () => send({ t: 'start' }));
$('btn-again').addEventListener('click', () => send({ t: 'again' }));

for (let i = 0; i < 3; i++) {
  $(`slot-${i}`).addEventListener('pointerdown', (e) => startDrag(e, i));
}

setInterval(updateClock, CLOCK_TICK_MS);
show('loading');
connect();
