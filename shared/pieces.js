// P0 contract — signatures FROZEN. Full 29-piece set per SPEC-BLOCKS.md §5.2.
// P1 may tune weights, never ids or the cell convention.
// Cell convention: [x, y], x → right, y → down, origin = top-left of the piece's bounding box.

import { mulberry32 } from './rng.js';

/**
 * @typedef {string} PieceId
 * @typedef {{ id: PieceId, cells: [number, number][], w: number }} Piece
 */

/** @type {Record<PieceId, Piece>} */
export const PIECES = Object.fromEntries(
  /** @type {[PieceId, [number, number][], number][]} */ ([
    // point
    ['dot', [[0, 0]], 2],
    // barres horizontales
    ['h2', [[0, 0], [1, 0]], 3],
    ['h3', [[0, 0], [1, 0], [2, 0]], 3],
    ['h4', [[0, 0], [1, 0], [2, 0], [3, 0]], 2],
    ['h5', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 1],
    // barres verticales
    ['v2', [[0, 0], [0, 1]], 3],
    ['v3', [[0, 0], [0, 1], [0, 2]], 3],
    ['v4', [[0, 0], [0, 1], [0, 2], [0, 3]], 2],
    ['v5', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 1],
    // carrés
    ['sq2', [[0, 0], [1, 0], [0, 1], [1, 1]], 3],
    ['sq3', [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]], 1],
    // rectangles (largeur × hauteur)
    ['r3x2', [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], 2],
    ['r2x3', [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], 2],
    // petits coins (3 cases) — nommés par le coin plein
    ['c_nw', [[0, 0], [1, 0], [0, 1]], 2],
    ['c_ne', [[0, 0], [1, 0], [1, 1]], 2],
    ['c_sw', [[0, 0], [0, 1], [1, 1]], 2],
    ['c_se', [[1, 0], [0, 1], [1, 1]], 2],
    // grands coins (5 cases, 3×3)
    ['bc_nw', [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], 1],
    ['bc_ne', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 1],
    ['bc_sw', [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], 1],
    ['bc_se', [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]], 1],
    // S / Z
    ['s_h', [[1, 0], [2, 0], [0, 1], [1, 1]], 2],
    ['z_h', [[0, 0], [1, 0], [1, 1], [2, 1]], 2],
    ['s_v', [[0, 0], [0, 1], [1, 1], [1, 2]], 2],
    ['z_v', [[1, 0], [0, 1], [1, 1], [0, 2]], 2],
    // T
    ['t_down', [[0, 0], [1, 0], [2, 0], [1, 1]], 2],
    ['t_up', [[1, 0], [0, 1], [1, 1], [2, 1]], 2],
    ['t_right', [[0, 0], [0, 1], [0, 2], [1, 1]], 2],
    ['t_left', [[1, 0], [0, 1], [1, 1], [1, 2]], 2],
  ]).map(([id, cells, w]) => [id, { id, cells, w }])
);

const IDS = Object.keys(PIECES);
const TOTAL_W = IDS.reduce((s, id) => s + PIECES[id].w, 0);

/**
 * Deterministic n-th hand of the game (n = 0, 1, 2, …).
 * Every player of a game gets the exact same hands.
 * @param {number} seed
 * @param {number} n
 * @returns {[PieceId, PieceId, PieceId]}
 */
export function handAt(seed, n) {
  const rng = mulberry32((seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0);
  const pick = () => {
    let r = rng() * TOTAL_W;
    for (const id of IDS) {
      r -= PIECES[id].w;
      if (r < 0) return id;
    }
    return IDS[IDS.length - 1];
  };
  return [pick(), pick(), pick()];
}
