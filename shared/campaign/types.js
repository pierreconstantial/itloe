// Contract D v3 (docs/story-engine.md) — campaign typedefs (pure data; no code). Everything persisted is
// keyed by STABLE content ids and characters, never by playerIds, except the party roster itself.
export {};

/** @typedef {import('../game.js').State} BlockState */
/** @typedef {import('../quiz/index.js').QuizState} QuizState */
/** @typedef {import('../quiz/index.js').QuizSettings} QuizSettings */
/** @typedef {import('../quiz/index.js').QuizAction} QuizAction */
/** @typedef {import('../pyramide.js').PyramideState} PyramideState */
/** @typedef {import('../pyramide.js').PyramideSettings} PyramideSettings */
/** @typedef {import('../pyramide.js').PyramideAction} PyramideAction */
/** @typedef {import('../backgammon.js').BackgammonState} BackgammonState */
/** @typedef {import('../backgammon.js').BackgammonSettings} BackgammonSettings */
/** @typedef {import('../backgammon.js').BackgammonAction} BackgammonAction */
/** @typedef {import('../foosball.js').FoosballState} FoosballState */
/** @typedef {import('../foosball.js').FoosballSettings} FoosballSettings */
/** @typedef {import('../foosball.js').FoosballAction} FoosballAction */
/** A round of a tableau's minigame: the block game, a quiz (Contract E: `kind: 'quiz'`), Pyramide, backgammon, or table football. */
/** @typedef {BlockState | QuizState | PyramideState | BackgammonState | FoosballState} RoundState */
/** The running minigame's state, nested in the campaign: blocks and quiz run in a plain lobby. */
/** @typedef {import('../plain-lobby.js').PlainLobbyState<RoundState, TableauSettings>} ActivityState */
/** A minigame's settings, by its minigame: the content's, then the game master's choice in its lobby. */
/** @typedef {import('../game.js').Settings | QuizSettings | PyramideSettings | BackgammonSettings | FoosballSettings} TableauSettings */
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
 *   | { machine: string, in: string[] }    // that story machine's current state is one of `in`
 *   | { all: Condition[] } | { any: Condition[] } | { not: Condition }} Condition
 */

/**
 * Effect: a node's rewards (applied once, when it first completes) and a machine's transition and state effects.
 * `count`, `cutscene`, `goto`, `wisp` and `incarnate` are machine effects only.
 * @typedef {{ flag: string }
 *   | { item: string, to?: RewardTo, count?: number }   // a CATALOGUE item; default to 'chooser', count 1
 *   | { unlock: string }
 *   | { count: string, by?: number, set?: number }      // moves a counter: + by (default 1), or to set (in-game time)
 *   | { cutscene: string }                              // queues a cutscene news; the TV plays the cutscene of that id
 *   | { goto: string }                                  // moves the party
 *   | { wisp: 'others' | CharacterId }                  // every member but the chooser, or that character, becomes a wisp
 *   | { incarnate: CharacterId }} Effect                // that character's wisp becomes their avatar (the 3-2-1 countdown)
 */
/**
 * Who gets an item reward: the chooser · rank 1 of the activity that completed the node (all when
 * tied) · every non-left party member · one character.
 * @typedef {'chooser' | 'winner' | 'all' | CharacterId} RewardTo
 */
/**
 * A real object of the story (Contract F): only catalogue items can exist.
 * `keepsake: false`: not hung on the dream apartment's wall (the keys). `art`: a picture's URL, shown instead of
 * the icon in the bags.
 * @typedef {{ id: string, name: string, icon: string, description: string, keepsake?: false, art?: string }} Item
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
 *   | ({ kind: 'pyramide', settings?: Partial<PyramideSettings> } & TableauPlayers)     // words from the server's bank
 *   | ({ kind: 'backgammon', settings?: Partial<BackgammonSettings> } & TableauPlayers)
 *   | ({ kind: 'foosball', settings?: Partial<FoosballSettings> } & TableauPlayers)} Activity
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
 *   room?: string,              // the room here, an id in content.rooms; default: the party room
 *   hints?: { when?: Condition, text: string }[],   // the line shown here, first match (a machine state's hint wins)
 *   back?: string | false,      // the chooser's back button label, or false: no back button
 *   compact?: true,             // the chooser's phone shows only the stick and the actions
 *   enterWhen?: Condition,      // checked on every enter (not monotonic, unlike unlock)
 *   startsOnEnter?: true,       // a minigame tableau: entering opens its lobby in the same step
 * }} Node
 */

/** A story machine's action on a prop or a character; the first one the acting character may use and whose `if`
 * holds is offered. `speaker`: who says `say` instead of the actor, `'object'` for a prop, `'target'` for a character.
 * @typedef {{ key: string, text: string, say?: string, speaker?: 'object' | 'target', by?: 'chooser' | 'anyone' | CharacterId,
 *   if?: Condition }} MachineAction */
/** An item lying on the floor, picked up by the chooser. @typedef {{ item: string, node: string, x: number, y: number, radius: number }} Pickup */
/** A spot the chooser walks into (edge-triggered); `look`: how the TV draws it; `arrive`: where the walker stands after.
 * @typedef {{ id: string, node: string, x: number, y: number, radius: number, look?: string,
 *   arrive?: { x: number, y: number } }} Zone */
