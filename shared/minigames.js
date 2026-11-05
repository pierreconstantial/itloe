// The rules list: every minigame's pure rules, by kind (a content node's `activity.kind`). Adding a
// minigame is one import line and one entry here, plus its type entries. Pure JSDoc ESM, like the rules.

import { BLOCK_RULES } from './game.js';
import { QUIZ_RULES } from './quiz/index.js';

/** @typedef {import('./characters.js').CharacterId} CharacterId */

/**
 * A round's status, derived by its minigame from its state. `finished` is the podium; between rounds there
 * is no round (the room at the tableau).
 * @typedef {'running' | 'finished'} RoundStatus
 */

/**
 * The running round as views carry it (`view.round`, null between rounds): its kind, its status, and its
 * minigame's view of its state, the same for everyone (server/minigames.ts).
 * @typedef {{ kind: MinigameKind, status: RoundStatus, view: any }} RoundView
 */

/**
 * The round's players, as every minigame's view carries them: the frame's podium, host controls and presence
 * read them, whatever the minigame. `order`: the seated players in party order; `score`: ranked by the shared
 * rule (shared/ranking.js); `left`: gone from the evening; `done`: out of this round (stuck, or taken out:
 * `retired`); `endReason`: how a finished round ended (`time`, `host`, or the minigame's own).
 * @typedef {{
 *   order: string[],
 *   players: Record<string, { name: string, color: number, score: number, left?: boolean, done?: boolean, retired?: boolean }>,
 *   endReason?: string | null,
 * }} RoundPlayers
 */

/**
 * What a finished round reports; the campaign records it once. `ranking`: every seated player in display
 * order (character null only in saves from before characters), ties sharing a rank. `counters`: the
 * minigame's own counters, added to the facts. `asked`: content ids the round used up for the evening
 * (facts.asked: never asked again).
 * @typedef {{
 *   ranking: { character: CharacterId | null, score: number, rank: number }[],
 *   endReason: string | null,
 *   counters?: Record<string, number>,
 *   asked?: string[],
 * }} RoundResult
 */

/**
 * What a round starts from, handed in by the campaign: the seed, the tableau's settings (locked in as the
 * round's rules), the players (every party member present, in party order), the time, and the minigame's
 * server inputs (the quiz: its candidate questions).
 * @template [T=any]
 * @typedef {{ seed: number, settings: T, players: { id: string, character: CharacterId }[], now: number, inputs?: any }} RoundStart
 */

/**
 * What the campaign passes with every action of a round: the party's host (a minigame stores none), for
 * the minigame's own host-only actions.
 * @typedef {{ hostId: string | null }} RoundCtx
 */

/**
 * What a minigame's rules supply. Every function is pure; time, randomness and ids come in through
 * actions. Refused actions return the SAME state object.
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
 *   retire?: true,                              // the reducer takes the host's retire itself (else: the target's leave)
 *   describe: (s: S) => string,                 // the round in the boot log
 * }} MinigameRules
 */

export const MINIGAMES = {
  blocks: BLOCK_RULES,
  quiz: QUIZ_RULES,
};

/** @typedef {keyof typeof MINIGAMES} MinigameKind */

/**
 * A registered minigame's rules, or null (a scene, an unknown kind).
 * @param {unknown} kind @returns {MinigameRules<any, any> | null}
 */
export const minigame = (kind) => (typeof kind === 'string' && Object.hasOwn(MINIGAMES, kind) ? MINIGAMES[/** @type {MinigameKind} */ (kind)] : null);
