// The plain lobby: a building block that wraps a minigame's round rules into the rules of a running
// minigame. Eligible players get ready, the game master sets the minigame up and starts a round with the
// ready players, the round runs to its podium, and the game master takes everyone back to the lobby.
// Blocks and quiz use it (shared/minigames.js); a minigame that needs another lobby writes its own rules
// against the same MinigameRules. Pure JSDoc ESM, like the rules it wraps.
//
// Actions (ids, now and inputs injected by the server, never from the wire):
//   join { id, character }      the main game: someone became eligible (listed, not ready)
//   leave { id }                the main game: someone stopped being eligible; passed on to a running round
//                               or the podium, which decide what it means
//   ready { id, on }            an eligible player, in the lobby
//   config { id, patch }        the game master, in the lobby: the minigame's settings
//   start { id, now, inputs }   the game master, in the lobby, with one ready player or more: a round with the
//                               ready players, its seed from the lobby's, which then advances
//   lobby { id }                the game master, on the podium: back to the lobby; the round's players come back
//                               ready, except those who left or were taken out, or are no longer eligible
//   retire { id, target }       the game master, while a round runs: the round's own rule (`retire: true`), else
//                               the target's leave from the round
//   anything else               the running round's own actions (endGame, place, answer, timeUp, …)
// The round finishing turns the stage to `podium` in the same step.

import { nextSeed } from './rng.js';

/** @typedef {import('./characters.js').CharacterId} CharacterId */
/** @typedef {import('./minigames.js').RoundPlayers} RoundPlayers */
/** @typedef {import('./minigames.js').RoundCtx} RoundCtx */

/**
 * A plain lobby's state. `round`: the running round, or the finished one on the podium; null in the lobby.
 * `players`: the eligible players, in party order (later ones at the end); `ready`: their ids, in that order.
 * @template [R=any]
 * @template [T=any]
 * @typedef {{
 *   stage: 'lobby' | 'running' | 'podium',
 *   seed: number,
 *   settings: T,
 *   players: { id: string, character: CharacterId }[],
 *   ready: string[],
 *   round: R | null,
 * }} PlainLobbyState
 */

/**
 * The plain lobby's own actions; every other action goes to the running round.
 * @typedef {{ t: 'join', id: string, character: CharacterId }
 *   | { t: 'leave', id: string }
 *   | { t: 'ready', id: string, on: boolean }
 *   | { t: 'config', id: string, patch: unknown }
 *   | { t: 'start', id: string, now: number, inputs?: unknown }
 *   | { t: 'lobby', id: string }
 *   | { t: 'retire', id: string, target: string }} PlainLobbyAction
 */

/** @param {RoundCtx} ctx @param {unknown} id */
const isGameMaster = (ctx, id) => ctx.gameMasterId !== null && id === ctx.gameMasterId;

/**
 * A minigame's rules: the round rules wrapped in a plain lobby.
 * @template {RoundPlayers} R, A
 * @template [T=any]
 * @param {import('./minigames.js').RoundRules<R, A, T>} rules
 * @returns {import('./minigames.js').MinigameRules<PlainLobbyState<R, T>, PlainLobbyAction | A, T>}
 */