/** An NPC prop's line (`blink`: every other few seconds) and emote. @typedef {{ say?: string, blink?: true, emote?: string }} Npc */
/** The chooser's phone offers to enter `node` (a child of where the party is). @typedef {{ node: string, text: string, accept: string }} Offer */
/** One answer of a choice: choosing it is the event `choose:<key>`; shown only while `if` holds.
 *  @typedef {{ key: string, text: string, if?: Condition }} ChoiceOption */
/** A question the chooser's phone asks at node `at`, with no Dismiss: one of its open options must be chosen.
 *  At a minigame's tableau it waits until no round runs and one has finished (the tram's quiz).
 *  @typedef {{ at: string, text: string, options: ChoiceOption[] }} Choice */
/** @typedef {string | { to: string, do?: Effect[] }} Transition */
/**
 * @typedef {{
 *   on?: Record<string, Transition>,                         // event key → transition (docs/story-engine.md, Events)
 *   when?: { if: Condition, to: string, do?: Effect[] }[],    // condition transitions, checked whenever facts change
 *   after?: { ms: number, to: string, do?: Effect[] },        // timed transition, from when the state was entered
 *   enter?: Effect[],
 *   hints?: Record<string, string>,                           // node id → line
 *   holdChooser?: string,                                     // node id where the chooser cannot walk
 *   objects?: Record<string, { actions: MachineAction[] }>,   // prop id → actions
 *   characters?: Record<string, { actions: MachineAction[] }>,  // character id → actions on that character's avatar
 *   pickups?: Pickup[],
 *   zones?: Zone[],
 *   npcs?: Record<string, Npc>,                               // prop id → line and emote
 *   speech?: Record<string, string>,                          // character → a line they say over their avatar, once
 *   hide?: string[],                                          // prop ids gone from their rooms
 *   offer?: Offer,
 *   choice?: Choice,
 * }} MachineState
 */
/** @typedef {{ initial: string, states: Record<string, MachineState> }} Machine */

/**
 * @typedef {{
 *   start: string,              // where a NEW campaign starts: a minigame's tableau (the false-start block game)
 *   chooser: CharacterId,       // whose walking opens doors ('elodie')
 *   gameMaster: CharacterId,    // who runs the evening ('pierre'): whoever holds this character, never passed on
 *   nodes: Record<string, Node>,
 *   items: Record<string, Item>, // the item catalogue (keys = ids)
 *   rooms?: Record<string, import('../scene.js').Scene>,  // the rooms nodes name; default room: PARTY_ROOM
 *   cast?: { opening: CharacterId[], introducedBy: Record<string, string> },  // who plays the opening; flag introducing each
 *   leadAfter?: Condition,      // once it holds, outside a minigame only the chooser moves the party
 *   machines?: Record<string, Machine>,
 *   roomArt?: Record<string, { when?: Condition, src: string }[]>,  // painted backgrounds, first match
 *   gmPlaces?: string[],        // the game master's place picker (default: the whole tree)
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
 *   machines: Record<string, { state: string, since: number }>,  // every content machine's state, since when (server ms)
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
 *   | { seq: number, t: 'cutscene', id: string }} News   // who got it
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
 * through its server code's view (the view's `minigame`), and without the seed (each minigame's seed comes from
 * it, and with it backgammon's dice).
 * @typedef {Omit<Campaign, 'at' | 'seed'> & { at: Omit<Campaign['at'], 'activity'> }} CampaignView
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
 *   | { op: 'wisp', character: CharacterId, on: boolean }  // joined character's Wisp Mode
 *   | { op: 'machine', machine: string, state: string }} GmOp // put a story machine in a state (its enter effects run)
 */

/**
 * Ids are injected by the server (socket → playerId; ack: 'screen'). `activity` carries a minigame's
 * action already rebuilt field by field by the server (now/deadline/timeUp/inputs server-only). The server also
 * injects `now` into every action (CampaignStep): the time a machine state is entered from.
 * @typedef {{ t: 'join', id: string, character: CharacterId }
 *   | { t: 'leave', id: string }
 *   | { t: 'enter', id: string, node: string }
 *   | { t: 'use', id: string, object: string, action: string }   // a story machine's object action
 *   | { t: 'use', id: string, character: string, action: string }   // a story machine's action on a character
 *   | { t: 'pickup', id: string, item: string }                   // the chooser picks up a pickup where the party is
 *   | { t: 'zone', id: string, zone: string }                     // the chooser walked into a zone where the party is
 *   | { t: 'choose', id: string, option: string }                 // the chooser answered the choice asked where the party is
 *   | { t: 'tick' }                                               // fires the due timed transitions
 *   | { t: 'status', id: string, status: string, on: boolean } // internal: add or remove a player status
 *   | { t: 'incarnate', id: string }                            // internal: finish the Wisp countdown
 *   | { t: 'back', id: string }
 *   | { t: 'startMinigame', id: string, now: number }   // game master, in the room at a minigame's tableau
 *   | { t: 'endMinigame', id: string }                  // game master, in its lobby: its results recorded
 *   | { t: 'activity', action: import('../plain-lobby.js').PlainLobbyAction | import('../minigames.js').SpotAction | import('../game.js').Action | QuizAction | PyramideAction | BackgammonAction | FoosballAction }   // to the running minigame
 *   | { t: 'event', event: CampaignEvent }
 *   | { t: 'ack', id: 'screen', upTo: number }
 *   | { t: 'gm', id: string, op: GmOp }} CampaignAction
 */
/** @typedef {CampaignAction & { now?: number }} CampaignStep */
