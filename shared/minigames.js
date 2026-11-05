// The rules list: every minigame's pure rules, by kind (a content node's `activity.kind`). Adding a
// minigame is one import line and one entry here, plus its type entries. Pure JSDoc ESM, like the rules.

import { BLOCK_RULES } from './game.js';
import { QUIZ_RULES } from './quiz/index.js';

/**
 * A round's status, derived by its minigame from its state. `lobby` lasts until the games' lobbies
 * move to the campaign; `finished` is the podium.
 * @typedef {'lobby' | 'running' | 'finished'} RoundStatus
 */

/**
 * What a minigame's rules supply. Every function is pure; time, randomness and ids come in through
 * actions. Refused actions return the SAME state object.
 * @template S, A
 * @typedef {{
 *   init: (seed: number, settings: any) => S,   // a new round, in its lobby
 *   reduce: (s: S, a: A) => S,
 *   status: (s: S) => RoundStatus,
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
