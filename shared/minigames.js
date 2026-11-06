// The rules list: every minigame's pure rules, by kind (a content node's `activity.kind`). Adding a
// minigame is one import line and one entry here, plus its type entries. Pure JSDoc ESM, like the rules.

import { BLOCK_RULES } from './game.js';
import { QUIZ_RULES } from './quiz/index.js';
import { PYRAMIDE_RULES } from './pyramide.js';
import { BACKGAMMON_RULES } from './backgammon.js';
import { FOOSBALL_RULES } from './foosball.js';
import { plainLobby } from './plain-lobby.js';

/** @typedef {import('./characters.js').CharacterId} CharacterId */

/**
 * A round's status, derived by its round rules from its state. `finished` is its podium.
 * @typedef {'running' | 'finished'} RoundStatus
 */

/**
 * A round as the round screens get it: its kind, its status, and its round server's view of its state.
 * @typedef {{ kind: MinigameKind, status: RoundStatus, view: any }} RoundView
 */

/**
 * A running minigame's status, from its start to its end: its lobby, a running round, or a round's podium.
 * @typedef {'lobby' | 'running' | 'podium'} MinigameStatus
 */

/**
 * A spot: a marked place on a walkable lobby that an eligible player takes by stepping onto it, or by tapping it
 * on their phone. `id`: the minigame's name for it; `label`: how the phone lists it; `x`, `y`, `w`, `h`: its area
 * in world units (16 × 9, shared/world.js), as the TV draws it; `holder`: the player holding it, from the
 * minigame's state, or null while it's free.
 * @typedef {{ id: string, label: string, x: number, y: number, w: number, h: number, holder: string | null }} Spot
 */

/**
 * A start position: where a player who starts walking a walkable lobby stands (its feet, in world units), unless
 * they hold a spot. The minigame places them where its TV screen leaves room, clear of its spots and panels.
 * @typedef {{ x: number, y: number }} StartPosition
 */

/**
 * What the main game tells a minigame whose lobby is walkable: an eligible player now stands on a spot (`spot`:
 * its id), or on none (null), after stepping onto it, off it or from one to another. Injected by the server,
 * never taken from the wire.
 * @typedef {{ t: 'spot', id: string, spot: string | null }} SpotAction
 */

/**
 * The running minigame as views carry it (`view.minigame`, null while none runs): its kind, its status, its
 * server code's view of its state (the same for everyone, server/minigames.ts), the players it shows itself
 * (`shows`), its spots while its players walk (`spots`: MinigameRules), and the tableau's content rules for the
 * Start button (`required`: its `eligible` and `allReady`).
 * @typedef {{ kind: MinigameKind, status: MinigameStatus, view: any, shows: string[], spots: Spot[] | null,
 *   required: { eligible?: CharacterId[], allReady?: true } }} MinigameView
 */

/**
 * The round's players, as every minigame's view carries them: the frame's podium, round controls and presence
 * read them, whatever the minigame. `order`: the seated players in party order; `score`: ranked by the shared
 * rule (shared/ranking.js), unless every player has a `rank` of its own (Pyramide's teams, set on the podium); `left`: gone from the evening; `done`: out of this round (stuck, or taken out:
 * `retired`); `endReason`: how a finished round ended (`time`, `gm`, or the minigame's own).
 * @typedef {{
 *   order: string[],
 *   players: Record<string, { name: string, color: number, score: number, rank?: number, left?: boolean, done?: boolean, retired?: boolean }>,
 *   endReason?: string | null,
 * }} RoundPlayers
 */

/**
 * What a finished round reports; the campaign records it once. `ranking`: every seated player in display
 * order (character null only in saves from before characters), ties sharing a rank. `counters`: the
 * minigame's own counters, added to the facts. `asked`: content ids the round used up for the evening
 * (facts.asked: never asked again).
 * @typedef {{
 *   ranking: { character: CharacterId, score: number, rank: number }[],
 *   endReason: string | null,
 *   counters?: Record<string, number>,
 *   asked?: string[],
 * }} RoundResult
 */

/**
 * What a round starts from, handed in by its lobby: the seed, the minigame's settings (locked in as the
 * round's rules), the players (the ready ones, in party order, each with the spot they hold in a lobby with
 * spots), the time, and the round server's inputs (the quiz: its candidate questions).
 * @template [T=any]
 * @typedef {{ seed: number, settings: T, players: { id: string, character: CharacterId, spot?: string }[], now: number, inputs?: any }} RoundStart
 */

/**
 * What the campaign passes with every action of a minigame (and its lobby passes on to its round): the
 * game master (a minigame stores none), for its own game-master-only actions.
 * @typedef {{ gameMasterId: string | null }} RoundCtx
 */

/**
 * What the main game hands a minigame when the game master starts it: the seed (each round's seed derives
 * from it), the tableau's settings (the content's, over the minigame's defaults), the eligible players in
 * party order, and the time.
 * @template [T=any]
 * @typedef {{ seed: number, settings: T, players: { id: string, character: CharacterId }[], now: number }} MinigameStart
 */

/** How many ready players a round takes, both ends included: backgammon's 2 to 4. @typedef {{ min: number, max: number }} PlayerRange */

