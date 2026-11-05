// P0 contract + Q4 addendum (2026-11-04) — signatures and State/Action shapes FROZEN.
// Rules: BUILD-PLAN.md «Contract A» (normative) + the Q4 settings/timed-mode addendum.

import { emptyBoard, canPlace, place, findClears, applyClears, anyFit } from './board.js';
import { PIECES, handAt } from './pieces.js';
import { CHARACTERS } from './characters.js';

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
 *   name: string,               // copied from CHARACTERS[character] when the round starts
 *   color: number,              // 1..4, maps to CSS var --p1..--p4; = CHARACTERS[character].color
 *   character: CharacterId | null,  // null only for saves from before M3
 *   board: number[],            // see board.js
 *   handIndex: number,          // n of the hand currently held (0-based)
 *   hand: (PieceId | null)[],   // length 3, null = already placed
 *   score: number,
 *   streak: number,             // consecutive clearing placements before now
 *   graceLeft: number,          // non-clearing placements still forgiven (reset to rules.grace on a clear)
 *   done: boolean,              // stuck, stopped by the bell, retired, ended by the host, or left; board frozen
 *   left: boolean,              // left mid-game (still shown until the game ends; not in the rematch)
 *   retired?: boolean,          // taken out by the host mid-game: still ranked, keeps seat + character (absent on old saves)
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
 *   phase: 'playing' | 'finished',
 *   seed: number,
 *   size: number,               // === rules.size (kept for existing readers)
 *   order: string[],
 *   players: Record<string, Player>,
 *   rules: Settings,            // locked snapshot used by the game being played / shown (choice: the campaign)
 *   deadline: number | null,    // epoch ms of the timed-mode bell; null otherwise
 *   endReason: 'stuck' | 'time' | 'host' | null   // host = the host ended the game (endGame)
 * }} State
 *
 * The whole `timeUp` action is SERVER-injected, never from the wire. A round starts with startGame.
 * @typedef {{ t: 'timeUp', deadline: number }
 *   | { t: 'leave', id: string }
 *   | { t: 'endGame', id: string }
 *   | { t: 'retire', id: string, target: string }
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
 * Problems in content settings, as readable lines (empty = valid): an unknown key, or a value the
 * schema would change (normalizeSettings ignores or snaps it).
 * @param {unknown} settings
 * @returns {string[]}
 */
export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return ['settings must be an object'];
  return Object.entries(settings).flatMap(([key, v]) => {
    if (!Object.hasOwn(SETTINGS_SCHEMA, key)) return [`unknown setting "${key}"`];
    return normalizeSettings({ [key]: v })[/** @type {keyof Settings} */ (key)] === v ? [] : [`setting "${key}" can't be ${JSON.stringify(v)}`];
  });
}

/**
 * A new round, under way: the players handed in (fresh boards, hand 0 dealt from the seed), the settings
 * locked in as the rules (normalized), the bell set in timed mode. null when there is no player, or when
 * timed mode lacks a finite `now`.
 * @param {import('./minigames.js').RoundStart<Partial<Settings>>} start
 * @returns {State | null}
 */
export function startGame({ seed, settings, players, now }) {
  const rules = normalizeSettings(settings ?? {});
  const timed = rules.mode === 'timed';
  if (timed && !(typeof now === 'number' && Number.isFinite(now))) return null;
  if (players.length < 1) return null;
  const hand0 = handAt(seed, 0, rules.pieceSet);
  /** @type {Record<string, Player>} */
  const seated = {};
  for (const { id, character } of players) {
    const { name, color } = CHARACTERS[character];
    seated[id] = { ...newPlayer(id, name, color, rules.size, rules.grace, character), hand: hand0.slice() };
  }
  return {
    phase: 'playing', seed, size: rules.size, order: players.map((p) => p.id), players: seated, rules,
    deadline: timed ? now + rules.timedSeconds * 1000 : null,
    endReason: null,
  };
}

