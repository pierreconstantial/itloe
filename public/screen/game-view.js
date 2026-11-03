// In-game view: one panel per player, laid out 1 / 2 side by side / 2×2 by player count (CSS, data-players).

import { PIECES } from '../../shared/pieces.js';
import { h, colorDot, playerColor } from './dom.js';
import { bindScore } from './score-ticker.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/game.js').Player} Player */

/**
 * Cells that went filled → empty between two boards, with the colour they had.
 * Pure; the hook for clear animations (M2 juice can derive rows/cols from it).
 * @param {number[] | undefined} prev
 * @param {number[]} next
 * @returns {Map<number, number>} cell index → previous colour
 */
export function clearedCells(prev, next) {
  /** @type {Map<number, number>} */
  const out = new Map();
  if (!prev || prev.length !== next.length) return out;
  for (let i = 0; i < next.length; i++) if (prev[i] && !next[i]) out.set(i, prev[i]);
  return out;
}

/**
 * Ids of the current leader(s); none in solo or while everyone is at 0.
 * @param {State} s
 * @returns {Set<string>}
 */
export function leaders(s) {
  if (s.order.length < 2) return new Set();
  const best = Math.max(...s.order.map((id) => s.players[id].score));
  if (best <= 0) return new Set();
  return new Set(s.order.filter((id) => s.players[id].score === best));
}

/**
 * @param {State} s
 * @param {State | null} prev  previous view, for the clear flash
 */
export function renderGame(s, prev) {
  const root = h('section', 'arena');
  root.dataset.players = String(s.order.length);
  const crowned = leaders(s);
  // Only diff boards within the same game: «again» resets boards and must not flash.
  const prevPlayers = prev?.phase === 'playing' && prev.seed === s.seed ? prev.players : undefined;
  for (const id of s.order) {
    const p = s.players[id];
    root.append(renderPanel(s.size, p, crowned.has(id), prevPlayers?.[id]?.board));
  }
  return root;
}

/**
 * @param {number} size
 * @param {Player} p
 * @param {boolean} isLeader
 * @param {number[] | undefined} prevBoard
 */
function renderPanel(size, p, isLeader, prevBoard) {
  const panel = h('article', 'panel' + (p.done ? ' is-done' : ''));
  panel.style.setProperty('--pc', playerColor(p.color));

  const score = h('span', 'score');
  bindScore(p.id, p.score, score);
  panel.append(h('header', 'panel-head', [
    colorDot(p.color),
    ...(isLeader ? [h('span', 'crown', ['👑'])] : []),
    h('span', 'name', [p.name]),
    score,
  ]));

  const side = h('footer', 'panel-side', [renderHand(p)]);
  if (p.streak >= 1) side.append(h('div', 'streak', [`🔥 ×${p.streak + 1}`]));

  panel.append(h('div', 'panel-body', [
    h('div', 'board-wrap', [renderBoard(size, p, prevBoard)]),
    side,
  ]));
  return panel;
}

/**
 * @param {number} size
 * @param {Player} p
 * @param {number[] | undefined} prevBoard
 */
function renderBoard(size, p, prevBoard) {
  const board = h('div', 'board');
  board.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  const cleared = clearedCells(prevBoard, p.board);
  p.board.forEach((v, i) => {
    const cell = h('div', 'cell');
    if (v) {
      cell.classList.add('filled');
      cell.style.background = playerColor(v);
    } else {
      const was = cleared.get(i);
      if (was) {
        cell.classList.add('flash');
        cell.style.setProperty('--fc', playerColor(was));
      }
    }
    board.append(cell);
  });
  if (p.done) board.append(h('div', 'done-overlay', ['💀 Done']));
  return board;
}

/** @param {Player} p */
function renderHand(p) {
  return h('div', 'hand', p.hand.map((pieceId) => {
    const slot = h('div', 'hand-slot' + (pieceId == null ? ' is-placed' : ''));
    if (pieceId != null && PIECES[pieceId]) slot.append(renderPiece(PIECES[pieceId].cells, p.color));
    return slot;
  }));
}

/**
 * @param {[number, number][]} cells
 * @param {number} color
 */
function renderPiece(cells, color) {
  const w = Math.max(...cells.map(([x]) => x)) + 1;
  const hgt = Math.max(...cells.map(([, y]) => y)) + 1;
  const piece = h('div', 'piece');
  piece.style.gridTemplateColumns = `repeat(${w}, var(--pcell))`;
  piece.style.gridTemplateRows = `repeat(${hgt}, var(--pcell))`;
  for (const [x, y] of cells) {
    const c = h('div', 'piece-cell');
    c.style.gridColumn = String(x + 1);
    c.style.gridRow = String(y + 1);
    c.style.background = playerColor(color);
    piece.append(c);
  }
  return piece;
}
