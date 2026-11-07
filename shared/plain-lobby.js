// The plain lobby: a building block that wraps a minigame's round rules into the rules of a running
// minigame. Eligible players get ready, the game master sets the minigame up and starts a round with the
// ready players, the round runs to its podium, and the game master takes everyone back to the lobby.
// Blocks and quiz use it (shared/minigames.js); a minigame that needs another lobby writes its own rules
// against the same MinigameRules. Pure JSDoc ESM, like the rules it wraps.
//
// Actions (ids, now and inputs injected by the server, never from the wire):
//   join { id, character }      the main game: someone became eligible (listed, not ready)
//   leave { id }                the main game: someone stopped being eligible; a player of the round, running or
//                               on the podium, is marked left (out)
//   ready { id, on }            an eligible player, in the lobby (refused in a lobby with spots)
//   spot { id, spot }           the server, in a lobby with spots: an eligible player now stands on that spot, or
//                               on none (null); a free spot is taken, the one held before is let go
//   config { id, patch }        the game master, in the lobby: the minigame's settings
//   start { id, now, inputs }   the game master, in the lobby, with as many ready players as a round takes
//                               (lobbyWaitsFor): a round with the ready players (each with their spot, in a lobby
//                               with spots), its seed from the lobby's, which then advances
//   lobby { id }                the game master, on the podium: back to the lobby; the round's players come back
//                               ready, except those who left or were taken out, or are no longer eligible; in a
//                               lobby with spots, they hold the spots they left
//   retire { id, target }       the game master, while a round runs: a player of the round still in it is taken out,
//                               marked retired (out); anyone else, a no-op
//   anything else               the running round's own actions (endGame, place, answer, timeUp, …)
// Out: a player who leaves or is taken out is done for the round. While it runs, the round's rules say what that
// means (`out`): blocks ends once everyone is done, the quiz stops waiting for their answer, Pyramide ends,
// backgammon and table football award forfeits. On the podium, a leaver is only marked.
// The round finishing turns the stage to `podium` in the same step.
//
// Walking: the lobby is walkable (MinigameRules `spots`, docs/minigames.md): the eligible players walk it as their
// characters, from the round rules' start positions or the plain lobby's. Round rules that list `spots` add them:
// an eligible player is ready by holding a spot, and there is no "I'm ready".

import { nextSeed } from './rng.js';

/** @typedef {import('./characters.js').CharacterId} CharacterId */
/** @typedef {import('./minigames.js').RoundPlayers} RoundPlayers */
/** @typedef {import('./minigames.js').RoundCtx} RoundCtx */

/**
 * A plain lobby's state. `round`: the running round, or the finished one on the podium; null in the lobby.
 * `players`: the eligible players, in party order (later ones at the end); `ready`: their ids, in that order.
 * `holders`: in a lobby with spots, who holds each spot (spot id → player id; free spots absent), and then
 * `ready` is the holders.
 * @template [R=any]
 * @template [T=any]
 * @typedef {{
 *   stage: 'lobby' | 'running' | 'podium',
 *   seed: number,
 *   settings: T,
 *   players: { id: string, character: CharacterId }[],
 *   ready: string[],
 *   holders: Record<string, string>,
 *   round: R | null,
 * }} PlainLobbyState
 */

/**
 * The plain lobby's own actions; every other action goes to the running round.
 * @typedef {{ t: 'join', id: string, character: CharacterId }
 *   | { t: 'leave', id: string }
 *   | { t: 'ready', id: string, on: boolean }
 *   | import('./minigames.js').SpotAction
 *   | { t: 'config', id: string, patch: unknown }
 *   | { t: 'start', id: string, now: number, inputs?: unknown }
 *   | { t: 'lobby', id: string }
 *   | { t: 'retire', id: string, target: string }} PlainLobbyAction
 */

/**
 * Where the walkers of a lobby without its own start positions start, in world units (16 × 9): left of the TV's
 * panel and below its title, in two rows whose names don't touch; the corners first for the evening's four
 * players, the middle for the development start's six.
 * @type {readonly import('./minigames.js').StartPosition[]}
 */
export const PLAIN_LOBBY_START_POSITIONS = Object.freeze([
  { x: 3.2, y: 5 }, { x: 7.2, y: 5 }, { x: 3.2, y: 7.8 }, { x: 7.2, y: 7.8 }, { x: 5.2, y: 5 }, { x: 5.2, y: 7.8 },
]);

/** A round's player range when its rules give none: one ready player or more. @type {import('./minigames.js').PlayerRange} */
const ONE_OR_MORE = Object.freeze({ min: 1, max: Infinity });

/**
 * The plain lobby's own rule for Start, or null when it is met: the ready players (in a lobby with spots, the
 * spots' holders) within the round's range (`players` in its rules; absent: one or more). The screens show it
 * through startWaitsFor (shared/campaign/index.js), after the main game's rule.
 * @param {number} ready how many are ready @param {import('./minigames.js').PlayerRange} [range]
 * @returns {{ t: 'players', min: number, max: number, ready: number } | null}
 */
