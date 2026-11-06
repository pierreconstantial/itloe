---
purpose: How to add a minigame to Itloe, what it consists of, what the main game hands it, what shared code gives it and what it can't do.
audience: Contributors and coding agents adding or changing a minigame
maintainer: Konstantin and Pierre
kind: reference
---

# Adding a minigame

A minigame is a few files of its own, registered in four lists. The main game owns the evening around it: the party, joining, the game master, the rooms, the story. The game master starts a minigame from the room at its tableau, and from then until he ends it, the minigame owns the TV and the phones: its lobby, its rounds and their podiums. Blocks is the worked example throughout. The wire is in [PROTOCOL.md](../PROTOCOL.md); the exact shapes are in the code linked below.

## Terms

- **Evening**: one playthrough of the campaign, from the opening on, saved and resumed as one.
- **Main game**: the RPG. It owns the party, joining, presence, the hub and the worlds, the story, the game master, and who shows as a wisp. Its engine is the campaign ([`shared/campaign/index.js`](../shared/campaign/index.js)).
- **Node**: a place in the story's content, by kind: the **hub**, where the story opens out; a **world**, one period of Élodie's life, entered from the hub; a **tableau**, one spot inside a world (or the opening, under the hub). The party is at one node at a time (`campaign.at.node`). A tableau's content field `activity` holds what happens there: a minigame or a scene.
- **Minigame**: a registered game with its own rules, e.g. `blocks`, `quiz` and `pyramide`; a tableau's `activity.kind` names it. At its tableau it runs from the game master's start to his end. `campaign.at.activity` holds the running minigame's state, null otherwise.
- **Lobby**: a minigame's own screens before and between its rounds. Eligible players get ready there, and the game master sets the minigame up, starts rounds and ends it.
- **Plain lobby**: the lobby shared code offers as a building block: its eligible players walking it, "I'm ready", the game master's settings and Start, a round with the ready players, its podium, "Back to the lobby", and the end. Blocks, quiz, Pyramide and backgammon use it; Pyramide's has spots.
- **Round**: one play of a running minigame, from its start to its podium. After the podium the minigame is back in its lobby.
- **Status**: what a running minigame shows, derived from its state: `lobby`, `running` (a round) or `podium`.
- **Eligible players**: the party members the main game hands a minigame: the characters its tableau's content names, among the members who haven't left; without names, every member who isn't a story wisp.
- **Ready**: an eligible player who has tapped "I'm ready" for the next round, or, in a lobby with spots, who holds a spot.
- **Game master**: the one person who runs the evening: Pierre, as every content names him (`gameMaster`). Whoever holds that character is the game master, wisp or not, and nobody while he isn't in the evening ([`gameMasterId`](../shared/campaign/index.js)). The role never passes to anyone else.
- **Walkable lobby**: a lobby where the players the minigame shows walk over its screens as their characters, with the joystick on their phone, chatting and emoting, as in the main game's rooms.
- **Spot**: a marked place on a walkable lobby that an eligible player takes by stepping onto it, or by tapping it on their phone.
- **Start position**: where a player stands on starting to walk a walkable lobby, unless they hold a spot.
- **Wisp**: a player shown as a small light instead of their character. While no minigame runs, a player whose character the story hasn't introduced yet (the `wisp` status); while one runs, every connected player it doesn't show itself ([`isWisp`](../shared/campaign/index.js)).
- **Room**: what the TV draws for a node: a space with walls and furniture where avatars walk (`ROOMS` in [`shared/scene.js`](../shared/scene.js)). A node names its room, else it gets the party room ([`roomAt`](../shared/campaign/content.js)). Minigames have no rooms.
- **The room at a tableau**: the main game's room at a minigame's tableau, while the minigame doesn't run. The game master starts the minigame there.
- **Shared code**: everything that isn't a minigame's own files: the campaign engine, the server, and the parts of the phone and TV around the minigames.
- **Frame**: the phone's and TV's code around a minigame's screens (`public/play/main.js`, `public/screen/main.js`): the room, the map, the cutscenes, the menus, wisps, and mounting the minigame's screens.
- **Unsaved message**: a message a minigame's server code sends to every phone and TV while it runs, never saved.

## What a minigame consists of

