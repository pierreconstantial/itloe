// P0 contract + Q4 addendum (2026-11-04) — signatures and State/Action shapes FROZEN.
// Rules: BUILD-PLAN.md «Contract A» (normative) + the Q4 settings/timed-mode addendum.

import { emptyBoard, canPlace, place, findClears, applyClears, anyFit } from './board.js';
import { PIECES, handAt } from './pieces.js';
import { mulberry32 } from './rng.js';
import { CHARACTERS, freeCharacters, isCharacterId } from './characters.js';

/**
 * @typedef {import('./pieces.js').PieceId} PieceId
 * @typedef {import('./characters.js').CharacterId} CharacterId
 * @typedef {import('./pieces.js').PieceSetId} PieceSetId
 *
 * @typedef {{
 *   size: 8 | 9 | 10,
 *   mode: 'marathon' | 'timed',
 *   timedSeconds: number,       // 60..300, step 30
 *   pieceSet: PieceSetId,
 *   grace: 0 | 1 | 2,
 *   cleanBoardBonus: number     // 0..500, step 50
 * }} Settings
 *
 * @typedef {{
 *   id: string,
 *   name: string,               // copied from CHARACTERS[character] at join
 *   color: number,              // 1..4, maps to CSS var --p1..--p4; = CHARACTERS[character].color
 *   character: CharacterId | null,  // null only for saves from before M3 and the mock server
 *   board: number[],            // see board.js
 *   handIndex: number,          // n of the hand currently held (0-based)
 *   hand: (PieceId | null)[],   // length 3, null = already placed
 *   score: number,
 *   streak: number,             // consecutive clearing placements before now
 *   graceLeft: number,          // non-clearing placements still forgiven (reset to rules.grace on a clear)
 *   done: boolean,              // stuck, stopped by the bell, or left; board frozen
 *   left: boolean,              // left mid-game (still shown until the game ends; not in the rematch)
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
 *   size: number,               // === rules.size (kept for existing readers)
 *   hostId: string | null,
 *   order: string[],
 *   players: Record<string, Player>,
 *   settings: Settings,         // host's current choice; editable in lobby and finished
 *   rules: Settings,            // locked snapshot used by the game being played / shown
 *   deadline: number | null,    // epoch ms of the timed-mode bell; null otherwise
 *   endReason: 'stuck' | 'time' | null
 * }} State
 *
 * `now` on start/again and the whole `timeUp` action are SERVER-injected, never from the wire.
 * @typedef {{ t: 'join', id: string, character: CharacterId }
 *   | { t: 'start', id: string, now?: number }
 *   | { t: 'again', id: string, now?: number }
 *   | { t: 'newGame', id: string }
 *   | { t: 'config', id: string, patch: Partial<Settings> }
 *   | { t: 'timeUp', deadline: number }
 *   | { t: 'leave', id: string }
 *   | { t: 'place', id: string, piece: 0 | 1 | 2, x: number, y: number }} Action
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  size: 8,
  mode: 'marathon',
  timedSeconds: 180,
  pieceSet: 'full',
  grace: 1,
  cleanBoardBonus: 300,
});

/**
 * Data table for the settings UI and the validator.
 * `choice`: the value must be one of `values` (else that key is ignored).
 * `range`: a finite number is clamped to [min, max] and snapped to `step` from `min`.
 * @type {{ [K in keyof Settings]:
 *   { kind: 'choice', values: readonly Settings[K][] }
 * | { kind: 'range', min: number, max: number, step: number } }}
 */
export const SETTINGS_SCHEMA = {
  size: { kind: 'choice', values: [8, 9, 10] },
  mode: { kind: 'choice', values: ['marathon', 'timed'] },
  timedSeconds: { kind: 'range', min: 60, max: 300, step: 30 },
  pieceSet: { kind: 'choice', values: ['full', 'simple'] },
  grace: { kind: 'choice', values: [0, 1, 2] },
  cleanBoardBonus: { kind: 'range', min: 0, max: 500, step: 50 },
};

/**
 * Pure validator: `base` with every valid key of `patch` applied (see SETTINGS_SCHEMA).
 * Unknown keys and invalid values are ignored; a non-object patch yields a copy of `base`.
 * @param {unknown} patch
 * @param {Settings} [base]
 * @returns {Settings}
 */
