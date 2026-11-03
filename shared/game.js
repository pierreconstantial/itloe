// P0 contract — signatures and State/Action shapes FROZEN.
// P1 implements `reduce` (rules in BUILD-PLAN.md «Contract A», normative) + tests.

import { emptyBoard } from './board.js';

/**
 * @typedef {import('./pieces.js').PieceId} PieceId
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   color: number,              // 1..4, maps to CSS var --p1..--p4
 *   board: number[],            // see board.js
 *   handIndex: number,          // n of the hand currently held (0-based)
 *   hand: (PieceId | null)[],   // length 3, null = already placed
 *   score: number,
 *   streak: number,             // consecutive clearing placements before now
 *   graceLeft: number,          // 1 = next non-clearing placement forgiven
 *   done: boolean               // stuck, board frozen
 * }} Player
 *
 * @typedef {{
 *   phase: 'lobby' | 'playing' | 'finished',
 *   seed: number,
 *   size: number,
 *   hostId: string | null,
 *   order: string[],
 *   players: Record<string, Player>
 * }} State
 *
 * @typedef {{ t: 'join', id: string, name: string }
 *   | { t: 'start', id: string }
 *   | { t: 'again', id: string }
 *   | { t: 'place', id: string, piece: 0 | 1 | 2, x: number, y: number }} Action
 */

/**
 * @param {number} seed
 * @returns {State}
 */
export function initState(seed) {
  return { phase: 'lobby', seed, size: 8, hostId: null, order: [], players: {} };
}

/**
 * Fresh player object (helper for reduce and for the mock server).
 * @param {string} id
 * @param {string} name
 * @param {number} color
 * @param {number} size
 * @returns {Player}
 */
export function newPlayer(id, name, color, size) {
  return {
    id, name, color,
    board: emptyBoard(size),
    handIndex: 0,
    hand: [null, null, null],
    score: 0, streak: 0, graceLeft: 1, done: false,
  };
}

/**
 * Score of one placement.
 * `streak` = value BEFORE this placement (first clearing placement of a run → ×1).
 * @param {number} cells  cells of the placed piece
 * @param {number} lines  rows + cols cleared by this placement
 * @param {number} streak
 * @param {boolean} boardEmptied
 * @returns {number}
 */
export function placementScore(cells, lines, streak, boardEmptied) {
  return cells + 10 * lines * lines * (1 + streak) + (boardEmptied ? 300 : 0);
}

/**
 * Pure reducer. Invalid or out-of-phase actions return `state` unchanged
 * (the SAME object, reference-equal — the server uses that to skip broadcasts).
 * Rules: BUILD-PLAN.md «Contract A», normative paragraph.
 * @param {State} state
 * @param {Action} action
 * @returns {State}
 */
export function reduce(state, action) {
  void action;
  throw new Error('P1: implement reduce()');
}
