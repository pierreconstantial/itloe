---
purpose: How to add a minigame to Itloe, what it consists of, what the shared code gives it and what it can't do.
audience: Contributors and coding agents adding or changing a minigame
maintainer: Konstantin and Pierre
kind: reference
---

# Adding a minigame

A minigame is a few files of its own, registered in four lists. Everything around it (the party, joining, the host, the rooms, the screens between rounds) belongs to the RPG, which starts a round with its players and ends it when its podium closes. Blocks is the worked example throughout. The wire is in [PROTOCOL.md](../PROTOCOL.md); exact shapes are in the code linked below.

> **Draft.** Sections marked *(draft)* are written from the agreed contract, ahead of the code; check them against it.

## Terms

- **Evening**: one playthrough of the campaign, from the false start on, saved and resumed as one.
- **Node**: a place in the story's content, by kind: the **hub**, where the story opens out; a **world**, one period of Élodie's life, entered from the hub; a **tableau**, one spot inside a world (or the false start, under the hub) with one activity: a minigame or a scene. The party is at one node at a time (`campaign.at.node`).
- **Minigame**: a registered kind of game with its own rules, e.g. `blocks` and `quiz`. A tableau's `activity.kind` names a minigame, or `scene`, which is a content kind without rules.
- **Round**: one play of a minigame at a tableau. The host starts it from the room, and it runs until its podium closes. `campaign.at.activity` holds the round's state; between rounds there is none.
- **Status**: a round's `running` or `finished` (the podium), derived by the minigame from its state.
- **Room**: what the TV draws for a node: a space with walls and furniture where avatars walk (`ROOMS` in [`shared/scene.js`](../shared/scene.js)). A node names its room, else it gets the party room ([`roomAt`](../shared/campaign/content.js)). Minigames have no rooms.
- **Map**: the room at the hub or in a world, with a door for each node the party can enter from there.
- **The room at a tableau**: the room between rounds at a tableau, under the tableau's band.
- **Game area**: where a minigame lets avatars walk over its own screen during its round, e.g. players already out of a game roaming over its board. Its bounds are a `shared/scene.js` scene without furniture.
- **Shared code**: everything that isn't a minigame's own files: the campaign engine (the RPG), the server, and the parts of the phone and TV around the games.
- **Frame**: the screens every minigame shares: the room at a tableau between rounds, the podium, and the host controls.
- **Unsaved message**: a message a minigame's server code sends to the phones and TVs during its round, never saved.
- **Avatar**: a player's walking character, as in the party room and the `pos` message.

## What a minigame consists of

| Part | What it is | Blocks |
|---|---|---|
| Rules | A pure reducer over plain JSON state, run by the server and the browsers | [`shared/game.js`](../shared/game.js), `BLOCK_RULES` |
| Server code | Messages to actions, server inputs, the view, change hooks | [`server/blocks.ts`](../server/blocks.ts) |
| Phone screens *(draft)* | Its running screens on the phones | `public/play/blocks-ui.js`, `BLOCK_SCREEN` |
| TV screens *(draft)* | Its running screens on the TV | in `public/screen/` |
| Content | A tableau whose `activity` names it, with its settings | `activity: { kind: 'blocks', settings: { size: 9 } }` in [`shared/campaign/sample.js`](../shared/campaign/sample.js) |

### Registration lines

One import line and one entry in each list, under the minigame's kind:

- the rules list, `MINIGAMES` in [`shared/minigames.js`](../shared/minigames.js);
- the server list, `makeMinigameServers` in [`server/minigames.ts`](../server/minigames.ts);
- the phone list, `SCREENS` in `public/play/minigames.js` *(draft)*;
- the TV list in `public/screen/minigames.js` *(draft)*.

Then its type entries in [`shared/campaign/types.js`](../shared/campaign/types.js): its state in `ActivityState`, its settings in `TableauSettings`, its content entry in `Activity`, and its actions in the `activity` case of `CampaignAction`. Nothing else outside its own files changes: `npm run check` finds what's missing.