| Part | What it is | Blocks |
|---|---|---|
| Rules | A pure reducer over plain JSON state, run by the server and the browsers, from the minigame's start to its end | `plainLobby(BLOCK_RULES)`: the plain lobby ([`shared/plain-lobby.js`](../shared/plain-lobby.js)) around its round rules ([`shared/game.js`](../shared/game.js)) |
| Server code | Messages to actions, server inputs, the view, change hooks | `plainLobbyServer(makeBlockServer(game))`: [`server/plain-lobby.ts`](../server/plain-lobby.ts) around [`server/blocks.ts`](../server/blocks.ts) |
| Phone screens | Its screens on the phones from its start to its end, with its settings wording and "How to play" | `plainLobbyScreen(BLOCK_SCREEN)`: [`public/play/plain-lobby.js`](../public/play/plain-lobby.js) around [`public/play/blocks-ui.js`](../public/play/blocks-ui.js) |
| TV screen | Its screen on the TV from its start to its end | `plainLobbyScreen(BLOCK_SCREEN)`: [`public/screen/plain-lobby.js`](../public/screen/plain-lobby.js) around [`public/screen/blocks-screen.js`](../public/screen/blocks-screen.js) |
| Content | A tableau whose `activity` names it, with its settings and who may play | `activity: { kind: 'blocks', settings: { size: 9 } }` in [`shared/campaign/sample.js`](../shared/campaign/sample.js) |

A minigame chooses its lobby:

