// Contract D v2 + addendum A1 — campaign typedefs (pure data; no code). Everything persisted is
// keyed by STABLE content ids and characters, never by playerIds, except the party roster itself.
export {};

/** @typedef {import('../game.js').State} BlockState */
/** @typedef {import('../quiz/index.js').QuizState} QuizState */
/** @typedef {import('../quiz/index.js').QuizSettings} QuizSettings */
/** @typedef {import('../quiz/index.js').QuizAction} QuizAction */
/** @typedef {import('../pyramide.js').PyramideState} PyramideState */
/** @typedef {import('../pyramide.js').PyramideSettings} PyramideSettings */
/** @typedef {import('../pyramide.js').PyramideAction} PyramideAction */
/** A round of a tableau's minigame: the block game, a quiz (Contract E: `kind: 'quiz'`), or Pyramide. */
/** @typedef {BlockState | QuizState | PyramideState} RoundState */
/** The running minigame's state, nested in the campaign: blocks and quiz run in a plain lobby. */
/** @typedef {import('../plain-lobby.js').PlainLobbyState<RoundState, TableauSettings>} ActivityState */
/** A minigame's settings, by its minigame: the content's, then the game master's choice in its lobby. */
/** @typedef {import('../game.js').Settings | QuizSettings | PyramideSettings} TableauSettings */
/** @typedef {import('../game.js').Settings} Settings */
/** @typedef {import('../characters.js').CharacterId} CharacterId */
/** @typedef {import('../minigames.js').MinigameKind} MinigameKind */

// ---------------------------------------------------------------- content (data, user-edited)

/**
 * Condition, evaluated by holds(cond, facts).
 * @typedef {{ always: true }
 *   | { flag: string }
 *   | { done: string }                      // node id
 *   | { unlocked: string }                  // node id
 *   | { count: string, gte: number }        // facts.counters[count] >= gte
 *   | { has: string, who?: CharacterId | 'anyone', gte?: number }   // inventory: item id held (default anyone, ≥ 1)
 *   | { all: Condition[] } | { any: Condition[] } | { not: Condition }} Condition
 */

/**
 * Effect, applied once when a node first completes (or by gm).
 * @typedef {{ flag: string }
 *   | { item: string, to?: RewardTo, count?: number }   // a CATALOGUE item; default to 'chooser', count 1
 *   | { unlock: string }} Effect
 */
/**
 * Who gets an item reward: the chooser · rank 1 of the activity that completed the node (all when
 * tied) · every non-left party member · one character.
 * @typedef {'chooser' | 'winner' | 'all' | CharacterId} RewardTo
 */
/**
 * A real object of the story (Contract F): only catalogue items can exist.
 * @typedef {{ id: string, name: string, icon: string, description: string }} Item
 */

/**
 * Who may play a tableau's minigame, and the content's ready rule. `eligible`: the characters it names
 * (absent: every party member who isn't a story wisp); `allReady`: a round starts only with every named
 * character in the party and ready (without names: every eligible player ready).
 * @typedef {{ eligible?: CharacterId[], allReady?: true }} TableauPlayers
 */

/**
 * @typedef {({ kind: 'blocks', settings?: Partial<Settings> } & TableauPlayers)
 *   | { kind: 'scene', sceneId: string }
 *   | ({ kind: 'quiz', settings?: Partial<QuizSettings> } & TableauPlayers)     // questions from the server's bank (E1)
 *   | ({ kind: 'pyramide', settings?: Partial<PyramideSettings> } & TableauPlayers)} Activity     // words from the server's bank
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
 *   room?: string,              // the room the TV draws here, an id in ROOMS (shared/scene.js); default: the party room
 * }} Node
 */

/**
 * @typedef {{
 *   start: string,              // where a NEW campaign starts: a minigame's tableau (the false-start block game)
 *   storyId?: string,            // optional live-story marker; absent from the engine's sample fixture
 *   chooser: CharacterId,       // whose walking opens doors ('elodie')
 *   gameMaster: CharacterId,    // who runs the evening ('pierre'): whoever holds this character, never passed on
 *   nodes: Record<string, Node>,
 *   items: Record<string, Item>, // the item catalogue (keys = ids)
 * }} Content
 */

// ---------------------------------------------------------------- facts (persisted)