export function lobbyWaitsFor(ready, range = ONE_OR_MORE) {
  return ready < range.min || ready > range.max ? { t: 'players', min: range.min, max: range.max, ready } : null;
}

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

  /**
   * New holders, and the ready players with them (the holders, in party order).
   * @param {S} s @param {Record<string, string>} holders @returns {S}
   */
  const withHolders = (s, holders) => {
    const holding = Object.values(holders);
    return { ...s, holders, ready: s.players.map((p) => p.id).filter((id) => holding.includes(id)) };
  };

  /** The holders `keep` keeps. @param {Record<string, string>} holders @param {(id: string) => boolean} keep */
  const holdersKept = (holders, keep) => Object.fromEntries(Object.entries(holders).filter(([, id]) => keep(id)));

  /** @param {S} s @param {any} action @param {RoundCtx} ctx @returns {S} */
  const toRound = (s, action, ctx) => (s.round ? withRound(s, rules.reduce(s.round, action, ctx)) : s);

  /**
   * A player of the round goes out (left: `left`, taken out: `retired`), marked done; while the round runs, its
   * rules' `out` says what it means. A player not in the round, or already out that way, changes nothing; nor does
   * taking out one who is done (stuck, or left).
   * @param {S} s @param {string} id @param {'left' | 'retired'} how @returns {S}
   */
  const out = (s, id, how) => {
    const round = s.round;
    if (!round || !round.order.includes(id)) return s;
    const p = round.players[id];
    if (p[how] || (how === 'retired' && p.done)) return s;
    const marked = { ...round, players: { ...round.players, [id]: { ...p, done: true, [how]: true } } };
    return withRound(s, s.stage === 'running' && !p.done ? rules.out(marked, id) : marked);
  };

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
        const next = s.stage === 'lobby' ? s : out(s, a.id, 'left');
        if (!listed) return next;
        return {
          ...next, players: next.players.filter((p) => p.id !== a.id), ready: next.ready.filter((id) => id !== a.id),
          holders: holdersKept(next.holders, (id) => id !== a.id),
        };
      }

      case 'ready': {
        if (rules.spots || s.stage !== 'lobby' || typeof a.on !== 'boolean' || !s.players.some((p) => p.id === a.id)) return s;
        if (s.ready.includes(a.id) === a.on) return s;
        const ready = a.on ? [...s.ready, a.id] : s.ready.filter((id) => id !== a.id);
        return { ...s, ready: s.players.map((p) => p.id).filter((id) => ready.includes(id)) };
      }

      case 'spot': {
        if (!rules.spots || s.stage !== 'lobby' || !s.players.some((p) => p.id === a.id)) return s;
        if (a.spot !== null && !rules.spots.some((spot) => spot.id === a.spot)) return s;
        // standing on one spot at most: any other is let go, and this one taken if it's free
        const holders = holdersKept(s.holders, (id) => id !== a.id);
        if (a.spot !== null && !holders[a.spot]) holders[a.spot] = a.id;
        return JSON.stringify(holders) === JSON.stringify(s.holders) ? s : withHolders(s, holders);
      }

      case 'config': {
        if (s.stage !== 'lobby' || !isGameMaster(ctx, a.id)) return s;
        const settings = rules.settings(a.patch, s.settings);
        return JSON.stringify(settings) === JSON.stringify(s.settings) ? s : { ...s, settings };
      }

      case 'start': {
        if (s.stage !== 'lobby' || !isGameMaster(ctx, a.id)) return s;
        const spotOf = (/** @type {string} */ id) => Object.keys(s.holders).find((spot) => s.holders[spot] === id);
        const players = s.players.filter((p) => s.ready.includes(p.id)).map((p) => (rules.spots ? { ...p, spot: spotOf(p.id) } : p));
        if (lobbyWaitsFor(players.length, rules.players)) return s;
        const round = rules.init({ seed: s.seed, settings: s.settings, players, now: a.now, inputs: a.inputs });
        return round ? { ...s, stage: 'running', seed: nextSeed(s.seed), ready: [], round } : s;
      }

      case 'lobby': {
        if (s.stage !== 'podium' || !isGameMaster(ctx, a.id) || !s.round) return s;
        const round = s.round;
        const back = (/** @type {string} */ id) => round.order.includes(id) && !round.players[id]?.left && !round.players[id]?.retired
          && s.players.some((p) => p.id === id);
        const lobby = { ...s, stage: /** @type {const} */ ('lobby'), round: null };
        if (rules.spots) return withHolders(lobby, holdersKept(s.holders, back));
        return { ...lobby, ready: s.players.map((p) => p.id).filter(back) };
      }

      case 'retire':
        return s.stage === 'running' && isGameMaster(ctx, a.id) ? out(s, a.target, 'retired') : s;

      default:
        return s.stage === 'running' ? toRound(s, action, ctx) : s;
    }
  }

  return {
    open: ({ seed, settings, players }) => ({
      stage: 'lobby', seed, settings, players: players.map(({ id, character }) => ({ id, character })), ready: [], holders: {}, round: null,
    }),
    reduce,
    status: (s) => {
      if (!s || typeof s !== 'object' || !Array.isArray(s.players) || !Array.isArray(s.ready) || !s.holders) return null;
      const round = s.round ? rules.status(s.round) : null;
      if (s.stage === 'lobby') return s.round === null ? 'lobby' : null;
      if (s.stage === 'running') return round === 'running' ? 'running' : null;
      if (s.stage === 'podium') return round === 'finished' ? 'podium' : null;
      return null;
    },
    result: (s, node) => rules.result(/** @type {R} */ (s.round), node),
    asked: (s) => (s.stage === 'running' && s.round && rules.asked ? rules.asked(s.round) : []),
    ready: (s) => s.ready,
    startPositions: rules.startPositions ?? PLAIN_LOBBY_START_POSITIONS,
    players: rules.players,
    spots: (s) => (s.stage === 'lobby'
      ? (rules.spots ?? []).map(({ id, label, x, y, w, h }) => ({ id, label, x, y, w, h, holder: s.holders[id] ?? null }))
      : null),
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
