---
purpose: The specification of the campaign engine and the story data (Contract D v3). Follow it when adding or changing story content, the campaign engine, or code that reads either.
audience: coding agents (Codex, Claude) and Pierre
maintainer: Pierre
kind: specification
---

# Story engine (Contract D v3)

Contract D v3 replaces the story-specific code of Contract D v2 (`storyId === 'elo-50'`, the `portal`
and `collect` actions, hard-coded flags in the server and the clients). Agreed with Pierre on 2026-11-07.

## The rule

**The story is data; the engine, the server and the clients are generic.**

- Story content lives in `shared/campaign/story/`, one file per world: places, rooms, items, machines,
  backgrounds, lines of dialogue.
- Generic code (`shared/campaign/` outside `story/`, `server/`, `public/play/`, `public/screen/`) never
  decides anything from a story id: no `storyId` checks, no `if (node === 'young-adult/tram-5')`, no
  `if (flags.includes('portal.ready'))`. It reads the story through the content and the queries below.
- When the data cannot express a new story moment, add a **generic** mechanic to the engine, document it
  here, test it on the fixture in `test/machines.test.js`, then use it from the story's data.

**Allowed exceptions**, because they are drawings or tools, not rules:

| Where | What | Keyed by |
|---|---|---|
| `public/screen/art/<world>.js` | Pixel art of the story's props | prop kind |
| `public/screen/main.js` `CUTSCENES` | Scripted cutscenes (the apparition) | cutscene id |
| `public/screen/party-room.js` | Zone looks (`portal`), the dream apartment's cats, residents and keepsakes | zone look, room id |
| `server/test-scenes.ts` | Development shortcuts that set up a known story scene | — |
| `scripts/storyboard/` | The storyboard of the evening | — |

## Vocabulary

