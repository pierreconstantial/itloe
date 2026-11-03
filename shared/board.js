// P0 contract — FROZEN. Fully implemented in P0 (P1 covers it with tests).
// Board = (0 | colorIndex)[] of length size*size, row-major: cell (x, y) = board[y * size + x].

import { PIECES } from './pieces.js';

/**
 * @param {number} size
 * @returns {number[]}
 */
export function emptyBoard(size) {
  return new Array(size * size).fill(0);
}

/**
 * Can `cells` (piece-local coordinates) be placed with its origin at (x, y)?
 * @param {number[]} board
 * @param {number} size
 * @param {[number, number][]} cells
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function canPlace(board, size, cells, x, y) {
  for (const [cx, cy] of cells) {
    const px = x + cx;
    const py = y + cy;
    if (px < 0 || py < 0 || px >= size || py >= size) return false;
    if (board[py * size + px] !== 0) return false;
  }
  return true;
}

/**
 * Pure: returns a new board with the piece written in `color` (1–4). No validation.
 * @param {number[]} board
 * @param {number} size
 * @param {[number, number][]} cells
 * @param {number} x
 * @param {number} y
 * @param {number} color
 * @returns {number[]}
 */
export function place(board, size, cells, x, y, color) {
  const b = board.slice();
  for (const [cx, cy] of cells) b[(y + cy) * size + (x + cx)] = color;
  return b;
}

/**
 * Full rows and columns, detected simultaneously.
 * @param {number[]} board
 * @param {number} size
 * @returns {{ rows: number[], cols: number[] }}
 */
export function findClears(board, size) {
  const rows = [];
  const cols = [];
  for (let r = 0; r < size; r++) {
    let full = true;
    for (let c = 0; c < size; c++) if (board[r * size + c] === 0) { full = false; break; }
    if (full) rows.push(r);
  }
  for (let c = 0; c < size; c++) {
    let full = true;
    for (let r = 0; r < size; r++) if (board[r * size + c] === 0) { full = false; break; }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

/**
 * Pure: clears the given rows and columns (an intersection cell is simply cleared once).
 * @param {number[]} board
 * @param {number} size
 * @param {{ rows: number[], cols: number[] }} clears
 * @returns {number[]}
 */
export function applyClears(board, size, clears) {
  const b = board.slice();
  for (const r of clears.rows) for (let c = 0; c < size; c++) b[r * size + c] = 0;
  for (const c of clears.cols) for (let r = 0; r < size; r++) b[r * size + c] = 0;
  return b;
}

/**
 * Does any remaining piece of the hand fit anywhere?
 * @param {number[]} board
 * @param {number} size
 * @param {(import('./pieces.js').PieceId | null)[]} hand
 * @returns {boolean}
 */
export function anyFit(board, size, hand) {
  for (const id of hand) {
    if (id === null) continue;
    const cells = PIECES[id].cells;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (canPlace(board, size, cells, x, y)) return true;
      }
    }
  }
  return false;
}