export function plainLobby(rules) {
  /** @typedef {PlainLobbyState<R, T>} S */

  /**
   * Installs the round's next state; a running round that finished turns the stage to `podium`.
   * @param {S} s @param {R | null} round @returns {S}
   */
  const withRound = (s, round) => {
    if (round === s.round) return s;
    const finished = s.stage === 'running' && round !== null && rules.status(round) === 'finished';
    return { ...s, round, ...(finished ? { stage: /** @type {const} */ ('podium') } : {}) };
  };

  /** @param {S} s @param {any} action @param {RoundCtx} ctx @returns {S} */
  const toRound = (s, action, ctx) => (s.round ? withRound(s, rules.reduce(s.round, action, ctx)) : s);

  /** @param {S} s @param {PlainLobbyAction | A} action @param {RoundCtx} ctx @returns {S} */
  function reduce(s, action, ctx) {
    const a = /** @type {PlainLobbyAction} */ (action);
    switch (a.t) {
      case 'join': {
        if (s.players.some((p) => p.id === a.id)) return s;
        return { ...s, players: [...s.players, { id: a.id, character: a.character }] };
      }

      case 'leave': {
        const listed = s.players.some((p) => p.id === a.id);
        const next = s.stage === 'lobby' ? s : toRound(s, { t: 'leave', id: a.id }, ctx);
        if (!listed) return next;
        return { ...next, players: next.players.filter((p) => p.id !== a.id), ready: next.ready.filter((id) => id !== a.id) };
      }

      case 'ready': {
        if (s.stage !== 'lobby' || typeof a.on !== 'boolean' || !s.players.some((p) => p.id === a.id)) return s;
        if (s.ready.includes(a.id) === a.on) return s;
        const ready = a.on ? [...s.ready, a.id] : s.ready.filter((id) => id !== a.id);
        return { ...s, ready: s.players.map((p) => p.id).filter((id) => ready.includes(id)) };
      }

      case 'config': {
        if (s.stage !== 'lobby' || !isGameMaster(ctx, a.id)) return s;
        const settings = rules.settings(a.patch, s.settings);
        return JSON.stringify(settings) === JSON.stringify(s.settings) ? s : { ...s, settings };
      }

      case 'start': {
        if (s.stage !== 'lobby' || !isGameMaster(ctx, a.id)) return s;
        const players = s.players.filter((p) => s.ready.includes(p.id));
        if (players.length === 0) return s;
        const round = rules.init({ seed: s.seed, settings: s.settings, players, now: a.now, inputs: a.inputs });
        return round ? { ...s, stage: 'running', seed: nextSeed(s.seed), ready: [], round } : s;
      }

      case 'lobby': {
        if (s.stage !== 'podium' || !isGameMaster(ctx, a.id) || !s.round) return s;
        const round = s.round;
        const back = (/** @type {string} */ id) => round.order.includes(id) && !round.players[id]?.left && !round.players[id]?.retired;
        return { ...s, stage: 'lobby', ready: s.players.map((p) => p.id).filter(back), round: null };
      }

      case 'retire': {
        if (s.stage !== 'running') return s;
        if (rules.retire) return toRound(s, a, ctx);
        return isGameMaster(ctx, a.id) ? toRound(s, { t: 'leave', id: a.target }, ctx) : s;
      }

      default:
        return s.stage === 'running' ? toRound(s, action, ctx) : s;
    }
  }

  return {
    open: ({ seed, settings, players }) => ({
      stage: 'lobby', seed, settings, players: players.map(({ id, character }) => ({ id, character })), ready: [], round: null,
    }),
    reduce,
    status: (s) => {
      if (!s || typeof s !== 'object' || !Array.isArray(s.players) || !Array.isArray(s.ready)) return null;
      const round = s.round ? rules.status(s.round) : null;
      if (s.stage === 'lobby') return s.round === null ? 'lobby' : null;
      if (s.stage === 'running') return round === 'running' ? 'running' : null;
      if (s.stage === 'podium') return round === 'finished' ? 'podium' : null;
      return null;
    },
    result: (s, node) => rules.result(/** @type {R} */ (s.round), node),
    ready: (s) => s.ready,
    shows: (s) => {
      const round = s.round;
      if (!round) return s.players.map((p) => p.id);
      return s.stage === 'running' ? round.order.filter((id) => !round.players[id].done && !round.players[id].left) : [...round.order];
    },
    settings: (patch, base) => rules.settings(patch, base),
    validateSettings: rules.validateSettings,
    sampleSettings: rules.sampleSettings,
    deadline: (s) => (s.stage === 'running' && s.round ? rules.deadline(s.round) : null),
    deadlineAction: rules.deadlineAction,
    shiftDeadline: (s, by) => {
      if (s.stage !== 'running' || !s.round) return s;
      const round = rules.shiftDeadline(s.round, by);
      return round === s.round ? s : { ...s, round };
    },
    resume: (s) => {
      if (!s.round || !rules.resume) return s;
      const round = rules.resume(s.round);
      return round === s.round ? s : { ...s, round };
    },
    describe: (s) => (s.round ? rules.describe(s.round) : `lobby, ${s.ready.length} of ${s.players.length} ready`),
  };
}
