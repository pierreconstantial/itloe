// Phone block-game screens, mounted by the frame (./minigames.js) while a block round runs: the board with
// drag & drop (view-game) and, once out of moves, the game-over screen (view-over). They render strictly
// from the round's view; the only optimistic paint (a local placement) is reconciled by the next view or err.
// The podium is the frame's; the block game adds the solo "New best!" to it.
import { canPlace, place, findClears, applyClears } from '../../shared/board.js';
import { PIECES } from '../../shared/pieces.js';
import { ranking } from '../../shared/ranking.js';
import { $, addStylesheet, dotEl } from './dom.js';
import * as haptics from './haptics.js';
import { secondsLeft, mmss } from '../commun/clock.js';
import { SETTINGS_SCHEMA } from '../../shared/game.js';
import { formatSetting, settingText, summarizeSettings } from '../commun/settings-text.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/game.js').Player} Player */
/** @typedef {import('../../shared/pieces.js').PieceId} PieceId */
/** Solo record for the current (size, mode), inside the block view in solo games. @typedef {{ score: number, previous: number | null }} Best */

const RANK_BADGES = ['①', '②', '③', '④'];
const GAP = 2; // px between cells, = the `gap` value in blocks.css
const TRAY_CELL = 13; // px per cell for tray miniatures
const LIFT = 1.5; // the dragged piece floats this many cells above the finger
const URGENT_SECONDS = 10; // the countdown turns red from here
const CLOCK_TICK_MS = 250;
const RULE_CELL = 10; // px per cell for the rules' illustrations

/** "How to play": one short line per rule, each illustrated by a piece. */
/** @type {{ piece: import('../../shared/pieces.js').PieceId, text: string }[]} */
const RULES = [
  { piece: 't_down', text: 'Drag a piece onto your board. No rotating!' },
  { piece: 'h4', text: 'Fill a whole row or column to clear it.' },
  { piece: 'sq2', text: 'Clear several lines at once, or clear on every move, for combo points.' },
  { piece: 'c_nw', text: 'Everyone gets the same pieces, in the same order.' },
  { piece: 'dot', text: "No room for any piece you hold? You're out. Top score wins!" },
];

/** Bounding box of a piece's cells. @param {[number, number][]} cells @returns {{ w: number, h: number }} */
export function bounds(cells) {
  let w = 0, h = 0;
  for (const [x, y] of cells) { if (x + 1 > w) w = x + 1; if (y + 1 > h) h = y + 1; }
  return { w, h };
}

/**
 * A piece drawn as a grid of cells.
 * @param {PieceId} id @param {number} color 1..4 @param {number} cellPx
 * @returns {HTMLElement}
 */
