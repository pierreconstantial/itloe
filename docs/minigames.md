---
purpose: How to add a minigame to Itloe, what it consists of, what the shared code gives it and what it can't do.
audience: Contributors and coding agents adding or changing a minigame
maintainer: Konstantin and Pierre
kind: reference
---

# Adding a minigame

A minigame is a few files of its own, registered in four lists. Everything around it (the party, joining, the game master, the rooms, the screens between rounds) belongs to the RPG, which starts a round with its players and ends it when its podium closes. Blocks is the worked example throughout. The wire is in [PROTOCOL.md](../PROTOCOL.md); exact shapes are in the code linked below.

## Terms

- **Evening**: one playthrough of the campaign, from the false start on, saved and resumed as one.
- **Node**: a place in the story's content, by kind: the **hub**, where the story opens out; a **world**, one period of Élodie's life, entered from the hub; a **tableau**, one spot inside a world (or the false start, under the hub) with one activity: a minigame or a scene. The party is at one node at a time (`campaign.at.node`).
- **Minigame**: a registered kind of game with its own rules, e.g. `blocks` and `quiz`. A tableau's `activity.kind` names a minigame, or `scene`, which is a content kind without rules.
- **Round**: one play of a minigame at a tableau. The game master starts it from the room, and it runs until its podium closes. `campaign.at.activity` holds the round's state; between rounds there is none.
- **Status**: a round's `running` or `finished` (the podium), derived by the minigame from its state.
- **Room**: what the TV draws for a node: a space with walls and furniture where avatars walk (`ROOMS` in [`shared/scene.js`](../shared/scene.js)). A node names its room, else it gets the party room ([`roomAt`](../shared/campaign/content.js)). Minigames have no rooms.
- **Map**: the room at the hub or in a world, with a door for each node the party can enter from there.
- **The room at a tableau**: the room between rounds at a tableau, under the tableau's band.
- **Game area**: where a minigame lets avatars walk over its own screen during its round, e.g. players already out of a game roaming over its board. Its bounds are a `shared/scene.js` scene without furniture.
- **Shared code**: everything that isn't a minigame's own files: the campaign engine (the RPG), the server, and the parts of the phone and TV around the games.
- **Frame**: the screens every minigame shares: the room at a tableau between rounds, the podium, and the game master's round controls.
- **Game master**: the one person who runs the evening: Pierre, as the content names him (`gameMaster`). Whoever holds that character is the game master, and nobody while he isn't in the evening ([`gameMasterId`](../shared/campaign/index.js)).
- **Unsaved message**: a message a minigame's server code sends to the phones and TVs during its round, never saved.
- **Avatar**: a player's walking character, as in the party room and the `pos` message.

## What a minigame consists of

| Part | What it is | Blocks |
|---|---|---|
| Rules | A pure reducer over plain JSON state, run by the server and the browsers | [`shared/game.js`](../shared/game.js), `BLOCK_RULES` |
| Server code | Messages to actions, server inputs, the view, change hooks | [`server/blocks.ts`](../server/blocks.ts) |
| Phone screens | Its running screens on the phones, with its settings wording and "How to play" | [`public/play/blocks-ui.js`](../public/play/blocks-ui.js), `BLOCK_SCREEN` |
| TV screen | Its running screen on the TV | [`public/screen/blocks-screen.js`](../public/screen/blocks-screen.js), `BLOCK_SCREEN` |
| Content | A tableau whose `activity` names it, with its settings | `activity: { kind: 'blocks', settings: { size: 9 } }` in [`shared/campaign/sample.js`](../shared/campaign/sample.js) |

### Registration lines

One import line and one entry in each list, under the minigame's kind:

- the rules list, `MINIGAMES` in [`shared/minigames.js`](../shared/minigames.js);
- the server list, `makeMinigameServers` in [`server/minigames.ts`](../server/minigames.ts);
- the phone list, `SCREENS` in [`public/play/minigames.js`](../public/play/minigames.js);
- the TV list, `SCREENS` in [`public/screen/minigames.js`](../public/screen/minigames.js).

Then its type entries in [`shared/campaign/types.js`](../shared/campaign/types.js): its state in `ActivityState`, its settings in `TableauSettings`, its content entry in `Activity`, and its actions in the `activity` case of `CampaignAction`. Nothing else outside its own files changes: `npm run check` finds what's missing.

## Rules

`MinigameRules` in [`shared/minigames.js`](../shared/minigames.js) lists what the rules supply and what each function must do. What matters for the design:

