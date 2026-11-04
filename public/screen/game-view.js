// In-game view: one panel per player, laid out 1 / 2 side by side / 2×2 by player count (CSS, data-players).

import { PIECES } from '../../shared/pieces.js';
import { ranking } from '../../shared/game.js';
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
 * Ids wearing the crown: every rank-1 player (shared ranking rule) with a score > 0; none in solo.
 * @param {State} s
 * @returns {Set<string>}
 */
export function leaders(s) {
  if (s.order.length < 2) return new Set();
  return new Set(ranking(s).filter((r) => r.rank === 1 && r.score > 0).map((r) => r.id));
}

/**
 * @param {State} s
 * @param {State | null} prev  previous view (entrance animations only)
 * @param {{ danger?: Set<string> }} [opts]  ids of players close to being stuck
 */
export function renderGame(s, prev, { danger = new Set() } = {}) {
  const root = h('section', 'arena');
  root.dataset.players = String(s.order.length);
  const crowned = leaders(s);
  // Only compare with the previous view of the same game («again» resets everything).
  const prevPlayers = prev?.phase === 'playing' && prev.seed === s.seed ? prev.players : undefined;
  for (const id of s.order) {
    const p = s.players[id];
    root.append(renderPanel(s.size, p, {
      isLeader: crowned.has(id),
      inDanger: danger.has(id) && !p.done,
      justDone: p.done && prevPlayers?.[id]?.done === false,
    }));
  }
  return root;
}

/**
 * @param {number} size
 * @param {Player} p
 * @param {{ isLeader: boolean, inDanger: boolean, justDone: boolean }} flags
 */
function renderPanel(size, p, { isLeader, inDanger, justDone }) {
  const panel = h('article', 'panel'
    + (p.done ? ' is-done' : '')
    + (justDone ? ' just-done' : '')
    + (inDanger ? ' is-danger' : ''));
  panel.dataset.id = p.id;
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
    h('div', 'board-wrap', [renderBoard(size, p)]),
    side,
  ]));
  return panel;
}

/**
 * Cell-level clear visuals live in fx.js (they must outlive re-renders).
 * @param {number} size
 * @param {Player} p
 */
function renderBoard(size, p) {
  const board = h('div', 'board');
  board.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  for (const v of p.board) {
    const cell = h('div', 'cell');
    if (v) {
      cell.classList.add('filled');
      cell.style.background = playerColor(v);
    }
    board.append(cell);
  }
  if (p.done) board.append(h('div', 'done-overlay', [p.retired ? '🚪 Out' : '💀 Done']));
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
