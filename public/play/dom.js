// Small DOM helpers shared by the /play modules.
import { PIECES } from '../../shared/pieces.js';

/** @typedef {import('../../shared/pieces.js').PieceId} PieceId */

/** @param {string} id @returns {HTMLElement} */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

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

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/** Brief message at the bottom of the screen; a newer toast replaces the current one. @param {string} text */
export function toast(text, ms = 2200) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** Player colour dot. @param {number} color 1..4 @returns {HTMLElement} */
export function dotEl(color) {
  const dot = document.createElement('span');
  dot.className = `dot c${color}`;
  return dot;
}