/**
 * Fresh player object (helper for reduce).
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
    score: 0, streak: 0, graceLeft: grace, done: false, left: false, retired: false,
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
 * @param {import('./minigames.js').RoundCtx} ctx  the party's host (the host-only actions)
 * @returns {State}
 */
export function reduce(state, action, ctx) {
  switch (action.t) {
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
      return finishIfAllDone(state, players);
    }

    case 'timeUp': {
      if (state.phase !== 'playing') return state;
      if (state.deadline === null || action.deadline !== state.deadline) return state;
      return { ...state, players: allMarkedDone(state), phase: 'finished', endReason: 'time' };
    }

    case 'endGame': {
      // host stops the game (e.g. someone dropped while not stuck): everyone still playing is frozen, scores kept
      if (state.phase !== 'playing' || !isHost(ctx, action.id)) return state;
      return { ...state, players: allMarkedDone(state), phase: 'finished', endReason: 'host' };
    }

    case 'retire': {
      // host takes one player out: done (board frozen, still ranked) but NOT left — the seat, the
      // character and a reconnect stay theirs. The last one out ends the game like getting stuck.
      if (state.phase !== 'playing' || !isHost(ctx, action.id)) return state;
      const t = state.players[action.target];
      if (!t || t.done || t.left) return state;
      return finishIfAllDone(state, { ...state.players, [t.id]: { ...t, done: true, retired: true } });
    }

    case 'leave': {
      const p = state.players[action.id];
      if (!p || p.left) return state;
      if (state.phase === 'finished') { // off the podium
        const { [p.id]: _gone, ...players } = state.players;
        return { ...state, order: state.order.filter((id) => id !== p.id), players };
      }
      return finishIfAllDone(state, { ...state.players, [p.id]: { ...p, done: true, left: true } });
    }

    default:
      return state;
  }
}

/** The party's host, passed in by the campaign. @param {{ hostId: string | null }} ctx @param {string} id */
const isHost = (ctx, id) => ctx.hostId !== null && id === ctx.hostId;

/** Every seated player done (already-done ones kept as is). @param {State} state @returns {Record<string, Player>} */
function allMarkedDone(state) {
  /** @type {Record<string, Player>} */
  const players = {};
  for (const id of state.order) {
    const p = state.players[id];
    players[id] = p.done ? p : { ...p, done: true };
  }
  return players;
}

/**
 * Installs `players`; the game finishes (endReason 'stuck') once every seated player is done.
 * @param {State} state
 * @param {Record<string, Player>} players
 * @returns {State}
 */
function finishIfAllDone(state, players) {
  return state.order.every((id) => players[id].done)
    ? { ...state, players, phase: 'finished', endReason: 'stuck' }
    : { ...state, players };
}

/**
 * The block game's entry in the rules list (shared/minigames.js).
 * @type {import('./minigames.js').MinigameRules<State, Action, Settings>}
 */
export const BLOCK_RULES = {
  init: startGame,
  reduce,
  status: (s) => (s.phase === 'playing' ? 'running' : s.phase === 'finished' ? 'finished' : null),
  result: (s) => ({
    ranking: ranking(s).map((r) => ({ character: s.players[r.id].character ?? null, score: r.score, rank: r.rank })),
    endReason: s.endReason,
  }),
  settings: (patch, base) => normalizeSettings(patch, base),
  validateSettings,
  sampleSettings: { mode: 'timed', timedSeconds: 60 },
  deadline: (s) => (s.phase === 'playing' && typeof s.deadline === 'number' ? s.deadline : null),
  deadlineAction: (deadline) => ({ t: 'timeUp', deadline }),
  shiftDeadline: (s, by) => (s.phase === 'playing' && typeof s.deadline === 'number' ? { ...s, deadline: s.deadline + by } : s),
  describe: (s) => `block game ${s.phase}${s.order.length ? ` (${s.order.map((id) => `${s.players[id].name} ${s.players[id].score}`).join(', ')})` : ''}`,
};