export function pieceEl(id, color, cellPx) {
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

addStylesheet(new URL('./blocks.css', import.meta.url));

const MARKUP = `
  <section id="view-game">
    <header id="topbar">
      <div id="me-chip">
        <span id="my-rank">①</span>
        <span id="my-score">0</span>
      </div>
      <span id="clock-game" class="clock" hidden></span>
      <div id="opponents"></div>
    </header>
    <div id="board-zone"><div id="board"></div></div>
    <div id="tray">
      <div class="slot" id="slot-0"></div>
      <div class="slot" id="slot-1"></div>
      <div class="slot" id="slot-2"></div>
    </div>
  </section>

  <section id="view-over" class="menu" hidden>
    <p id="over-icon" class="skull">💀</p>
    <h2 id="over-title">Out of moves!</h2>
    <p>Final score <strong id="final-score"></strong></p>
    <p id="final-rank"></p>
    <p id="over-clock-line" hidden>The others have <strong class="clock"></strong> left.</p>
    <ul id="final-others" class="player-list"></ul>
    <p class="dim">Eyes on the big screen!</p>
  </section>
`;

/** @param {number} rank 1-based @returns {string} */
function ordinal(rank) {
  return rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`;
}

/** @param {State} v @param {string} id @returns {number} 1-based, shared with ties */
function rankOf(v, id) {
  return ranking(v).find((r) => r.id === id)?.rank ?? v.order.length;
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

/**
 * @param {HTMLElement} root @param {import('./minigames.js').PhoneIo} io
 * @returns {import('./minigames.js').Mounted}
 */
function mount(root, io) {
  root.insertAdjacentHTML('beforeend', MARKUP);

  /** The block game in the last view. @type {State | null} */
  let view = null;
  /** Placement sent but not yet confirmed: simulated board + tray slot hidden.
   * @type {{ index: number, board: number[] } | null} */
  let pending = null;
  /** @type {{
   *   pointerId: number, index: number, pieceId: PieceId,
   *   cells: [number, number][], w: number, h: number,
   *   el: HTMLElement, gx: number, gy: number, valid: boolean
   * } | null} */
  let drag = null;
  /** Board cell elements, rebuilt on every paint. @type {HTMLElement[]} */
  let cellEls = [];

  /** @param {'game' | 'over'} name */
  function show(name) {
    $('view-game').hidden = name !== 'game';
    $('view-over').hidden = name !== 'over';
  }

  function paint() {
    const v = view;
    const me = v ? v.players[io.meId()] ?? null : null;
    // the piece being dragged left our hand → the drag is stale
    if (drag && (!me || me.hand[drag.index] !== drag.pieceId)) endDrag();
    if (!io.connected() && drag) endDrag(); // a drop can't be sent while offline
    updateClock();
    if (!v || !me) return;
    if (me.done) { show('over'); renderGameOver(v, me); return; }
    show('game');
    renderGame(v, me);
  }

  /** @param {State} v @param {Player} me */
  function renderGame(v, me) {
    $('my-rank').textContent = RANK_BADGES[rankOf(v, me.id) - 1] ?? '';
    $('my-score').textContent = String(me.score);

    const opp = $('opponents');
    opp.replaceChildren();
    const online = io.online();
    for (const id of v.order) {
      if (id === me.id) continue;
      const p = v.players[id];
      const chip = document.createElement('span');
      chip.className = 'opp';
      const off = !p.done && !online.includes(id);
      chip.append(dotEl(p.color), document.createTextNode(`${p.name} ${p.done ? (p.retired ? '👋' : '💀') : p.score}${off ? ' 📴' : ''}`));
      // the game master can act on an offline player right from the bar: the chip opens their menu
      if (off && io.isGameMaster()) { chip.dataset.open = 'menu'; chip.classList.add('offline'); }
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
    // taken out by the game master (slice 2b): calm, the run still counts
    $('over-icon').textContent = me.retired ? '👋' : '💀';
    $('over-title').textContent = me.retired ? 'You were taken out — your score counts' : 'Out of moves!';
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
    const v = view;
    const deadline = v !== null && v.phase === 'playing' ? v.deadline : null;
    $('clock-game').hidden = deadline === null;
    $('over-clock-line').hidden = deadline === null || v === null || v.order.length < 2;
    if (deadline === null) return;
    const left = secondsLeft(deadline);
    for (const el of root.querySelectorAll('.clock')) {
      el.textContent = mmss(left);
      el.classList.toggle('urgent', left <= URGENT_SECONDS);
    }
  }

  // ---------- drag & drop ----------

  /** @param {PointerEvent} e @param {number} index */
  function startDrag(e, index) {
    const meId = io.meId();
    if (drag || pending || !view || !meId || !io.connected()) return;
    const me = view.players[meId];
    if (!me || view.phase !== 'playing' || me.done) return;
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
    if (!d || e.pointerId !== d.pointerId || !view || cellEls.length === 0) return;
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
    const me = view.players[io.meId()];
    d.valid = me != null && canPlace(me.board, view.size, d.cells, d.gx, d.gy);
    paintGhost();
  }

  /** Ghost under the piece: green/red + preview of the lines that would clear. */
  function paintGhost() {
    const d = drag;
    const v = view;
    clearGhost();
    const me = v ? v.players[io.meId()] : null;
    if (!d || !v || !me) return;
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
    const v = view;
    endDrag();
    const me = v ? v.players[io.meId()] : null;
    if (d.valid && v && me) {
      io.send({ t: 'place', piece: d.index, x: d.gx, y: d.gy });
      // optimistic paint: same simulation as the server, reconciled by the next view/err
      const after = place(me.board, v.size, d.cells, d.gx, d.gy, me.color);
      const clears = findClears(after, v.size);
      const lines = clears.rows.length + clears.cols.length;
      pending = { index: d.index, board: applyClears(after, v.size, clears) };
      if (lines > 0) haptics.buzzClear(lines);
      else haptics.buzz('place');
    }
    paint();
  }

  /** @param {PointerEvent} e */
  function onDragCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag();
    paint();
  }

  /** Removes floating piece, ghost and listeners. Does not repaint. */
  function endDrag() {
    if (!drag) return;
    drag.el.remove();
    drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragDrop);
    window.removeEventListener('pointercancel', onDragCancel);
    clearGhost();
  }

  for (let i = 0; i < 3; i++) {
    $(`slot-${i}`).addEventListener('pointerdown', (e) => startDrag(e, i));
  }
  const clock = setInterval(updateClock, CLOCK_TICK_MS);

  return {
    update(round) {
      const prev = view;
      const next = /** @type {State} */ (round.view);
      view = next;
      pending = null;
      const event = prev ? outcome(prev, next, io.meId()) : null;
      if (event) haptics.buzz(event);
      paint();
    },
    message(msg) {
      if (msg.t !== 'err') return;
      pending = null; // bad-place and friends: repaint from the last view
      paint();
    },
    unmount() {
      endDrag();
      clearInterval(clock);
      root.replaceChildren();
    },
  };
}

/** The block game's entry in the phone's list (./minigames.js). @type {import('./minigames.js').PhoneScreen} */
export const BLOCK_SCREEN = {
  title: 'ITLOE',
  rules: RULES.map(({ piece, text }, i) => ({ icon: () => pieceEl(piece, (i % 4) + 1, RULE_CELL), text })),
  settings: { schema: SETTINGS_SCHEMA, text: settingText, format: formatSetting, summarize: summarizeSettings },
  mount,
  /** The solo podium: a new best, or the best to beat. */
  podium(round) {
    const v = /** @type {State & { best?: Best }} */ (round.view);
    if (v.order.length !== 1) return {};
    const best = v.best ?? null;
    const me = v.players[v.order[0]];
    const isNew = best !== null && (best.previous === null || me.score > best.previous);
    return { title: isNew ? 'New best! 🎉' : 'Nice run!', lines: best && !isNew ? [`Your best: ${best.score}`] : [] };
  },
};