- **Node**: a place. `hub` (the root: Élodie's dream apartment), `world` (a room you walk in), or `tableau`
  (a minigame's place). Nodes form a tree; the party is always at one node.
- **Chooser**: the character whose walking opens doors (`content.chooser`, Élodie).
- **Game master**: the character who runs the evening (`content.gameMaster`, Pierre), even as a wisp.
- **Wisp**: a player shown as a small light, who can move and Shine, and nothing else: no talking, jumping,
  objects, pickups, doors or zones.
- **Facts**: the saved state of the story: flags, counters, inventories, unlocked and done nodes, machines.
- **Machine**: a small state machine for one sequence (a scene, an NPC, a quest, an offer).

## Which tool for what

| You want… | Use | Example |
|---|---|---|
| A place that opens when something is true, and stays open | A node with an `unlock` condition | Young Adult opens when Élodie holds the first key |
| Something that happens in steps (talk, give, react, leave) | A machine | Toni, the opening, the tram's offer |
| A fact that several places read | A flag, set by an effect | `young-adult.shelter.open` (the night view, the Shelter's door) |
| Something a character holds | An item in the catalogue | `cigarette-pack`, `crowbar` |

**One owner per fact.** A machine owns the progress of its sequence: never mirror a machine state in a
flag (no `portal.entered` next to an `opening` machine). Read the machine instead:
`{ machine: 'opening', in: ['done'] }`.

## Content shape

`Content` (typed in `shared/campaign/types.js`) is plain JSON-able data, sent to the clients by
`GET /api/content`. Fields:

| Field | Meaning |
|---|---|
| `start`, `chooser`, `gameMaster`, `nodes`, `items` | As `Content` in `shared/campaign/types.js` defines them |
| `rooms` | `Record<roomId, Scene>`: the rooms nodes name in `room`, built with `room()` and `prop()` from `shared/scene.js`. Without `room`, a node uses `PARTY_ROOM` |
| `cast` | `{ opening: CharacterId[], introducedBy: Record<id, flag> }`: who plays the opening as themselves, and the flag that introduces each character (setting it turns their wisp back into their character). Absent: nobody starts as a wisp |
| `leadAfter` | A condition. Once it holds, outside a minigame only the chooser moves the party (`enter`, `back`); the game master moves it with `gm goto` |
| `machines` | `Record<machineId, Machine>` |
| `roomArt` | `Record<roomId, { when?: Condition, src: string }[]>`: the room's painted background, first match wins. A painted room draws no doorways (they are in the painting) |
| `gmPlaces` | Optional node ids for the game master's place picker (default: the whole tree) |

Story files `shared/campaign/story/<world>.js` each export a part `{ items, nodes, rooms, machines, roomArt }`;
`shared/campaign/story/index.js` merges the parts into `STORY_CONTENT` and sets the other fields.

### Node fields added in v3

| Field | Meaning |
|---|---|
| `hints` | `{ when?: Condition, text: string }[]`: the line shown at this node on the TV's band and the phones, first match wins. A current machine state's hint for the node wins over these |
| `back` | The chooser's back button label, or `false`: no way back for the chooser (the game master can still move the party) |
| `compact` | `true`: the chooser's phone shows only a small title, the stick, the action button and offers |
| `enterWhen` | A condition checked on every `enter`. Unlike `unlock`, it can stop holding again: use it to open a node only during an offer |
| `startsOnEnter` | `true` on a minigame tableau: entering it opens the minigame's lobby in the same step, without the game master |

## Machines

```js
Machine = { initial: StateId, states: Record<StateId, MachineState> }

MachineState = {
  // how the machine leaves this state
  on?:    Record<EventKey, Transition>,                       // when an event happens (see Events)
  when?:  { if: Condition, to: StateId, do?: Effect[] }[],    // as soon as a condition holds
  after?: { ms: number, to: StateId, do?: Effect[] },         // real ms after this state was entered (not on `initial`)
  enter?: Effect[],                                           // effects applied on entering this state

  // what this state puts in the world while it is current
  hints?:       Record<NodeId, string>,                       // the line shown at those nodes
  holdChooser?: NodeId,                                       // the chooser cannot walk or jump there
  objects?:     Record<PropId, { actions: ObjectAction[] }>,  // what players can do with those props
  pickups?:     Pickup[],                                     // items lying on the floor
  zones?:       Zone[],                                       // spots the chooser can walk into
  npcs?:        Record<PropId, Npc>,                          // what those props say and show
  speech?:      Record<CharacterId, string>,                  // a line a character says over their avatar, once
  hide?:        PropId[],                                     // props gone: no art, no collision, no action
  offer?:       { node: NodeId, text: string, accept: string },  // the chooser's phone offers to enter a node
  choice?:      { at: NodeId, text: string, options: ChoiceOption[] },  // the chooser's phone asks; no Dismiss
}

Transition   = StateId | { to: StateId, do?: Effect[] }
ObjectAction = { key, text, say?, speaker?: 'object', by?: 'chooser' | 'anyone' | CharacterId, if?: Condition }
Pickup       = { item: ItemId, node: NodeId, x, y, radius }
Zone         = { id, node: NodeId, x, y, radius, look?: string, arrive?: { x, y } }
Npc          = { say?: string, blink?: true, emote?: 'joy' | 'love' | 'surprise' | 'anger' }
ChoiceOption = { key, text, if?: Condition }
```

What each part does:

- **Object actions.** For each player, the first action they may use (`by`, default the chooser) whose `if`
  holds is offered on their phone's action button, labelled `text`, when they stand next to the prop. Using it
  shows `say` (a toast on their phone; on the TV a speech bubble over the prop with `speaker: 'object'`, else over
  the player; `\n` breaks lines), then fires the event `<key>:<propId>`. A state's `objects` replace the shared
  furniture's action for the same prop.
- **Pickups.** Only the chooser picks up, within `radius` of `x, y`. The item goes to the chooser's inventory,
  then the event `pickup:<item>` fires. The state must leave on that event (validation checks it), or the item
  would stay on the floor forever. Several items on the floor at once: chain states, each next state listing
  the items still there (`floor-both` → on `pickup:beers` → `floor-cigarettes` lists only the pack).
- **Zones.** Only the chooser triggers a zone, by walking into it while no minigame runs; the event
  `zone:<id>` fires. `look` names how the TV draws it (`portal`; none: invisible). `arrive` is where the
  chooser then stands, in the room the party is in after the transition.
- **NPCs.** `say` is a speech bubble over the prop, shown all the time, or every other 3.6 s with `blink`.
  `emote` floats above it.
- **Effects that make a state replayable belong in its `enter`, not in the transition's `do`:** the game master's
  `machine` op runs only `enter`. The opening's `apparition` state moves everyone and plays the visitor in its
  `enter`, so setting it again replays the scene.
- **Speech.** When the state begins, each character in `speech` says the line over their avatar on the TV, once,
  as soon as they show as themselves (after an `incarnate` countdown). Put the line in `hints` too for the phones.
- **Offers.** The chooser's phone shows `text` with an `accept` button and a Dismiss button (always there). Accepting sends an
  ordinary `enter` of `node`, which must be a child of where the party is; pair it with the node's
  `enterWhen` and usually `startsOnEnter`.
- **Choices.** While the party is at `at`, the chooser's phone shows `text` and one button per option whose `if`
  holds, over whatever else it shows, with no Dismiss. Choosing fires `choose:<key>`; the state must have a
  transition for each option (validation checks it). At a minigame's tableau the choice waits for the game: none
  while a round runs or before one has finished (or the game master ended it). A `goto` in the transition ends the
  minigame first, its rounds recorded. One option is a question with only "Yes". If no option is open, nothing
  shows: make sure one always is. The tram's destinations are a choice.

**When two machines say something about the same place or prop:** for hints, the first machine in content order
wins; for `objects` and `npcs`, the last one wins. Avoid it: one prop, one machine at a time.

Machine states are saved in the facts: `facts.machines[machineId] = { state, since }`, `since` being the server
time the state was entered. Every machine of the content is there from the start of an evening.

### Events

| Event key | Fired when |
|---|---|
| `<actionKey>:<propId>` | A player uses a machine's object action (e.g. `give:tram-5-weird-man`) |
| `pickup:<itemId>` | The chooser picks up an item |
| `zone:<zoneId>` | The chooser walks into a zone |
| `cutscene:<cutsceneId>` | A TV finished playing that cutscene (a visible TV must be connected: the machine waits until one plays it). A TV plays one scripted cutscene at a time: don't queue two in one step |
| `entered:<nodeId>` | The party arrived at that node (a door, `back`, `gm goto`, a `goto` effect) |
| `choose:<optionKey>` | The chooser chose that option of the current choice |

An event reaches each machine's current state only. Every machine with a transition for it takes it, in
content order.

### Effects

| Effect | Does | Where allowed |
|---|---|---|
| `{ flag }` | Sets a flag | machines, node rewards |
| `{ item, to?, count? }` | Gives a catalogue item (`to`: `chooser` (default), `all`, a character; `winner` only in node rewards, where a minigame's ranking exists) and shows it on the TV | machines, node rewards |
| `{ unlock }` | Unlocks a node, even if its condition doesn't hold | machines, node rewards |
| `{ count, by?, set? }` | Moves a counter: adds `by` (default 1), or sets it to `set`. (Next to `item`, `count` is how many items instead.) | machines only |
| `{ cutscene: id }` | Queues the cutscene of that id on the TV; the id must be in the TV's `CUTSCENES` (else the TV shows a plain moment) | machines only |
| `{ goto: nodeId }` | Moves the party | machines only |
| `{ wisp: 'others' }` | Every member but the chooser becomes a wisp | machines only |
| `{ wisp: character }` | That character becomes a wisp | machines only |
| `{ incarnate: character }` | That character's wisp becomes their avatar, after the phone's 3-2-1 countdown (as an introduction does, but not permanent) | machines only |

### Conditions (addition)

`{ machine: machineId, in: StateId[] }` holds when that machine's current state is one of `in`. The others are
unchanged: `{ always: true }`, `{ flag }`, `{ done: node }`, `{ unlocked: node }`, `{ count, gte }`,
`{ has: item, who?: character | 'anyone', gte? }`, `{ all: [] }`, `{ any: [] }`, `{ not }` (`shared/campaign/types.js`).

## Patterns

- **A minigame inside a scene.** A `tableau` child of the room, with the minigame's `activity`. To start it from
  the story, offer it (`offer` + the tableau's `enterWhen` and `startsOnEnter`), or let the game master start it
  in its room. The game master ends it; that records its rounds and marks the tableau `done` (by default after
  one finished round). A machine then reacts with `when: [{ if: { done: '<tableau>' }, to: … }]`, as `opening`
  does after the block game. `done` stays true: to react to every play, count `node.<tableau>.finished` instead.
- **Items left on the floor after something.** A state with `pickups`, entered by the transition that ends the
  something. Several items: chain states (see Pickups).
- **An NPC who leaves.** `npcs` for the reaction, `after` to wait, a state with `hide` (Toni).
- **Travel after a minigame.** The tram: `offer` its quiz tableau; on `entered:<tableau>` go to a state with a
  `choice` at that tableau, one option per destination (`if` for those not open yet), each transition a `goto`.
  The destinations have no doors; their `back` walks to the stop. Listen to `entered:<the stop>` too, so a ride
  the game master cancels (`back`) leaves the machine ready again.
- **In-game time.** A counter that only actions move, e.g. `clock.hours`: an object action's transition does
  `{ count: 'clock.hours', by: 1 }` (Columbo: one hour, a book: two), and what waits for the time uses
  `when: [{ if: { count: 'clock.hours', gte: 3 }, to: … }]` (Pierre arrives). Real time never moves it: `after` is
  for short real delays only. Nothing shows the time yet (backlog: "Show the in-game clock in Élodie's flat").

## Not expressible yet

These need a new **generic** mechanic first (the rule above). Don't work around them with story ids in code or
with a misuse of another field (e.g. an `after` for in-game time: see Patterns).

| Story need | Missing |
|---|---|
| Table football at the Shelter | The minigame itself (`docs/minigames.md`) |
| The tram quiz's three topics, chosen by Élodie | Quiz settings a machine can set (today: the tableau's fixed `settings`) |

## Example: Tschick-Toni

From `shared/campaign/story/young-adult.js`:

```js
toni: {
  initial: 'wants-tschick',
  states: {
    'wants-tschick': {
      hints: { 'young-adult/tram-5': 'A dog barks beside the Zigarettenautomat.' },
      npcs: { 'tram-5-dog': { say: 'Wuff!', blink: true } },
      objects: {
        'tram-5-weird-man': {
          actions: [
            // listed first: offered instead of Talk once Élodie holds the pack
            { key: 'give', text: '🚬 Give a cigarette', if: { has: 'cigarette-pack', who: 'elodie' } },
            { key: 'talk', text: '💬 Talk to Tschick-Toni', say: 'Tschick-Toni:\nHost a Tschick?\nI brauch dringend ane!', speaker: 'object' },
          ],
        },
      },
      on: { 'give:tram-5-weird-man': 'thanked' },
    },
    thanked: {
      npcs: { 'tram-5-weird-man': { say: 'Oida, geil!', emote: 'joy' } },
      after: { ms: 3000, to: 'gone' },
    },
    gone: {
      hide: ['tram-5-weird-man', 'tram-5-dog'],
      pickups: [{ item: 'crowbar', node: 'young-adult/tram-5', x: 11.15, y: 7.5, radius: 0.9 }],
      on: { 'pickup:crowbar': 'crowbar-taken' },
    },
    'crowbar-taken': { hide: ['tram-5-weird-man', 'tram-5-dog'] },
  },
},
```

## Engine (`shared/campaign/`)

Pure and deterministic, as before: no I/O, no clock. The server adds its time to every action (`action.now`).

- `machines.js` reads machines: current states, the transitions an event, a condition or the time triggers,
  and the queries everyone uses: `hintAt`, `objectRules`, `pickupsAt`, `zonesAt`, `hiddenProps`, `npcsAt`,
  `offerAt`, `chooserHeld`, `nextTimer`, `within`. `index.js` applies transitions and effects, and answers
  `choiceAt(campaign, content, status?)` (a client passes its view's minigame status: its campaign has no minigame state).
- Actions added: `use { id, object, action }`, `pickup { id, item }`, `zone { id, zone }`, `choose { id, option }`, `tick` (takes the due
  `after` transitions), `gm { op: 'machine', machine, state }` (the game master sets a state; that state's
  `enter` effects run, no transition's `do`). Removed: `portal`, `collect`.
- Order inside one transition: the transition's `do`, the new state's `enter`, then the facts settle (node
  unlocks); a `goto` among the effects fires `entered:<node>`. Then the `when` transitions that hold are taken,
  until none does. At most 64 transitions follow one another, in a row or nested (`goto` → `entered:` → …), so a
  loop in the content stops instead of hanging or crashing the server. A transition computed for a machine that
  has moved on in the meantime is skipped. A `goto` while a minigame runs ends it first, its rounds recorded. `when` transitions are
  checked after an action changes something, not when an evening starts or resumes.
- `validateContent`, run at boot and by `test/story.test.js`, checks every machine: states, transition targets,
  conditions (including that `{ machine, in }` names a real machine and states), effects and their values, nodes,
  items, props, characters, zone and pickup coordinates, that every event in `on` can happen (an object action,
  zone, pickup, node, cutscene or choice option that exists: a typo is reported), that each pickup's state leaves
  on its pickup, that each choice option has its transition,
  and that no initial state has `after`. It cannot check that a cutscene id is in the TV's `CUTSCENES`.
- `loadCampaign` drops machines the content no longer has, and resets to `initial` a machine whose saved
  state the content no longer has.

## Server and clients

- The server finds zones, pickups and objects with the engine's queries, checks distances with the same
  helpers as the phone, and fires `tick` at `nextTimer`, also after a restart.
- The phone and the TV get hints, action buttons, the held chooser, pickups, zones, NPC lines and hidden props
  from the same queries. `roomAt(content, node)` is a node's room; `sceneAt(content, facts, node)` is that room
  without its hidden props: use `sceneAt` for anything players see or walk in.
- Every item the chooser holds hangs on the dream apartment's wall, unless the item has `keepsake: false` (the
  keys). Decide it for each new item.
- Nothing story-related is kept only in server memory: what must survive a restart is a machine state.

## Adding to the story: checklist

1. Places: nodes in the world's file, with `unlock`, `door`, `hints` and `room` (and from Contract D v2: `activity`,
   `complete`, `rewards`, `replayable`, `intro`; see `shared/campaign/types.js`). A new world file is added to
   `PARTS` in `story/index.js`; ids must be unique across files (the merge would silently keep the last).
2. Sequences: one machine per NPC, scene or quest, in the same file.
3. New props: in the world's `rooms`; their pixel art in `public/screen/art/<world>.js`, added to `PROP_PIXELS`.
   A new cutscene: its player in `CUTSCENES` (`public/screen/main.js`). New items: decide `keepsake`.
4. Check it: `npm run check`, then `node --test test/story.test.js` (it validates the content).
5. Test the sequence through `reduceCampaign` in `test/story.test.js`, as Toni's test does. A new generic
   mechanic gets its own test in `test/machines.test.js`, on that file's fixture, not on the story.
6. Try it by hand on a scratch server: `BLOKO_VAR="$(mktemp -d /tmp/itloe-scene.XXXXXX)" PORT=<free port> npm run
   start:local -- --new`, then the scene shortcuts under `/test/` (README, "Development commands and testing").
   They exist for Tram 5 and the hub; elsewhere, the game master's panel moves the party and sets machine states.
7. Update `GameStory.md` when the story itself changes, and this file when you add a mechanic.