export function normalizeSettings(patch, base = DEFAULT_SETTINGS) {
  /** @type {Record<string, unknown>} */
  const out = { ...base };
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return /** @type {Settings} */ (out);
  const src = /** @type {Record<string, unknown>} */ (patch);
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
    if (!Object.hasOwn(src, key)) continue;
    const v = src[key];
    if (spec.kind === 'choice') {
      if (/** @type {readonly unknown[]} */ (spec.values).includes(v)) out[key] = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      const clamped = Math.min(spec.max, Math.max(spec.min, v));
      out[key] = Math.min(spec.max, spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step);
    }
  }
  return /** @type {Settings} */ (out);
}

/**
 * @param {Settings} a
 * @param {Settings} b
 */
function sameSettings(a, b) {
  return Object.keys(SETTINGS_SCHEMA).every(
    (k) => a[/** @type {keyof Settings} */ (k)] === b[/** @type {keyof Settings} */ (k)]
  );
}

/**
 * @param {number} seed
 * @param {Partial<Settings>} [settings]  e.g. the persisted settings file; normalized
 * @returns {State}
 */
export function initState(seed, settings) {
  const s = normalizeSettings(settings ?? {});
  return {
    phase: 'lobby', seed, size: s.size, hostId: null, order: [], players: {},
    settings: s, rules: { ...s }, deadline: null, endReason: null,
  };
}

/**
 * Fresh player object (helper for reduce and for the mock server).
 * @param {string} id
 * @param {string} name
 * @param {number} color
 * @param {number} size
 * @param {number} [grace]  rules.grace
 * @param {CharacterId | null} [character]
 * @returns {Player}
 */
