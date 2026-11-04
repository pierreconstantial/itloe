// Contract D v2 + addendum A1 — campaign typedefs (pure data; no code). Everything persisted is
// keyed by STABLE content ids and characters, never by playerIds, except the party roster itself.
export {};

/** @typedef {import('../game.js').State} BlockState */
/** @typedef {import('../game.js').Settings} Settings */
/** @typedef {import('../characters.js').CharacterId} CharacterId */

// ---------------------------------------------------------------- content (data, user-edited)

/**
 * Condition, evaluated by holds(cond, facts).
 * @typedef {{ always: true }
 *   | { flag: string }
 *   | { done: string }                      // node id
 *   | { unlocked: string }                  // node id
 *   | { count: string, gte: number }        // facts.counters[count] >= gte
 *   | { all: Condition[] } | { any: Condition[] } | { not: Condition }} Condition
 */

/**
 * Effect, applied once when a node first completes (or by gm).
 * @typedef {{ flag: string } | { item: string } | { unlock: string }} Effect
 */

/**
 * @typedef {{ kind: 'blocks', settings?: Partial<Settings> }
 *   | { kind: 'scene', sceneId: string }
 *   | { kind: 'quiz', quizId: string }} Activity
 */

/** Door rectangle in world units (16 × 9), on a hub/world child: walking INTO it enters the node. */
/** @typedef {{ x: number, y: number, w: number, h: number }} Door */

/**
 * @typedef {{
 *   id: string,                 // dotted: 'childhood', 'childhood.ballet'; STABLE across edits
 *   kind: 'hub' | 'world' | 'tableau',
 *   parent: string | null,      // null only for the hub
 *   title: string,
 *   intro?: string,
 *   activity?: Activity,        // tableaux only
 *   unlock: Condition,          // { always: true } = open from the start
 *   complete?: Condition,       // default: its activity finished once ({ count: 'node.<id>.finished', gte: 1 })
 *   rewards?: Effect[],         // applied ONCE, the first time the node completes
 *   replayable?: boolean,       // can be entered again once done (games: yes)
 *   door?: Door,                // where its door is on the parent's map (hub/world children)
 * }} Node
 */

/**
 * @typedef {{
 *   start: string,              // where a NEW campaign starts (the false-start blocks tableau)
 *   chooser: CharacterId,       // whose walking opens doors ('elodie')
 *   nodes: Record<string, Node>,
 * }} Content
 */

// ---------------------------------------------------------------- facts (persisted)

/**
 * @typedef {{
 *   counters: Record<string, number>,   // 'blocks.played', 'blocks.won.elodie', 'node.<id>.finished', …
 *   flags: string[],
 *   items: string[],
 *   unlocked: string[],                 // derived by settle, never removed except by gm lock
 *   done: string[],                     // derived by settle (complete held), rewards applied once
 *   seen: string[],                     // nodes the party has entered
 *   totals: Record<string, number>,     // CharacterId → points across the evening
 * }} Facts
 */

// ---------------------------------------------------------------- events (what activities report)

/**
 * @typedef {{ t: 'game.finished', kind: 'blocks', node: string,
 *     ranking: { character: CharacterId | null, score: number, rank: number }[],
 *     mode: string, size: number, endReason: 'stuck' | 'time' | 'host' | null }
 *   | { t: 'quiz.answered', quizId: string, character: CharacterId, correct: boolean }
 *   | { t: 'scene.seen', sceneId: string, node?: string }
 *   | { t: 'zone.entered', zone: string, character: CharacterId }} CampaignEvent
 */

// ---------------------------------------------------------------- news (TV cutscene queue)

/**
 * @typedef {{ seq: number, t: 'unlocked', node: string }
 *   | { seq: number, t: 'item', item: string }} News
 */

// ---------------------------------------------------------------- the campaign (persisted state)

/** @typedef {{ id: string, character: CharacterId | null, name: string, color: number, left: boolean }} PartyMember */

/**
 * The evening's roster, owned by reduceCampaign (A1). Activities seed their players from it.
 * @typedef {{ order: string[], players: Record<string, PartyMember>, hostId: string | null }} Party
 */

/**
 * @typedef {{
 *   v: 1,
 *   seed: number,                                   // advanced on every block game created (deterministic)
 *   at: { node: string, activity: BlockState | null },
 *   party: Party,
 *   facts: Facts,
 *   news: News[],                                   // not yet celebrated on the TV
 *   newsSeq: number,                                // last seq handed out (news seq are 1, 2, 3…)
 * }} Campaign
 */

// ---------------------------------------------------------------- actions (reduceCampaign)

/**
 * Game-master ops (host only).
 * @typedef {{ op: 'goto', node: string }               // move the party there (no unlock check)
 *   | { op: 'unlock', node: string }                    // force-unlock (+ news)
 *   | { op: 'lock', node: string }                      // the ONLY way an unlock is taken back
 *   | { op: 'setFlag', flag: string, on: boolean }
 *   | { op: 'count', counter: string, set?: number, by?: number }
 *   | { op: 'reset-node', node: string }} GmOp          // forget done/seen + its finished counter (rewards stay applied)
 */

/**
 * Ids are injected by the server (socket → playerId; ack: 'screen'). `activity` carries a game
 * ServerAction already rebuilt field by field by the server (now/deadline/timeUp server-only).
 * @typedef {{ t: 'join', id: string, character: CharacterId }
 *   | { t: 'leave', id: string }
 *   | { t: 'enter', id: string, node: string }
 *   | { t: 'back', id: string }
 *   | { t: 'activity', action: import('../game.js').Action }
 *   | { t: 'event', event: CampaignEvent }
 *   | { t: 'ack', id: 'screen', upTo: number }
 *   | { t: 'gm', id: string, op: GmOp }} CampaignAction
 */
