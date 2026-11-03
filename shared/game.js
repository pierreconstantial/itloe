// P0 contract — signatures and State/Action shapes FROZEN.
// P1 implements `reduce` (rules in BUILD-PLAN.md «Contract A», normative) + tests.

import { emptyBoard, canPlace, place, findClears, applyClears, anyFit } from './board.js';
import { PIECES, handAt } from './pieces.js';
import { mulberry32 } from './rng.js';

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
 *   done: boolean,              // stuck, board frozen
 *   last: null | {
 *     n: number,                // per-player move counter (event id — clients react to n changing)
 *     pieceId: PieceId, x: number, y: number,
 *     rows: number[], cols: number[],  // clears of this move, BEFORE applyClears
 *     gained: number,           // placementScore of this move
 *     streak: number,           // streak AFTER the move
 *     cleanBoard: boolean
 *   }                           // record of the latest move (contract addition, Q1 2026-11-04)
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
    last: null,
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
 * The ONE ranking rule for every podium and crown (contract addition, P5 2026-11-04).
 * Score descending; equal scores SHARE a rank (standard competition ranking: 1, 1, 3);
 * display order among ties = join order. Rank 1 can be held by several co-champions.
 * @param {State} state
 * @returns {{ id: string, rank: number, score: number }[]} in display order
 */
export function ranking(state) {
  const ordered = [...state.order].sort(
    (a, b) =>
      state.players[b].score - state.players[a].score ||
      state.order.indexOf(a) - state.order.indexOf(b)
  );
  let prevScore = NaN;
  let prevRank = 0;
  return ordered.map((id, i) => {
    const score = state.players[id].score;
    const rank = score === prevScore ? prevRank : i + 1;
    prevScore = score;
    prevRank = rank;
    return { id, rank, score };
  });
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
  switch (action.t) {
    case 'join': {
      if (state.phase !== 'lobby') return state;
      if (state.order.length >= 4) return state;
      if (typeof action.id !== 'string' || action.id === '') return state;
      if (typeof action.name !== 'string' || action.name.trim() === '') return state;
      if (state.players[action.id]) return state;
      const color = state.order.length + 1;
      return {
        ...state,
        hostId: state.hostId ?? action.id,
        order: [...state.order, action.id],
        players: { ...state.players, [action.id]: newPlayer(action.id, action.name, color, state.size) },
      };
    }

    case 'start': {
      if (state.phase !== 'lobby') return state;
      if (action.id !== state.hostId || state.hostId === null) return state;
      if (state.order.length < 1) return state;
      return beginPlay(state, state.seed);
    }

    case 'place': {
      if (state.phase !== 'playing') return state;
      const p = state.players[action.id];
      if (!p || p.done) return state;
      const { piece, x, y } = action;
      if (piece !== 0 && piece !== 1 && piece !== 2) return state;
      const pieceId = p.hand[piece];
      if (pieceId == null) return state;
      const cells = PIECES[pieceId].cells;
      if (!canPlace(p.board, state.size, cells, x, y)) return state;

      let board = place(p.board, state.size, cells, x, y, p.color);
      const clears = findClears(board, state.size);
      const lines = clears.rows.length + clears.cols.length;
      if (lines > 0) board = applyClears(board, state.size, clears);
      const boardEmptied = lines > 0 && board.every((c) => c === 0);
      const gained = placementScore(cells.length, lines, p.streak, boardEmptied);

      let { streak, graceLeft } = p;
      if (lines > 0) {
        streak += 1;
        graceLeft = 1;
      } else if (graceLeft > 0) {
        graceLeft -= 1;
      } else {
        streak = 0;
      }

      /** @type {(PieceId | null)[]} */
      let hand = p.hand.slice();
      hand[piece] = null;
      let handIndex = p.handIndex;
      if (hand.every((h) => h === null)) {
        handIndex += 1;
        hand = handAt(state.seed, handIndex);
      }
      const done = !anyFit(board, state.size, hand);

      const players = {
        ...state.players,
        [p.id]: {
          ...p, board, hand, handIndex, score: p.score + gained, streak, graceLeft, done,
          last: {
            n: (p.last ? p.last.n : 0) + 1,
            pieceId, x, y,
            rows: clears.rows, cols: clears.cols,
            gained, streak, cleanBoard: boardEmptied,
          },
        },
      };
      const allDone = state.order.every((id) => players[id].done);
      return { ...state, players, phase: allDone ? 'finished' : state.phase };
    }

    case 'again': {
      if (state.phase !== 'finished') return state;
      if (action.id !== state.hostId || state.hostId === null) return state;
      return beginPlay(state, nextSeed(state.seed));
    }

    default:
      return state;
  }
}

/**
 * Same players (ids/names/colors), fresh boards/scores, hand 0 of `seed` dealt, phase playing.
 * @param {State} state
 * @param {number} seed
 * @returns {State}
 */
function beginPlay(state, seed) {
  /** @type {Record<string, Player>} */
  const players = {};
  for (const id of state.order) {
    const old = state.players[id];
    players[id] = { ...newPlayer(id, old.name, old.color, state.size), hand: handAt(seed, 0) };
  }
  return { ...state, phase: 'playing', seed, players };
}

/**
 * Deterministic next seed for «Rejouer» (reduce stays pure; the seed is part of the state).
 * @param {number} seed
 * @returns {number}
 */
function nextSeed(seed) {
  return Math.floor(mulberry32(seed)() * 4294967296) >>> 0;
}