export function newPlayer(id, name, color, size, grace = DEFAULT_SETTINGS.grace, character = null) {
  return {
    id, name, color, character,
    board: emptyBoard(size),
    handIndex: 0,
    hand: [null, null, null],
    score: 0, streak: 0, graceLeft: grace, done: false, left: false,
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
 * @param {number} [cleanBoardBonus]  rules.cleanBoardBonus
 * @returns {number}
 */
export function placementScore(cells, lines, streak, boardEmptied, cleanBoardBonus = DEFAULT_SETTINGS.cleanBoardBonus) {
  return cells + 10 * lines * lines * (1 + streak) + (boardEmptied ? cleanBoardBonus : 0);
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
 * Rules: BUILD-PLAN.md «Contract A», normative paragraph, + Q4 addendum.
 * @param {State} state
 * @param {Action} action
 * @returns {State}
 */
export function reduce(state, action) {
  switch (action.t) {
    case 'join': {
      if (state.phase !== 'lobby') return state;
      if (typeof action.id !== 'string' || action.id === '') return state;
      if (state.players[action.id]) return state;
      if (!isCharacterId(action.character) || !freeCharacters(state).includes(action.character)) return state;
      const { name, color } = CHARACTERS[action.character];
      return {
        ...state,
        hostId: state.hostId ?? action.id,
        order: [...state.order, action.id],
        players: {
          ...state.players,
          [action.id]: newPlayer(action.id, name, color, state.rules.size, state.rules.grace, action.character),
        },
      };
    }

    case 'config': {
      if (state.phase === 'playing') return state;
      if (action.id !== state.hostId || state.hostId === null) return state;
      const settings = normalizeSettings(action.patch, state.settings);
      if (sameSettings(settings, state.settings)) return state;
      if (state.phase === 'finished') return { ...state, settings };
      const rules = { ...settings };
      /** @type {Record<string, Player>} */
      const players = {};
      for (const id of state.order) {
        const p = state.players[id];
        players[id] = newPlayer(id, p.name, p.color, rules.size, rules.grace, p.character ?? null);
      }
      return { ...state, settings, rules, size: rules.size, players };
    }

    case 'start': {
      if (state.phase !== 'lobby') return state;
      if (action.id !== state.hostId || state.hostId === null) return state;
      if (state.order.length < 1) return state;
      return beginPlay(state, state.seed, action.now);
    }

    case 'place': {
      if (state.phase !== 'playing') return state;
      const p = state.players[action.id];
      if (!p || p.done) return state;
      const { rules } = state;
      const { piece, x, y } = action;
      if (piece !== 0 && piece !== 1 && piece !== 2) return state;
      const pieceId = p.hand[piece];
      if (pieceId == null) return state;
      const cells = PIECES[pieceId].cells;
      if (!canPlace(p.board, rules.size, cells, x, y)) return state;

      let board = place(p.board, rules.size, cells, x, y, p.color);
      const clears = findClears(board, rules.size);
      const lines = clears.rows.length + clears.cols.length;
      if (lines > 0) board = applyClears(board, rules.size, clears);
      const boardEmptied = lines > 0 && board.every((c) => c === 0);
      const gained = placementScore(cells.length, lines, p.streak, boardEmptied, rules.cleanBoardBonus);

      let { streak, graceLeft } = p;
      if (lines > 0) {
        streak += 1;
        graceLeft = rules.grace;
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
        hand = handAt(state.seed, handIndex, rules.pieceSet);
      }
      const done = !anyFit(board, rules.size, hand);

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
      return allDone
        ? { ...state, players, phase: 'finished', endReason: 'stuck' }
        : { ...state, players };
    }

    case 'timeUp': {
      if (state.phase !== 'playing') return state;
      if (state.deadline === null || action.deadline !== state.deadline) return state;
      /** @type {Record<string, Player>} */
      const players = {};
      for (const id of state.order) {
        const p = state.players[id];
        players[id] = p.done ? p : { ...p, done: true };
      }
      return { ...state, players, phase: 'finished', endReason: 'time' };
    }

    case 'leave': {
      const p = state.players[action.id];
      if (!p || p.left) return state;
      const hostId = state.hostId === p.id ? nextHost(state, p.id) : state.hostId;
      if (state.phase !== 'playing') {
        const { [p.id]: _gone, ...players } = state.players;
        return { ...state, hostId, order: state.order.filter((id) => id !== p.id), players };
      }
      const players = { ...state.players, [p.id]: { ...p, done: true, left: true } };
      const allDone = state.order.every((id) => players[id].done);
      return allDone
        ? { ...state, hostId, players, phase: 'finished', endReason: 'stuck' }
        : { ...state, hostId, players };
    }

    case 'again': {
      if (state.phase !== 'finished') return state;
      if (action.id !== state.hostId || state.hostId === null) return state;
      if (state.order.length < 1) return state;
      return beginPlay(state, nextSeed(state.seed), action.now);
    }

    case 'newGame': {
      // Podium → lobby: same players minus those who left, fresh, joins/config/start open again.
      if (state.phase !== 'finished') return state;
      if (action.id !== state.hostId || state.hostId === null) return state;
      const rules = { ...state.settings };
      const order = state.order.filter((id) => !state.players[id].left);
      /** @type {Record<string, Player>} */
      const players = {};
      for (const id of order) {
        const old = state.players[id];
        players[id] = newPlayer(id, old.name, old.color, rules.size, rules.grace, old.character ?? null);
      }
      const hostId = order.includes(state.hostId) ? state.hostId : (order[0] ?? null);
      return {
        ...state, phase: 'lobby', seed: nextSeed(state.seed), hostId, order, players,
        rules, size: rules.size, deadline: null, endReason: null,
      };
    }

    default:
      return state;
  }
}

/**
 * Locks rules ← settings, same players (ids/names/colors) minus those who left, fresh
 * boards/scores, hand 0 dealt, deadline set in timed mode. `state` unchanged if timed mode
 * lacks a finite `now`, or if no player remains.
 * @param {State} state
 * @param {number} seed
 * @param {number | undefined} now
 * @returns {State}
 */
function beginPlay(state, seed, now) {
  const rules = { ...state.settings };
  const timed = rules.mode === 'timed';
  if (timed && !(typeof now === 'number' && Number.isFinite(now))) return state;
  const order = state.order.filter((id) => !state.players[id].left);
  if (order.length < 1) return state;
  const hand0 = handAt(seed, 0, rules.pieceSet);
  /** @type {Record<string, Player>} */
  const players = {};
  for (const id of order) {
    const old = state.players[id];
    players[id] = {
      ...newPlayer(id, old.name, old.color, rules.size, rules.grace, old.character ?? null),
      hand: hand0.slice(),
    };
  }
  return {
    ...state, phase: 'playing', seed, order, players, rules, size: rules.size,
    deadline: timed ? /** @type {number} */ (now) + rules.timedSeconds * 1000 : null,
    endReason: null,
  };
}

/**
 * Who inherits the host role when `leaverId` leaves: the next player after them in join order
 * (wrapping) who has not left — a stuck player still holds a phone and can press «Replay».
 * null if nobody is left.
 * @param {State} state
 * @param {string} leaverId
 * @returns {string | null}
 */
function nextHost(state, leaverId) {
  const i = state.order.indexOf(leaverId);
  const others = [...state.order.slice(i + 1), ...state.order.slice(0, i)];
  return others.find((id) => !state.players[id].left) ?? null;
}

/**
 * Deterministic next seed for «Replay» (reduce stays pure; the seed is part of the state).
 * @param {number} seed
 * @returns {number}
 */
function nextSeed(seed) {
  return Math.floor(mulberry32(seed)() * 4294967296) >>> 0;
}