- **Pure and deterministic.** Time, randomness and ids come in through actions and the round start; the reducer does no I/O. A refused action returns the same state object: the server uses that identity to skip saving and broadcasting.
- **A round starts running** with the players the campaign hands in (`init`): every party member who hasn't left the evening, online or not, as an id and a character. There is no lobby and no `join`.
- **The round's players.** The state carries them as `RoundPlayers` (`shared/minigames.js`): `order`, and per player a `name` and `color` (the character's, from [`CHARACTERS`](../shared/characters.js)) and a `score`, plus `left`, `done` and `endReason` where they apply. The frame's podium, round controls and presence read them from every minigame's view, and the podium ranks them by score with the one shared rule ([`shared/ranking.js`](../shared/ranking.js)), which `result` uses too.
- **The RPG's actions.** Besides its own actions, the reducer gets `leave` (a player left the evening) and `endGame` (the game master's "End game"). The game master's "Take a player out" reaches it as the target's `leave`, or as `retire` when the rules set `retire: true`. It decides what each means for its rules. Blocks: a player who leaves or is taken out stops playing but stays ranked, and the last player out ends the round.
- **The game master.** A minigame stores none. Every action comes with the game master's id (`RoundCtx`), so the reducer can refuse its own game-master-only actions, as blocks does for `endGame` and the quiz for its next question.
- **Deadlines.** `deadline` names the next one, and shared code arms a timer for it that fires `deadlineAction`. A timer is never cancelled, so the reducer must refuse a stale one: blocks compares the action's `deadline` with the state's. `shiftDeadline` moves the clock by a downtime, so a timed round keeps its remaining time across a restart or a sleeping laptop.
- **The result.** Once the status turns `finished`, the campaign records `result` once, in the same save: the ranking and end reason make the common counters (`<kind>.played`, `<kind>.won.<character>`, `node.<id>.finished`, the totals per kind), plus any counters of the minigame's own under its name. Content decides unlocks and rewards from them.
- **Settings.** `settings` merges valid keys over a base, `validateSettings` reports a content node's problems at boot, and `sampleSettings` feeds the development start.

## Server code

`MinigameServer` in [`server/minigames.ts`](../server/minigames.ts) describes each hook. In short:

- **`message`** gets every message from a party member that the RPG doesn't handle, with the sender's id, the time, the game master's id and the round's state, and returns an action, a refusal or nothing. Build the action field by field from the message, so server-only inputs never come from the wire (blocks: `place`).
- **`inputs`** supplies what a round starts with besides the players and settings (the quiz: its candidate questions from the server-only bank).
- **`view`** is what every phone and TV gets, the same for everyone. Filter it here: the quiz hides answers until the reveal.
- **`onChange`** runs after every change of its round, before the save (blocks: solo best scores).
- **`walks`** says who may walk its game area during its round; without it, nobody walks.
- **The `io`** belongs to one round: `apply` runs a later action (the quiz's verdict), `send` sends an unsaved message, `positions` reads where the walkers stand. After the round ends, whatever goes through it is dropped ([`server/round.ts`](../server/round.ts)).

## The frame

Shared code draws everything outside a running round, the same for every minigame:

- **The room at the tableau** before a round: on the TV the band with the TV entry's `title` and settings summary, who's in and the join QR; on the phones the joystick with the object button, the settings summary, and the game master's Start.
- **The settings sheet**, built from the phone entry's `settings` (its schema, wording and summary), in the room and on the podium. The RPG keeps the game master's choice until the party leaves the tableau.
- **The podium**: the round's players ranked, with medals, plus the minigame's extras from its entries' `podium` (the quiz's right answers, blocks' "New best!", the TV's delay while "Time's up!" plays). The game master gets "Play again" (a new round at once, with everyone present) and "Back to the room".
- **Round controls** in ☰ during a round, for the game master: "End game" and "Take a player out".
- **"How to play"** in ☰, listing every minigame's `rules` from its phone entry, under its title.
- Chat, emotes, object actions, cutscenes, the map, the game-master panel, the bag, the character picker and the connection.

### Running screens

While its round runs, a minigame draws only its running screens: the frame mounts them when the round starts (or when a page loads or reconnects during it), and unmounts them when its podium shows or the party moves on. `mount(root, io)` builds them inside `root` and returns:

- `update(round, campaign)`: every view while they show, and the view that ends the round;
- `message(msg)`: the server's messages for its round: its unsaved messages, as the whole `{ t: 'unsaved', data }`, and on the phone an `err` refusing this phone's message;
- `unmount()`: removes its markup, listeners, loops, sounds and timers. Anything left running stays running on that phone or TV.

The screens build their own markup and load their own CSS (`addStylesheet` in `public/play/dom.js` and `public/screen/dom.js`), scoped under `root`; they add nothing to `public/play/index.html`. `PhoneIo`, `PhoneScreen`, `TvIo` and `TvScreen` in the two lists are the exact shapes; the phone's `io` sends messages and says who this phone is and whether it's the game master's, and the TV's tells whether a view directly follows the last one (no sounds for missed events).