/**
 * What a round's rules supply: one play of a minigame, from its start to its podium. Every function is
 * pure; time, randomness and ids come in through actions. Refused actions return the SAME state object.
 * A plain lobby (shared/plain-lobby.js) wraps them into a minigame's rules.
 * @template S, A
 * @template [T=any]
 * @typedef {{
 *   init: (start: RoundStart<T>) => S | null,  // a new round, running; null: it cannot start (nothing to ask)
 *   reduce: (s: S, a: A, ctx: RoundCtx) => S,
 *   status: (s: S) => RoundStatus | null,       // null: not a round this release can resume (an older save)
 *   result: (s: S, node: string) => RoundResult,   // once finished; node: the tableau it ran at
 *   settings: (patch: unknown, base?: T) => T,  // `base` (default: the minigame's defaults) with every valid key of `patch`
 *   validateSettings: (settings: unknown) => string[],   // a content node's settings: problems, as readable lines
 *   sampleSettings: object,                     // the development start's settings (ITLOE_CONTENT=minigame:<kind>)
 *   deadline: (s: S) => number | null,          // the next deadline (epoch ms), or null: nothing on a clock
 *   deadlineAction: (deadline: number) => A,    // fired when it passes; a stale one must be refused
 *   shiftDeadline: (s: S, by: number) => S,     // deadlines moved by a downtime (ms): resume, sleep
 *   resume?: (s: S) => S,                       // what a restart does besides the shift
 *   retire?: true,                              // the reducer takes the game master's retire itself (else: the target's leave)
 *   spots?: readonly Omit<Spot, 'holder'>[],    // the lobby's spots: holding one is being ready, with no "I'm ready"
 *   startPositions?: readonly StartPosition[],  // where its lobby's walkers start (MinigameRules; absent: the plain lobby's)
 *   players?: PlayerRange,                      // how many ready players a round takes (absent: one or more)
 *   describe: (s: S) => string,                 // the round in the boot log
 * }} RoundRules
 */

/**
 * What a minigame's rules supply: the minigame from the game master's start to his end, its lobby, rounds
 * and podiums. The main game reduces it with the minigame's own actions and its `join { id, character }`
 * (someone became eligible) and `leave { id }` (someone stopped being eligible, or left the evening).
 * Every function is pure; refused actions return the SAME state object.
 * @template S, A
 * @template [T=any]
 * @typedef {{
 *   open: (start: MinigameStart<T>) => S,       // the minigame's state, in its lobby
 *   reduce: (s: S, a: A, ctx: RoundCtx) => S,
 *   status: (s: S) => MinigameStatus | null,    // null: not a state this release can resume (an older save)
 *   result: (s: S, node: string) => RoundResult, // the round's, once it turned `podium`; node: the tableau
 *   ready: (s: S) => string[],                  // the players ready for the next round
 *   shows: (s: S) => string[],                  // the players it draws itself (everyone else is a wisp)
 *   spots?: (s: S) => Spot[] | null,            // a walkable lobby: its spots while the players it shows walk, else null
 *   startPositions?: readonly StartPosition[],  // where a player stands on becoming a walker, if not holding a spot
 *   players?: PlayerRange,                      // how many ready players a round takes (absent: one or more)
 *   settings: (patch: unknown, base?: T) => T,  // `base` (default: the minigame's defaults) with every valid key of `patch`
 *   validateSettings: (settings: unknown) => string[],   // a content node's settings: problems, as readable lines
 *   sampleSettings: object,                     // the development start's settings (ITLOE_CONTENT=minigame:<kind>)
 *   deadline: (s: S) => number | null,          // the next deadline (epoch ms), or null: nothing on a clock
 *   deadlineAction: (deadline: number) => A,    // fired when it passes; a stale one must be refused
 *   shiftDeadline: (s: S, by: number) => S,     // deadlines moved by a downtime (ms): resume, sleep
 *   resume?: (s: S) => S,                       // what a restart does besides the shift
 *   describe: (s: S) => string,                 // the minigame in the boot log
 * }} MinigameRules
 */

export const MINIGAMES = {
  blocks: plainLobby(BLOCK_RULES),
  quiz: plainLobby(QUIZ_RULES),
  pyramide: plainLobby(PYRAMIDE_RULES),
  backgammon: plainLobby(BACKGAMMON_RULES),
  foosball: plainLobby(FOOSBALL_RULES),
};

/** @typedef {keyof typeof MINIGAMES} MinigameKind */

/**
 * A registered minigame's rules, or null (a scene, an unknown kind).
 * @param {unknown} kind @returns {MinigameRules<any, any> | null}
 */
export const minigame = (kind) => (typeof kind === 'string' && Object.hasOwn(MINIGAMES, kind) ? MINIGAMES[/** @type {MinigameKind} */ (kind)] : null);

/**
 * The spot at a world position, or null. @param {readonly Spot[]} spots @param {number} x @param {number} y
 * @returns {string | null}
 */
export function spotAt(spots, x, y) {
  return spots.find((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h)?.id ?? null;
}

/**
 * A walker's step on a walkable lobby, edge-triggered like the doors: the spot under it now (`at`), and whether
 * it stepped onto or off a spot (`changed`). A walker's first known position (`before` undefined) only sets
 * where it stands: standing on a spot is not stepping onto it.
 * @param {readonly Spot[]} spots @param {string | null | undefined} before the spot under it before, undefined: unknown
 * @param {number} x @param {number} y
 * @returns {{ at: string | null, changed: boolean }}
 */
export function spotStep(spots, before, x, y) {
  const at = spotAt(spots, x, y);
  return { at, changed: before !== undefined && at !== before };
}
