// P3 — phone client /play. Renders strictly from the last `view` (PROTOCOL.md);
// the only optimistic paint (local placement) is reconciled by the next `view`/`err`.
// Path ../../shared: resolved on disk by tsc, normalized to /shared/ by the browser.
import { canPlace, place, findClears, applyClears } from '../../shared/board.js';
import { PIECES } from '../../shared/pieces.js';
import { ranking } from '../../shared/game.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/game.js').Player} Player */
/** @typedef {import('../../shared/pieces.js').PieceId} PieceId */

const RANK_BADGES = ['①', '②', '③', '④'];
const GAP = 2; // px between cells, = the `gap` value in play-base.css
const TRAY_CELL = 13; // px per cell for tray miniatures

// ---------- helpers ----------

/** @param {string} id @returns {HTMLElement} */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

/** @param {string} key @returns {string | null} */
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }

/** @param {string} key @param {string} value */
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

/** Bounding box of a piece's cells. @param {[number, number][]} cells @returns {{ w: number, h: number }} */
function bounds(cells) {
  let w = 0, h = 0;
  for (const [x, y] of cells) { if (x + 1 > w) w = x + 1; if (y + 1 > h) h = y + 1; }
  return { w, h };
}

/** @param {number} rank 1-based @returns {string} */
function ordinal(rank) {
  return rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`;
}

// ---------- client state ----------

// /sim loads four /play iframes on one origin: ?slot=1..4 namespaces their storage.
// Real phones have no ?slot and keep the plain keys.
const SLOT = new URLSearchParams(location.search).get('slot') ?? '';
const KEY_ID = `bloko-id${SLOT}`;
const KEY_NAME = `bloko-name${SLOT}`;

/** @type {State | null} */ let lastView = null;
/** @type {string | null} */ let playerId = storageGet(KEY_ID);
/** @type {WebSocket | null} */ let ws = null;
/** Placement sent but not yet confirmed: simulated board + tray slot hidden.
 * @type {{ index: number, board: number[] } | null} */
let pending = null;

/** @type {{
 *   pointerId: number, index: number, pieceId: PieceId,
 *   cells: [number, number][], w: number, h: number,
 *   el: HTMLElement, gx: number, gy: number, valid: boolean
 * } | null} */
let drag = null;

/** Board cell elements, rebuilt on every render. @type {HTMLElement[]} */
let cellEls = [];

// ---------- connection ----------

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.addEventListener('open', () => {
    $('conn-banner').hidden = true;
    send(playerId
      ? { t: 'hello', role: 'player', playerId }
      : { t: 'hello', role: 'player' });
  });
  sock.addEventListener('message', (ev) => receive(String(ev.data)));
  sock.addEventListener('close', () => {
    if (ws !== sock) return;
    $('conn-banner').hidden = false;
    setTimeout(connect, 1000);
  });
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
    storageSet(KEY_ID, m.playerId);
    render();
  } else if (m.t === 'view') {
    lastView = m.state;
    pending = null;
    render();
  } else if (m.t === 'err') {
    pending = null;
    if (m.code === 'full') showNameError('Game is full (4 players max).');
    render(); // bad-place and friends: repaint from the last view
  }
}

// ---------- rendering ----------

const VIEWS = ['loading', 'name', 'waiting', 'lobby', 'game', 'over', 'podium'];

/** @param {string} name */
function show(name) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
}

function render() {
  const v = lastView;
  if (!v) { show('loading'); return; }
  const me = playerId ? v.players[playerId] ?? null : null;

  // the piece being dragged left our hand → the drag is stale
  if (drag && (!me || me.hand[drag.index] !== drag.pieceId)) endDrag();

  if (!me) {
    show(v.phase === 'lobby' ? 'name' : 'waiting');
    return;
  }
  if (v.phase === 'lobby') { show('lobby'); renderLobby(v, me); return; }
  if (v.phase === 'finished') { show('podium'); renderPodium(v, me); return; }
  if (me.done) { show('over'); renderGameOver(v, me); return; }
  show('game');
  renderGame(v, me);
}

/** @param {number} color @returns {HTMLElement} */
function dotEl(color) {
  const dot = document.createElement('span');
  dot.className = `dot c${color}`;
  return dot;
}

/** @param {State} v @param {Player} me */
function renderLobby(v, me) {
  const ul = $('lobby-players');
  ul.replaceChildren();
  for (const id of v.order) {
    const p = v.players[id];
    const li = document.createElement('li');
    li.append(dotEl(p.color), document.createTextNode(
      p.name + (id === v.hostId ? ' 👑' : '') + (id === me.id ? ' (you)' : '')));
    ul.append(li);
  }
  const isHost = me.id === v.hostId;
  $('btn-start').hidden = !isHost;
  $('lobby-hint').hidden = isHost;
}

/** @param {State} v @param {Player} me */
function renderGame(v, me) {
  const myRank = ranking(v).find((r) => r.id === me.id);
  $('my-rank').textContent = myRank ? RANK_BADGES[myRank.rank - 1] ?? '' : '';
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

/**
 * DOM element for a piece (grid of cells).
 * @param {PieceId} id @param {number} color @param {number} cellPx
 * @returns {HTMLElement}
 */
function pieceEl(id, color, cellPx) {
  const { cells } = PIECES[id];
  const { w, h } = bounds(cells);
  const el = document.createElement('div');
  el.className = 'piece';
  el.style.gridTemplateColumns = `repeat(${w}, ${cellPx}px)`;
  el.style.gridTemplateRows = `repeat(${h}, ${cellPx}px)`;
  const filled = new Set(cells.map(([x, y]) => y * w + x));
  for (let i = 0; i < w * h; i++) {
    const cell = document.createElement('div');
    if (filled.has(i)) cell.className = `cell c${color}`;
    el.append(cell);
  }
  return el;
}

/** @param {State} v @param {Player} me */
function renderGameOver(v, me) {
  $('final-score').textContent = String(me.score);
  const ranks = ranking(v);
  const mine = ranks.find((r) => r.id === me.id);
  $('final-rank').textContent = `${ordinal(mine ? mine.rank : v.order.length)} of ${v.order.length}`;
  const ul = $('final-others');
  ul.replaceChildren();
  for (const { id } of ranks) {
    if (id === me.id) continue;
    const p = v.players[id];
    const li = document.createElement('li');
    li.append(dotEl(p.color), document.createTextNode(`${p.name} — ${p.score}${p.done ? ' 💀' : ''}`));
    ul.append(li);
  }
}

/** @param {State} v @param {Player} me */
function renderPodium(v, me) {
  const MEDALS = ['🥇', '🥈', '🥉', ''];
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
  const isHost = me.id === v.hostId;
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
  onDragMove(e);
  renderTray(me); // hide the lifted piece
}

/** Side of one board cell in px (measured, follows screen size). */
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
  // the piece floats ~1.5 cells above the finger, horizontally centered
  const left = e.clientX - width / 2;
  const top = e.clientY - 1.5 * cell - height;
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
    pending = { index: d.index, board: applyClears(after, v.size, findClears(after, v.size)) };
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

const nameInput = /** @type {HTMLInputElement} */ ($('name-input'));
nameInput.value = storageGet(KEY_NAME) ?? '';

$('name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  storageSet(KEY_NAME, name);
  $('name-error').hidden = true;
  send({ t: 'join', name });
});

$('btn-start').addEventListener('click', () => send({ t: 'start' }));
$('btn-again').addEventListener('click', () => send({ t: 'again' }));

for (let i = 0; i < 3; i++) {
  $(`slot-${i}`).addEventListener('pointerdown', (e) => startDrag(e, i));
}

show('loading');
connect();
