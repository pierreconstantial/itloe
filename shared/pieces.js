// The block pieces: the full 29-piece set per SPEC-BLOCKS.md §5.2, and the hands dealt from a seed.
// Weights may be tuned; ids and the cell convention stay, as saved hands name them.
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
    ['sq3', [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]], 0.5],
    // rectangles (largeur × hauteur)
    ['r3x2', [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], 2],
    ['r2x3', [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], 2],
    // petits coins (3 cases) — nommés par le coin plein
    ['c_nw', [[0, 0], [1, 0], [0, 1]], 2],
    ['c_ne', [[0, 0], [1, 0], [1, 1]], 2],
    ['c_sw', [[0, 0], [0, 1], [1, 1]], 2],
    ['c_se', [[1, 0], [0, 1], [1, 1]], 2],
    // grands coins (5 cases, 3×3)
    ['bc_nw', [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], 1.5],
    ['bc_ne', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 1.5],
    ['bc_sw', [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], 1.5],
    ['bc_se', [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]], 1.5],
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

/**
 * @typedef {'full' | 'simple'} PieceSetId
 * @typedef {{ weights: Record<PieceId, number> }} PieceSet
 */

const SZT = new Set(['s_h', 'z_h', 's_v', 'z_v', 't_down', 't_up', 't_right', 't_left']);

/**
 * The single table where piece weights are tuned, per set (Q5).
 * A set's members = the ids listed with weight > 0; the iteration order of `weights` is
 * part of the hand sequence, so keep keys in PIECES order.
 * PIECES[id].w stays equal to PIECE_SETS.full.weights[id].
 * @type {Record<PieceSetId, PieceSet>}
 */
export const PIECE_SETS = {
  full: { weights: Object.fromEntries(Object.values(PIECES).map((p) => [p.id, p.w])) },
  simple: {
    weights: Object.fromEntries(Object.values(PIECES).filter((p) => !SZT.has(p.id)).map((p) => [p.id, p.w])),
  },
};

/** @type {Map<string, { ids: PieceId[], ws: number[], total: number }>} */
const TABLES = new Map(
  Object.entries(PIECE_SETS).map(([setId, { weights }]) => {
    const ids = Object.keys(weights).filter((id) => weights[id] > 0);
    const ws = ids.map((id) => weights[id]);
    return [setId, { ids, ws, total: ws.reduce((s, w) => s + w, 0) }];
  })
);

/**
 * Deterministic n-th hand of the game (n = 0, 1, 2, …).
 * Every player of a game gets the exact same hands. The sequence is a function of
 * (seed, set, that set's weights).
 * @param {number} seed
 * @param {number} n
 * @param {PieceSetId} [set]
 * @returns {[PieceId, PieceId, PieceId]}
 */
export function handAt(seed, n, set = 'full') {
  const table = TABLES.get(set);
  if (!table) throw new Error(`handAt: unknown piece set ${set}`);
  const { ids, ws, total } = table;
  const rng = mulberry32((seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0);
  const pick = () => {
    let r = rng() * total;
    for (let i = 0; i < ids.length; i++) {
      r -= ws[i];
      if (r < 0) return ids[i];
    }
    return ids[ids.length - 1];
  };
  return [pick(), pick(), pick()];
}