## Rules

`MinigameRules` in [`shared/minigames.js`](../shared/minigames.js) lists what the rules supply and what each function must do. What matters for the design:

- **Pure and deterministic.** Time, randomness and ids come in through actions and the round start; the reducer does no I/O. A refused action returns the same state object: the server uses that identity to skip saving and broadcasting.
- **A round starts running** with the players the campaign hands in (`init`): every party member who hasn't left the evening, online or not. There is no lobby and no `join`.
- **The RPG's actions.** Besides its own actions, the reducer gets `leave` (a player left the evening), `endGame` (the host's "End game") and `retire` (the host's "Take a player out"). It decides what each means for its rules; `retire` usually works like `leave`. Blocks: a leaver's board freezes, and the last player out ends the round.
- **The host.** A minigame stores no host. Every action comes with the party's host id (`RoundCtx`), so the reducer can refuse its own host-only actions, as blocks does for `endGame` and the quiz for its next question.
- **Deadlines.** `deadline` names the next one, and shared code arms a timer for it that fires `deadlineAction`. A timer is never cancelled, so the reducer must refuse a stale one: blocks compares the action's `deadline` with the state's. `shiftDeadline` moves the clock by a downtime, so a timed round keeps its remaining time across a restart or a sleeping laptop.
- **The result.** Once the status turns `finished`, the campaign records `result` once, in the same save: the ranking and end reason make the common counters (`<kind>.played`, `<kind>.won.<character>`, `node.<id>.finished`, the totals per kind), plus any counters of the minigame's own under its name. Content decides unlocks and rewards from them.
- **Settings.** `settings` merges valid keys over a base, `validateSettings` reports a content node's problems at boot, and `sampleSettings` feeds the development start.

## Server code

`MinigameServer` in [`server/minigames.ts`](../server/minigames.ts) describes each hook. In short:

- **`message`** gets every message from a party member that the RPG doesn't handle, with the sender's id, the time, the host's id and the round's state, and returns an action, a refusal or nothing. Build the action field by field from the message, so server-only inputs never come from the wire (blocks: `place`).
- **`inputs`** supplies what a round starts with besides the players and settings (the quiz: its candidate questions from the server-only bank).
- **`view`** is what every phone and TV gets, the same for everyone. Filter it here: the quiz hides answers until the reveal.
- **`onChange`** runs after every change of its round, before the save (blocks: solo best scores).
- **`walks`** says who may walk its game area during its round; without it, nobody walks.
- **The `io`** belongs to one round: `apply` runs a later action (the quiz's verdict), `send` sends an unsaved message, `positions` reads where the walkers stand. After the round ends, whatever goes through it is dropped ([`server/round.ts`](../server/round.ts)).

## The frame

Shared code draws everything outside a running round, the same for every minigame:

- **The room at the tableau** before a round: on the TV the minigame's title on the band, its settings, who's in and the join QR; on the phones the joystick with the object button, the settings, and the host's Start.
- **The settings sheet** *(draft)*, built from the phone entry's `settings` (its schema and wording), in the room and on the podium. The RPG keeps the host's choice until the party leaves the tableau.
- **The podium** *(draft)*: ranking and medals, with the minigame's extras from its entry's `podium` (the quiz's right answers, blocks' "New best!"). The host gets "Play again" (a new round at once, with everyone present) and "Back to the room".
- **Host controls** in ☰ during a round: "End game" and "Take a player out".
- **"How to play"** *(draft)*, from the phone entry's `rules`.
- Chat, emotes, object actions, cutscenes, the map, the game-master panel, the bag, the character picker and the connection.

### Running screens *(draft)*

While its round runs, a minigame draws only its running screens. Each list entry has a `title` and `mount(root, io)`, which builds its screens inside `root` and returns:

- `update(round, campaign)`: every view while they show;
- `message(msg)`: the server's messages for its round, including its unsaved messages and an `err` refusing this phone's message;
- `unmount()`: removes its markup, listeners, loops, sounds and timers. The frame calls it when the round ends or the party moves on; anything left running stays running on that phone or TV.

The screens build their own markup and scope their CSS under `root`; they add nothing to `public/play/index.html`. The phone's `io` offers `send`, `meId`, `isHost`, `online`, `connected`, and the joystick on or off with a game area. The TV's `io` offers the avatar layer and the world-to-screen projection. `PhoneIo` and `PhoneScreen` in `public/play/minigames.js` are the exact shapes.

## What a minigame can and can't do

It can:

- run its own rules, with its own host-only actions and its own buttons for them in its screens;
- filter its view, add its own counters, and keep server-side data of its own (blocks: best scores);
- send unsaved messages to its screens, let chosen players walk its game area, and read their positions.

It can't:

- seat players, run a lobby or keep a host: the RPG hands it the players and the host's id;
- handle the RPG's messages (`hello`, `join`, `leave`, `enter`, `back`, `gm`, `ack`, `pos`, `say`, `emote`, `interact`, `showJoin`, `hideJoin`, `start`, `again`, `newGame`, `endGame`, `retire`, `config`): it sees their effects as actions or views;
- switch chat or emotes off, or offer object actions: those are the party room's, between rounds;
- send different views to different players, or save anything outside its round's state and its own server data;
- draw outside its round: before it, the room at the tableau shows; after it, the podium.

## Avatars and unsaved messages

- **Server.** `walks` decides who walks its game area during its round; anyone else's `pos` is dropped. Those positions are the round's own and are dropped with it, so the room resumes where everyone stood. `io.positions()` reads them, e.g. to place a fart, and `io.send` sends the effect as an unsaved message (the wire's `unsaved`, see [PROTOCOL.md](../PROTOCOL.md)). Unsaved messages are for effects, not fast-moving games: every one goes to every phone and TV.
- **Phone** *(draft)*. A phone screen switches the joystick on with its game area and a start position, through its `io`.
- **TV** *(draft)*. The avatar layer ([`public/screen/avatar-layer.js`](../public/screen/avatar-layer.js)) draws every avatar, with speech bubbles and emotes, whatever screen is showing. A TV screen draws it over its own canvas with its game area and the projection from `worldView`. Over a minigame's screen, avatars are always on top, so anything they must line up with is placed in world coordinates (16 × 9). A TV screen can show a bubble or an emote over an avatar from its own unsaved message.

A game area is a scene built with `room()` in [`shared/scene.js`](../shared/scene.js), without props.

## Development start

`ITLOE_CONTENT=minigame:<kind>` starts the server on a hub and one start tableau running that minigame with its `sampleSettings`, without the story's opening:

```sh
ITLOE_CONTENT=minigame:blocks BLOKO_VAR="$(mktemp -d)" PORT=3199 npm start -- --new
```

Open `http://127.0.0.1:3199/sim/`: the TV and four phones side by side. Pick characters and tap Start on the host's phone. An unknown kind refuses to boot and lists the registered ones. Never use port 3131 or `var/`: that's the live evening.

## Tests

- **`npm run check` and `npm test`** for every change. `test/campaign.test.js` already checks that every registered minigame's development start validates and starts at its tableau.
- **Rules:** unit tests in `test/<topic>.test.js` with `node:test`, small fixtures and explicit seeds and times, as [`test/shared.test.js`](../test/shared.test.js) does for blocks. Cover the RPG's actions, a stale deadline and the result.
- **Server code:** [`test/round.test.js`](../test/round.test.js) drives a stand-in minigame's server code through a round's `io`, without a server: walking, positions, unsaved messages, and what's dropped after the round.
- **Over real sockets:** the `scripts/e2e-*.mts` suites start their own server on a scratch save folder; [`scripts/e2e-quiz.mts`](../scripts/e2e-quiz.mts) is the pattern for one minigame. The README's "Development commands and testing" lists them and how to run the browser suites.