- **In the plain lobby**, as blocks, quiz, Pyramide and backgammon: it writes a round's rules, server code and screens, and wraps each in the plain lobby's building block. Everything about the lobby is then shared.
- **With a lobby of its own**, when the plain lobby doesn't fit (no minigame does yet): it writes the minigame's rules, server code and screens against the same contract the plain lobby implements (`MinigameRules`, `MinigameServer`, `PhoneScreen`, `TvScreen`), and reuses the pieces listed under [What shared code offers](#what-shared-code-offers).

### Registration lines

One import line and one entry in each list, under the minigame's kind:

- the rules list, `MINIGAMES` in [`shared/minigames.js`](../shared/minigames.js);
- the server list, `makeMinigameServers` in [`server/minigames.ts`](../server/minigames.ts);
- the phone list, `SCREENS` in [`public/play/minigames.js`](../public/play/minigames.js);
- the TV list, `SCREENS` in [`public/screen/minigames.js`](../public/screen/minigames.js).

Then its type entries in [`shared/campaign/types.js`](../shared/campaign/types.js): its state (a round's state in `RoundState` for a plain-lobby minigame, its whole state in `ActivityState` for one with its own lobby), its settings in `TableauSettings`, its content entry in `Activity`, and its actions in the `activity` case of `CampaignAction`. Nothing else outside its own files changes: `npm run check` finds what's missing.

## What the main game hands a minigame

- **At its start** (the game master's `startMinigame`, from the room at the tableau): `open` gets the seed, the settings (the tableau's content over the minigame's defaults), the eligible players in party order, and the time (`MinigameStart` in [`shared/minigames.js`](../shared/minigames.js)). The game master's changes to the settings live in the minigame's state and end with it: each start begins from the content's settings.
- **While it runs**, every change in who is eligible, as the minigame's actions `join { id, character }` (joined the evening, or incarnated by the story) and `leave { id }` (left the evening, or became a story wisp where the tableau names nobody). The minigame decides what they mean: blocks marks a player who leaves during a round done, and the plain lobby lists a joiner, who plays from the next round on.
- **With every action**, the game master's id (`RoundCtx`), for the minigame's own game-master-only actions. A minigame stores no game master.
- **On a walkable lobby**, every step of a player it shows onto a spot, off it or from one to another, as its action `spot { id, spot }` (the spot's id, or null), injected by the server, never from the wire. The server reads each walker's position against the spots, edge-triggered like the doors (`spotStep` in [`shared/minigames.js`](../shared/minigames.js)): a walker's first known position only sets where it stands, and wisps never step onto a spot. Taking a spot from the phone is a step onto it. The minigame decides what a step means (the plain lobby: a free spot is taken, the one held before is let go).
- **With every message**, the evening's used-up content ids (`asked` in `MessageCtx`, [`server/minigames.ts`](../server/minigames.ts)): `facts.asked` plus the running minigame's finished rounds (`askedSoFar`). The quiz picks its questions outside them, so no question is asked twice in an evening, also across the rounds of one run.
- **The content's rules for its players**, from the tableau's `activity`: `eligible` names the characters who may play (absent: every party member who isn't a story wisp); a story wisp the tableau names is eligible and plays as their character there. `allReady: true` makes the main game refuse every step into a running round until every named character is in the party and ready (without names: every eligible player). The story's opening names its four characters and requires them all ([`shared/campaign/story.js`](../shared/campaign/story.js)). One function each decides these, for the engine, the server and the clients: `eligibleOf` and `readyRuleMet` ([`shared/campaign/index.js`](../shared/campaign/index.js)).

## Rules

`MinigameRules` in [`shared/minigames.js`](../shared/minigames.js) lists what a minigame's rules supply and what each function must do. What matters for the design:

- **Pure and deterministic.** Time, randomness and ids come in through actions and the start; the reducer does no I/O. A refused action returns the same state object: the server uses that identity to skip saving and broadcasting.
- **The status** (`status`): `lobby`, `running` or `podium`; null for a saved state this release can't resume, which makes the server start a fresh evening and keep the old save aside. The game master can end the minigame (`endMinigame`) only while its status is `lobby`.
- **Ready** (`ready`): who is ready for the next round. The main game checks the content's ready rule over it; the minigame's own minimum is its own (blocks and quiz: one; backgammon: two; Pyramide: four).
- **A walkable lobby** (`spots`, optional): its spots while the players it shows walk, null otherwise (absent: never; the plain lobby: while in its lobby). Each spot (`Spot`) has an id, a label for the phone, its area in world units (16 × 9) and its holder, from the minigame's state: who holds a spot is saved with the minigame, while positions are in memory. An empty list is a walkable lobby without spots (the plain lobby's, unless its round rules list spots). Its start positions (`startPositions`, in world units) go where its TV screen leaves room, clear of its spots and panels. Whoever starts walking (the minigame's start, a join, back from a round they sat out, a restart) is placed by the server: a holder on its spot's centre, anyone else on the first start position nobody stands on.
- **Whom it shows** (`shows`): the players it draws itself. Every other connected party member floats over its screens as a wisp. The plain lobby shows its eligible players in the lobby, the round's players still playing during a round, and the round's players on its podium; so players who aren't eligible, aren't ready or are out of the round are wisps.
- **Results** (`result`): what a round reports once it turned `podium` (`RoundResult`). The main game keeps it in `campaign.at.results` in the same step, and when the game master ends the minigame it records every kept result in order, each with its counters and the unlocks and rewards that follow, in one step and one save. In order, so a `winner` reward goes to the winners of the round that completed the node. The counters: `<kind>.played`, `<kind>.won.<character>`, `node.<id>.finished`, the totals per kind, the minigame's own counters under its name, and `asked`. A minigame ended before any round finished records nothing. Moving the party elsewhere (the game-master panel's goto, or back) ends the minigame first in the same way, dropping a running round.
- **Deadlines.** `deadline` names the next one, and shared code arms a timer that fires `deadlineAction`. A timer is never cancelled, so the reducer must refuse a stale one: blocks compares the action's `deadline` with the state's. `shiftDeadline` moves the clock by a downtime, so a timed round keeps its remaining time across a restart or a sleeping laptop.
- **Settings.** `settings` merges valid keys over a base, `validateSettings` reports a content node's problems at boot, and `sampleSettings` feeds the development start.

### In the plain lobby: round rules

`plainLobby(roundRules)` turns a round's rules (`RoundRules` in [`shared/minigames.js`](../shared/minigames.js)) into a minigame's rules. Its state, actions and their rules are in [`shared/plain-lobby.js`](../shared/plain-lobby.js). A round's rules supply:

- **`init`**: a new round, running, from `RoundStart`: the seed, the settings, the ready players in party order, the time, and the round server's inputs (the quiz: its candidate questions). Null when it can't start.
- **The round's players** as `RoundPlayers`: `order`, and per player a `name`, `color` and `score`, plus `left`, `done`, `retired` and `endReason` where they apply. The plain lobby reads them for whom it shows and who comes back ready, the podium ranks them with the one shared rule ([`shared/ranking.js`](../shared/ranking.js)), and `result` uses the same rule.
- **`status`**: `running` or `finished` (its podium).
- **`leave` and the game master's actions.** A round gets `leave` when a player stops being eligible, and `endGame` from the game master. "Take a player out" reaches it as `retire` when its rules set `retire: true`, else as the target's `leave`. Blocks: a player who leaves or is taken out stops playing but stays ranked, and the last player out ends the round. A round that can't carry on without someone ends with the scores so far.
- `result`, the deadlines, the settings and `describe`, as above.
- **Start positions** (optional, `startPositions`): where the lobby's walkers start. Absent, the plain lobby's (`PLAIN_LOBBY_START_POSITIONS` in [`shared/plain-lobby.js`](../shared/plain-lobby.js)), left of its TV screen's panel.
- **Spots** (optional, `spots`: their ids, labels and areas): an eligible player is ready by holding a spot, with no "I'm ready". A step onto a free spot takes it and lets go of the one held before; stepping off lets go. `init` gets each player's spot (`RoundStart`), and returns null unless the spots it needs are held (Pyramide: all four). Back from the podium, the round's players hold the spots they left, except those who left or were taken out. Pyramide ([`shared/pyramide.js`](../shared/pyramide.js)) uses them.

### A lobby of its own

A minigame with its own lobby implements `MinigameRules` directly, and has to:

- handle `join` and `leave` in every status;
- report `ready` and `shows` truthfully: the main game enforces the content's ready rule over `ready`, and the frame draws wisps from `shows`;
- reach `podium` from `running` for every round that should count, with `result` describing that round;
- return to `lobby` for the game master to end it;
- for a walkable lobby, report its spots with their holders from its state (`spots`), and handle `spot`.

Its messages use the plain lobby's names where they mean the same (`ready`, `config`, `start`, `lobby`, `endGame`, `retire`: [PROTOCOL.md](../PROTOCOL.md), "Minigames and their lobbies"), and its own names for the rest.

## Pyramide: a plain lobby with spots

Pyramide ([`shared/pyramide.js`](../shared/pyramide.js), [`server/pyramide.ts`](../server/pyramide.ts), [`public/play/pyramide-ui.js`](../public/play/pyramide-ui.js), [`public/screen/pyramide-screen.js`](../public/screen/pyramide-screen.js)) is the example of a minigame in the plain lobby with spots:

- **Spots instead of "I'm ready".** Four spots (team 1's clue giver and guesser, team 2's) in its round rules ([In the plain lobby: round rules](#in-the-plain-lobby-round-rules)): the spot a player holds is their team and role, and a round starts when all four are held. Its one setting, the mode, is an ordinary setting.
- **Four players are needed,** so a player who leaves or is taken out ends the round with the scores so far (`retire: true`).
- **Server-side judging.** The server turns a guess into a verdict before the reducer sees it (`judgeGuess`), so a smarter check replaces one function. The word bank is in `data/`, checked at boot and never served; `inputs` hands a round the words not yet used this evening, and the round's `asked` lists the words it drew.
- **Hidden information:** the word in play, see [Hidden information](#hidden-information).
- **The screens:** the lobby's are the plain lobby's; Pyramide's own phone and TV screens draw a round.

## Server code

`MinigameServer` and `RoundServer` in [`server/minigames.ts`](../server/minigames.ts) describe each hook. In short:

- **`message`** gets every message from a party member that the main game doesn't handle, with the sender's id, the time, the game master's id, the state and `asked`, and returns an action, a refusal or nothing. Build the action field by field from the message, so server-only inputs (time, deadlines, a round's inputs) never come from the wire (blocks: `place`). A guest's game-master message gets `not-gm`, the game master's at the wrong moment `refused`, and a message the minigame doesn't know `not-playing`.
- **`view`** is what every phone and TV gets, the same for everyone. Filter it here: the quiz hides answers until the reveal. What the view must carry for some screens but not others is [hidden information](#hidden-information).
- **`onChange`** runs after every change of its state, before the save (blocks: solo best scores).
- **The io** (`MinigameIo`) belongs to one run of the minigame, from its start to its end ([`server/round.ts`](../server/round.ts)): `apply` runs a later action (the quiz's verdict), `send` sends an unsaved message. After the minigame ends, whatever goes through it is dropped.

In the plain lobby, `plainLobbyServer(roundServer)` ([`server/plain-lobby.ts`](../server/plain-lobby.ts)) handles the lobby's messages and passes every other one to the round's server code while a round runs. A round's server code adds `inputs(settings, asked)`: what a round starts with besides the players and settings (the quiz: its candidates from the server-only bank, minus `asked`).

## What shared code offers

- **The room at the tableau**, while the minigame doesn't run: on the TV the band with the TV entry's `title`, the guests and the join QR; on the phones the walking pad, and for the game master "▶ Start the <name>" (the phone entry's `name`).
- **Mounting.** The frame mounts the minigame's screens when it starts (or when a page loads or reconnects while it runs), and unmounts them when it ends. A phone gets them while the minigame shows its player, and always on the game master's phone.
- **Walking on its lobby,** while its `spots` aren't null: the TV draws the players it shows as their characters over its screen, offline ones dimmed where they stood, with chat bubbles and emotes. The phone shows them the frame's walk panel, the joystick, under the minigame's screens, which list the spots if it has any, each free one taken with a tap (`takeSpot`; the plain lobby does it). Near a free spot's centre, or the one it holds, the character snaps onto the centre, and walks off when the stick pushes it further (`snapTo` in [`public/play/movement.js`](../public/play/movement.js)). The TV screen draws the spots in a `worldBox` with `placeInWorld` ([`public/screen/dom.js`](../public/screen/dom.js)): the same projection as the characters, so they line up (the plain lobby's TV screen does it for every plain-lobby minigame with spots); phone screens leave the bottom of the page to the walk panel.
- **Wisps over its screens.** The TV draws every connected party member the minigame doesn't show as a wisp over its screen, and their phones get the wisp's walking pad and Shine. Every wisp has the same abilities: walking and Shine, no speech, no objects. One function decides who is a wisp, for the server, the TV and the phone ([`isWisp`](../shared/campaign/index.js)).
- **The plain lobby's screens** ([`public/play/plain-lobby.js`](../public/play/plain-lobby.js), [`public/screen/plain-lobby.js`](../public/screen/plain-lobby.js)): the lobby, walked by its eligible players, with who is ready ("✓ ready" / "not ready"; offline ones dimmed on the phone), "I'm ready", the game master's ⚙ Settings, "▶ Start" (later "▶ Play again") with how many are ready and "End the <name>"; the last round's winner; the round's screens while it runs; the podium with the game master's "Back to the lobby". A minigame with its own lobby can follow them for its own.
- **The podium**: [`public/play/podium.js`](../public/play/podium.js) and [`public/screen/podium-view.js`](../public/screen/podium-view.js) rank the round's players with medals, plus the minigame's extras (`PodiumExtras`: the quiz's right answers, blocks' "New best!", the TV's delay while "Time's up!" plays).
- **The settings sheet** (`createSettingsSheet`, [`public/play/settings-ui.js`](../public/play/settings-ui.js)), built from a settings schema and its wording.
- **Round controls** in ☰ for the game master (`createRoundControls`, [`public/play/round-controls.js`](../public/play/round-controls.js)): "End game" and "Take a player out", each with a confirming second tap (`createConfirm`, [`public/play/confirm.js`](../public/play/confirm.js)).
- **"How to play"** in ☰, listing every minigame's `rules` from its phone entry, under its title.
- Chat, emotes, object actions, cutscenes, the map, the game-master panel, the bag, the character picker and the connection.

### Screens

The phone and TV entries (`PhoneScreen`, `TvScreen` in [`public/play/minigames.js`](../public/play/minigames.js) and [`public/screen/minigames.js`](../public/screen/minigames.js)) have a `title`, a `name` (in a sentence: "block game") and `mount(root, io)`, which builds the screens inside `root` and returns:

- `update(minigame, campaign)`: every view while the minigame runs (`MinigameView`: kind, status, the server code's view, `shows`, `spots`, and the tableau's `eligible` and `allReady` as `required`), and on the phone, on connection changes;
- `message(msg)`: the server's messages for the minigame: its unsaved messages, as the whole `{ t: 'unsaved', data }`, and on the phone an `err` refusing this phone's message;
- `unmount()`: removes its markup, listeners, loops, sounds and timers. Anything left running stays running on that phone or TV.

In the plain lobby, a round's screens (`RoundScreen`) add `settings` (its schema and wording) and `podium` (its extras), and their `mount` returns `RoundMounted`, whose `update` gets the round (`RoundView`). The plain lobby mounts them while a round runs and passes them the view that ends it, just before the podium.

The screens build their own markup and load their own CSS (`addStylesheet` in `public/play/dom.js` and `public/screen/dom.js`), scoped under `root`; they add nothing to `public/play/index.html`. The phone's io sends messages and says who this phone is, whether it's the game master's and whether it's connected; the TV's tells whether a view directly follows the last one (no sounds for missed events).

## Hidden information

A view is the same for every phone and TV, so a secret that only some players may see can't be left out of it for them. Two ways:

- **Filter it out** in `view`, when nobody needs it before it is revealed. The quiz does this with the answers.
- **Send it to everyone and draw it for some,** when a few players need it while it is secret. Pyramide's word in play travels in the shared view, and only the clue givers' phones draw it: [`server/pyramide.ts`](../server/pyramide.ts) filters out the words still drawable (`view`), not the word in play; [`public/play/pyramide-ui.js`](../public/play/pyramide-ui.js) keeps it only when this phone's player gives clues, and the TV screen ([`public/screen/pyramide-screen.js`](../public/screen/pyramide-screen.js)) reads only its level. It needs nothing from the server, but every phone receives the secret, and nothing but the screens' code keeps it from showing: a player who reads their phone's traffic sees it. That suits a party of friends; it doesn't suit a game where cheating matters.

Whichever way, keep the secret out of every place a screen can show it: the log, the status line, the lobby, and what a reconnecting phone draws first. [`scripts/e2e-pyramide.mts`](../scripts/e2e-pyramide.mts) checks that no guesser's phone and no TV screen shows the word in play, including a clue giver's phone after it reconnects.

## What a minigame can and can't do

It can:

- choose its lobby, and decide what a player who stops being eligible or is taken out means for it;
- set its own minimum of ready players;
- run its own rules, with its own game-master-only actions and its own buttons for them in its screens;
- filter its view, add its own counters, and keep server-side data of its own (blocks: best scores);
- send unsaved messages to its screens.

It can't:

- choose who is eligible, enforce the content's ready rule, or keep a game master: the main game hands it the eligible players, checks the rule and passes the game master's id;
- record results: it reports each round's, and the main game records them when the minigame ends;
- handle the main game's messages (`hello`, `join`, `leave`, `enter`, `back`, `gm`, `ack`, `pos`, `say`, `emote`, `interact`, `showJoin`, `hideJoin`, `takeSpot`, `startMinigame`, `endMinigame`): it sees their effects as actions or views;
- switch chat or emotes off, offer object actions (those are the room's, while no minigame runs), or give wisps other abilities;
- send different views to different players (see [hidden information](#hidden-information)), or save anything outside its state and its own server data;
- draw before its start or after its end: the room at the tableau shows then.

## Unsaved messages

A minigame's server code sends an effect to every phone and TV with `io.send`: the wire's `unsaved` (see [PROTOCOL.md](../PROTOCOL.md)), delivered to its screens' `message`. Unsaved messages are for effects, not fast-moving games.

## Development start

`ITLOE_CONTENT=minigame:<kind>` starts the server on a hub and one start tableau running that minigame with its `sampleSettings`, without the story's opening. Its tableau names no eligible characters, so every player who joins is eligible:

```sh
ITLOE_CONTENT=minigame:blocks BLOKO_VAR="$(mktemp -d)" PORT=3199 npm start -- --new
```

Open `http://127.0.0.1:3199/sim/`: the TV and four phones side by side. Pick characters, Pierre among them, and tap "▶ Start the <name>" on Pierre's phone; then "I'm ready" on the phones, and Start on Pierre's. An unknown kind refuses to boot and lists the registered ones. Never use port 3131 or `var/`: that's the live evening.

## Tests

- **`npm run check` and `npm test`** for every change. [`test/campaign.test.js`](../test/campaign.test.js) already checks that every registered minigame's development start validates and starts at its tableau.
- **Rules:** tests in `test/<topic>.test.js` with `node:test`, small fixtures and explicit seeds and times, that play the rules through the campaign engine in order: [`test/minigame.test.js`](../test/minigame.test.js) does it for the main game and the plain lobby (start and end, eligible players, ready, the round flow, results), [`test/story.test.js`](../test/story.test.js) for the opening. Cover the main game's `join` and `leave`, the game master's actions, a stale deadline, the result, and a JSON round-trip (a restart) in each status.
- **Stand-in:** [`test/round.test.js`](../test/round.test.js) shows how to test server code through the io, without a server (unsaved messages, what's dropped after the end).
- **Over real sockets:** the `scripts/e2e-*.mts` suites start their own server on a scratch save folder; [`scripts/e2e-quiz.mts`](../scripts/e2e-quiz.mts) is the pattern for one minigame, and `startRound`, `backToLobby` and `endMinigame` in [`scripts/e2e-lib.mts`](../scripts/e2e-lib.mts) drive the lobby. The README's "Development commands and testing" lists the suites and how to run them.
- **Playing it:** a short script with [`scripts/drive.mts`](../scripts/drive.mts) plays a round of your minigame on its development start (`content: 'minigame:<kind>'`) with a TV and phones in headless Chrome, and takes screenshots to look at. The storyboard's sequences ([`scripts/storyboard/sequences.mts`](../scripts/storyboard/sequences.mts)) show the same steps for blocks and quiz.