/**
 * @typedef {{
 *   counters: Record<string, number>,   // 'blocks.played', 'blocks.won.elodie', 'node.<id>.finished', …
 *   flags: string[],
 *   inventory: Record<string, Record<string, number>>,  // CharacterId → itemId → count (0 is removed)
 *   unlocked: string[],                 // derived by settle, never removed except by gm lock
 *   done: string[],                     // derived by settle (complete held), rewards applied once
 *   seen: string[],                     // nodes the party has entered
 *   asked: string[],                    // quiz question ids already asked this evening (never asked again)
 *   totals: Record<string, Record<string, number>>,  // activity kind ('blocks' | 'quiz') → CharacterId → points
 * }} Facts
 */

// ---------------------------------------------------------------- events (what activities report)

/**
 * round.finished: a round's result, derived by the engine only (exactly once), never from outside.
 * @typedef {({ t: 'round.finished', kind: MinigameKind, node: string } & import('../minigames.js').RoundResult)
 *   | { t: 'scene.seen', sceneId: string, node?: string }
 *   | { t: 'zone.entered', zone: string, character: CharacterId }} CampaignEvent
 */

// ---------------------------------------------------------------- news (TV cutscene queue)

/**
 * @typedef {{ seq: number, t: 'unlocked', node: string }
 *   | { seq: number, t: 'item', item: string, to: CharacterId[] }
 *   | { seq: number, t: 'apparition' }} News   // who got it
 */

// ---------------------------------------------------------------- the campaign (persisted state)

/** @typedef {{ id: string, character: CharacterId, name: string, color: number, left: boolean, statuses: string[] }} PartyMember */

/**
 * The evening's roster, owned by reduceCampaign (A1). A round starts with its members present.
 * @typedef {{ order: string[], players: Record<string, PartyMember> }} Party
 */

/**
 * @typedef {{
 *   v: 1,
 *   seed: number,                                   // advanced on every minigame started (deterministic)
 *   at: { node: string, kind: MinigameKind | null, activity: ActivityState | null,   // kind: the tableau's minigame;
 *         results: RoundResult[] },   // activity: the running minigame, null otherwise (the room); results: its finished rounds'
 *   party: Party,
 *   facts: Facts,
 *   news: News[],                                   // not yet celebrated on the TV
 *   newsSeq: number,                                // last seq handed out (news seq are 1, 2, 3…)
 * }} Campaign
 */

/** @typedef {import('../minigames.js').RoundResult} RoundResult */

/**
 * The campaign as views carry it: without the minigame's raw state (`at.activity`), which travels only
 * through its server code's view (the view's `minigame`).
 * @typedef {Omit<Campaign, 'at'> & { at: Omit<Campaign['at'], 'activity'> }} CampaignView
 */

// ---------------------------------------------------------------- actions (reduceCampaign)

/**
 * Game-master ops.
 * @typedef {{ op: 'goto', node: string }               // move the party there (no unlock check)
 *   | { op: 'unlock', node: string }                    // force-unlock (+ news)
 *   | { op: 'lock', node: string }                      // the ONLY way an unlock is taken back
 *   | { op: 'setFlag', flag: string, on: boolean }
 *   | { op: 'count', counter: string, set?: number, by?: number }
 *   | { op: 'reset-node', node: string }                // forget done/seen + its finished counter (rewards stay applied)
 *   | { op: 'give', item: string, to: CharacterId, count?: number }     // catalogue item, default 1
 *   | { op: 'take', item: string, from: CharacterId, count?: number } // refused when they hold fewer
 *   | { op: 'wisp', character: CharacterId, on: boolean }} GmOp // joined character's Wisp Mode
 */

/**
 * Ids are injected by the server (socket → playerId; ack: 'screen'). `activity` carries a minigame's
 * action already rebuilt field by field by the server (now/deadline/timeUp/inputs server-only).
 * @typedef {{ t: 'join', id: string, character: CharacterId }
 *   | { t: 'leave', id: string }
 *   | { t: 'enter', id: string, node: string }
 *   | { t: 'portal', id: string }
 *   | { t: 'collect', id: string, item: string }
 *   | { t: 'status', id: string, status: string, on: boolean } // internal: add or remove a player status
 *   | { t: 'incarnate', id: string }                            // internal: finish the Wisp countdown
 *   | { t: 'back', id: string }
 *   | { t: 'startMinigame', id: string, now: number }   // game master, in the room at a minigame's tableau
 *   | { t: 'endMinigame', id: string }                  // game master, in its lobby: its results recorded
 *   | { t: 'activity', action: import('../plain-lobby.js').PlainLobbyAction | import('../minigames.js').SpotAction | import('../game.js').Action | QuizAction | PyramideAction }   // to the running minigame
 *   | { t: 'event', event: CampaignEvent }
 *   | { t: 'ack', id: 'screen', upTo: number }
 *   | { t: 'gm', id: string, op: GmOp }} CampaignAction
 */