## What a minigame can and can't do

It can:

- run its own rules, with its own game-master-only actions and its own buttons for them in its screens;
- filter its view, add its own counters, and keep server-side data of its own (blocks: best scores);
- send unsaved messages to its screens, let chosen players walk its game area, and read their positions.

It can't:

- seat players, run a lobby or keep a game master: the RPG hands it the players and the game master's id;
- handle the RPG's messages (`hello`, `join`, `leave`, `enter`, `back`, `gm`, `ack`, `pos`, `say`, `emote`, `interact`, `showJoin`, `hideJoin`, `start`, `again`, `newGame`, `endGame`, `retire`, `config`): it sees their effects as actions or views;
- switch chat or emotes off, or offer object actions: those are the party room's, between rounds;
- send different views to different players, or save anything outside its round's state and its own server data;
- draw outside its round: before it, the room at the tableau shows; after it, the podium.

## Avatars and unsaved messages

- **Server.** `walks` decides who walks its game area during its round; anyone else's `pos` is dropped. Those positions are the round's own and are dropped with it, so the room resumes where everyone stood. `io.positions()` reads them, e.g. to place a fart, and `io.send` sends the effect as an unsaved message to every phone and TV (the wire's `unsaved`, see [PROTOCOL.md](../PROTOCOL.md)). Unsaved messages are for effects, not fast-moving games.
- **Phone.** `io.joystick({ area, start })` switches the frame's joystick on in the game area, from `start`; `io.joystick(null)` or unmounting switches it off. The stick sits at the end of `root`, so a screen that rebuilds its markup while the stick is on must not empty `root` (`replaceChildren()`): add to it, or rebuild an element of its own inside it.
- **TV.** `io.avatars` is the avatar layer ([`public/screen/avatar-layer.js`](../public/screen/avatar-layer.js)), which gets `pos`, chat and emotes whatever screen shows. A screen with a game area steps it from its loop (`update(dt)`) and draws it over its own canvas (`draw(g, view, alpha, now, area, {}, ids)`, only the players in `ids`), with `view` from `io.worldView(w, h, dpr)`: size the canvas in CSS pixels times `devicePixelRatio` and pass the CSS size, as the party room does (`layout` in [`public/screen/party-room.js`](../public/screen/party-room.js)). Avatars are drawn on top, so anything they must line up with is placed in world coordinates (16 × 9). `say` and `emote` show a bubble or an emote over an avatar, e.g. from an unsaved message.

A game area is a scene built with `room()` in [`shared/scene.js`](../shared/scene.js), without props. Blocks and quiz use none of this; the stand-ins in the tests below do.

## Development start

`ITLOE_CONTENT=minigame:<kind>` starts the server on a hub and one start tableau running that minigame with its `sampleSettings`, without the story's opening:

```sh
ITLOE_CONTENT=minigame:blocks BLOKO_VAR="$(mktemp -d)" PORT=3199 npm start -- --new
```

Open `http://127.0.0.1:3199/sim/`: the TV and four phones side by side. Pick characters, Pierre among them, and tap Start on Pierre's phone. An unknown kind refuses to boot and lists the registered ones. Never use port 3131 or `var/`: that's the live evening.

## Tests

- **`npm run check` and `npm test`** for every change. `test/campaign.test.js` already checks that every registered minigame's development start validates and starts at its tableau.
- **Rules:** tests in `test/<topic>.test.js` with `node:test`, small fixtures and explicit seeds and times, that play the rules through in order, as [`test/story.test.js`](../test/story.test.js) does for the opening. Cover the RPG's actions, a stale deadline and the result.
- **Stand-ins** show how to test the minigame parts in isolation:
  - [`test/round.test.js`](../test/round.test.js): server code through a round's `io`, without a server (walking, positions, unsaved messages, what's dropped after the round);
  - [`test/avatar-layer.test.js`](../test/avatar-layer.test.js): the avatar layer over a game area;
  - `e2e-tv.mts`'s `standin` section and `e2e-phone.mts`'s part 8: a TV screen and a phone screen swapped into the lists in the browser, with avatars, unsaved messages and the joystick.
- **Over real sockets:** the `scripts/e2e-*.mts` suites start their own server on a scratch save folder; [`scripts/e2e-quiz.mts`](../scripts/e2e-quiz.mts) is the pattern for one minigame. The README's "Development commands and testing" lists them and how to run them.
- **Playing it:** a short script with [`scripts/drive.mts`](../scripts/drive.mts) plays a round of your minigame on its development start (`content: 'minigame:<kind>'`) with a TV and phones in headless Chrome, and takes screenshots to look at.
