---
purpose: Implementation brief for a clear boundary between minigames and the rest of Itloe, with the RPG owning players, rounds and the shared screens.
audience: Konstantin and the sessions implementing it, and Pierre as reviewer
maintainer: Konstantin
kind: brief
---

# Brief: the minigame boundary

## Outcome

- **The RPG is the main game.** It owns the party, joining, leaving, the host, the rooms and the screens between rounds. A minigame is something the RPG starts. It gets its players when a round starts, and has no lobby, no player management and no host of its own.
- **A new minigame can be developed, run and tested without editing the story.** Outside its own files it adds only registration lines, type entries and its content node.
- **The boundary is documented:** a contributor guide says what a minigame consists of, what it can use, and what it can't do.
- **Players see no change**, except the changes listed under "Behaviour changes".

Itloe is a party game for one evening, and agents write the code. Build what the decisions below need and nothing more. The decisions are agreed with Pierre.

## Before starting

- **The work happens on the `konst` branch.** Pierre reviews it and merges it into `master`. When to push and open the pull request is Konstantin's decision. `AGENTS.md` applies to every session working on it.
- **`konst` is rebased onto `origin/master` at `ba3c3cd`** and pushed to `origin/konst`. This brief is checked against that base.
- **Pierre works on `origin/pierre`** (the story's opening), merged after this work with adjustments. It overlaps this work in three places: its `portal` campaign action requires the opening block game's lobby (`c.at.activity?.phase !== 'lobby'`), which phase 3c removes; `public/screen/party-room.js`, which phase 5 splits; and `server/main.ts`. Its `STORY_CONTENT` passes phase 1's content validation.

## Terms

- **Minigame**: a registered kind of game with its own rules: `blocks` and `quiz` today. A content node's `activity.kind` names a minigame, or `scene`, which stays a content kind without rules.
- **Round**: one play of a minigame at a tableau. The host starts it from the room, and it runs until its podium closes. `campaign.at.activity` holds the round's state; between rounds there is none.
- **Status**: a round's `running` or `finished` (podium), derived by the minigame from its state. The quiz's `question` and `reveal` are both `running`.
- **Room**: one of the RPG's places, where avatars walk among walls and furniture (geometry from `shared/scene.js`). Today there is one, the party room, shown between rounds. Minigames have no rooms.
- **Game area**: where a minigame lets avatars walk over its own screen during its round, e.g. players already out of a block game roaming over its board to distract the others. Its bounds are a `shared/scene.js` scene without furniture.
- **Shared code**: everything that isn't a minigame's own files: the campaign engine (the RPG), the server, and the parts of the phone and TV around the games.
- **Frame**: the screens every minigame shares: the room at a tableau between rounds, the podium, and the host controls.
- **Unsaved message**: a message a minigame's server code sends to the phones and TVs during its round, never saved.
- **Avatar**: a player's walking character, as in the party room and the `pos` message.

## Where shared code is game-specific today

Checked against `origin/master` at `ba3c3cd`: `npm run check` is clean and `npm test` passes 227 of 227.

| File | Game-specific today |
|---|---|
| `shared/campaign/index.js` | `kindOf` treats every non-quiz state as blocks; `activityLobby` builds a block or quiz lobby and seats the party with `join`; `withActivity` seats newcomers in a lobby; `syncHost` copies the party host into the game; `leave` and the phase checks read `players`, `hostId` and `phase`. |
| `shared/campaign/content.js` | A fixed list of activity kinds; the start node must be a blocks tableau. |
| `shared/campaign/rules.js`, `types.js` | `record()` has one case per finished event (`game.finished`, `quiz.finished`). |
| `shared/game.js`, `shared/quiz/index.js` | Each has a lobby phase, `join`, `config`, `newGame`, its own `hostId` and its own rule for passing the host on. |
| `server/main.ts` | One message switch for both games (`handleMessage`, `handleQuiz`); `viewMsg` sends `state`, `quiz` and a campaign with the quiz re-projected; one clock per game; the best-score hook; `joinRefusal` reads `phase`; `interact` is refused during a quiz and outside a block lobby. |
| `server/resume.ts`, `server/store.ts` | `isQuiz` branches for deadlines, pending verdicts and the boot log line. |
| `public/screen/main.js` | Routes on `msg.state` and `msg.quiz`; draws the block lobby (the party room with the ITLOE band), the block game and its podium; cutscene gating reads the block podium schedule and the quiz phase. |
| `public/play/main.js`, `index.html` | Holds the block phone screens (lobby with joystick, board, drag and drop, game over, podium); `lastView` and `quizView` side by side; one fixed `<section id="view-…">` per screen; `canWalk` reads the block phase; the joystick and `updateInteraction` use `PARTY_ROOM`; `createSocial` falls back to the block state for player names. |
| `public/play/quiz-ui.js`, `public/screen/quiz-view.js` | The quiz's own lobby, play and end screens. |
| `public/play/gm-panel.js`, `host-controls.js` | Read the block phase; host controls exist only for block games. |
| `public/screen/party-room.js` | Avatar drawing, easing, labels, `pos` handling, speech bubbles and emotes are internal to `createPartyRoom`, as are the furniture effects of object actions. Avatars and the room's props are drawn in one depth-sorted list (`drawOrder`), which `e2e-tv` asserts. |

`scripts/e2e-resume.mts`, `e2e-quiz.mts` and `e2e-campaign.mts` read and edit `campaign.at.activity` in the save file directly. The e2e suites read the block or quiz state from views in about 250 places, and several follow the lobby flow (`phase === 'lobby'`). `e2e-campaign.mts` tests chat, emotes and object actions over sockets, and `e2e-tv.mts` screenshots a speech bubble and an emote (`lobby-say-emote`); the TV's debug accessors can't see either, so only the screenshot covers their drawing.

## Decisions

### Rules: pure reducers

A minigame's rules are a pure reducer in `shared/` over plain JSON state, as blocks and quiz are today. The rules supply:

- a round's initial state from a seed, the settings, the players and the start time, plus any server inputs (the quiz: its candidate questions);
- the reducer, with time, randomness, ids and the host's id passed in;
- the status;
- the next deadline, the action to fire when it passes, and a function that shifts deadlines by a downtime (used on resume and after the laptop sleeps);
- a result when finished;
- validation of content settings.

Shared code arms one timer per deadline, as the two clocks do today. A stale timer is ignored by the minigame's own deadline check, so timers are never cancelled. Saving, resuming and the sleep shift work for every minigame as they do now.

The campaign stores the round's kind next to it in `campaign.at`. An older save without it gets a derived kind: a state with `kind: 'quiz'` is a quiz, a state without `kind` is blocks. A saved kind that isn't registered stops the boot with an error naming the kind, and leaves the save file untouched. Today a load failure starts a fresh evening and quarantines the save, so this case needs its own path.

**Hosting.** The evening runs hosted on Konstantin's server, not on a laptop, so a phone's Wi-Fi or internet dropping is likelier on the night than the server going down. The production release workflow runs `npm run check`, `npm test`, `e2e:resume` and `test/hosting.test.js`. Infrastructure's deploy check reads `room` at the top of the save file and expects a `view` as the first message on a socket; every save change keeps both. A deploy restarts the server, mid-evening too, and relies on resume. A deploy that meets a save with an unregistered kind stops at boot, and Infrastructure restores the previous release and its saved data.

### Players, rounds and the host: the RPG owns them

- **Between rounds** the party is in the room at the tableau. The host taps Start, and the RPG starts a round with every party member who hasn't left the evening, online or not, as today's lobby seats them.
- **The evening opens this way:** in the room at the start tableau, without doors, with the ITLOE band and the join QR, as today.
- **During a round**, a newcomer joins the party and plays the next round. A player who leaves the evening is reported to the minigame, which decides what that means for its rules. A disconnected player keeps their seat and can take their character back from another phone.
- **The host is the party's host.** A minigame stores no host. Shared code passes the host's id with every action, so a minigame can refuse its own host-only actions (the quiz: next question, answer overrides). Those buttons live in the minigame's own screens.
- **Settings:** the host sets a tableau's settings through the shared settings sheet, from the minigame's settings schema: in the room before a round, and on the podium. The RPG keeps the choice per tableau between rounds; content gives the defaults.
- **Host controls, the same for every minigame:**
  - "End game" during a round;
  - "Take a player out", which shared code reports to the minigame; it decides what that means, and by default treats it like leaving;
  - on the podium, "Play again" (a new round at once, with everyone present, including players who joined during the round) and "Back to the room" (the room at the tableau).
- **Leaving the tableau** for the world map stays the game-master panel's Back, as today.
- **Blocks and quiz lose** their lobby phase, `join`, `newGame`, their copy of the host and their own host rule. A save with a lobby open loads as "the party in the room at that tableau", and settings saved in a lobby or on a podium move into the RPG's per-tableau settings.

### Chat, emotes and object actions: the RPG's

Chat (`say`), emotes (`emote`: victory, fart, annoy) and object actions (`interact`: the sofa, the table, the plant) belong to the RPG. Shared code handles them and never passes them to a minigame.

- **Chat and emotes** work at every moment, during rounds too, as today. A minigame can't switch them off.
- **Object actions** work only between rounds, in the party room. Their objects are the party room's furniture, so a minigame's game area has no object button. With behaviour change 4, the room at a quiz tableau gets them, like the room at a block tableau.

### Screens: the frame around every minigame

- **The room at a tableau** shows on the TV under a band with the minigame's title (blocks: "ITLOE", quiz: "Quiz!"), its settings, who's in and the join QR. Phones show the joystick with the object button, the settings and the host's Start. This is today's block lobby, drawn by shared code from the campaign.
- **The podium** is today's podium, with the extras the minigames supply: the quiz's right-answer count, and the block game's solo "New best!".
- **The frame decides when cutscenes may play.** It knows when a round runs and when its podium reveal is over.
- **A minigame draws only while its round runs.** Its running screens mount into a root element the frame gives them. They build their own markup, scope their CSS under that root, and add nothing to `public/play/index.html`. When the frame replaces them, they remove their listeners, loops, sounds and timers.
- **Moved out of the entry points:** the block code in both `main.js` files moves into block screens. `quiz-ui.js` and `quiz-view.js` keep only the quiz's running screens.
- **Shared code keeps** the connection, character picker, ☰ menu, game-master panel, bag, chat sheet, object button, join QR, cutscenes and map.

### Unsaved messages

A minigame's server code can send unsaved messages to the phones and TVs during its round. Shared code drops them once the round has ended, and the clients pass them only to the running minigame's screens. Phones need nothing new in the other direction: their plain messages already reach the minigame's server code, which can handle a message without changing saved state. Fast-moving games are not a goal.

Unsaved messages are their own message, apart from chat and emotes: those are made by players, reach every client at every moment and belong to no round. Only the server's send-to-everyone step is shared.

### Avatars: usable by any minigame

- **TV.** The avatar drawing leaves `createPartyRoom` and becomes a layer that any minigame's TV screen can use with its game area and the world-to-screen projection. The party room uses the same layer, unchanged. `pos` messages reach the layer whatever screen is showing.
  - Speech bubbles and emotes move with the layer: `say` and `emote` reach it whatever screen is showing, like `pos`. A minigame's TV screen can show a bubble or an emote over an avatar from its own unsaved message.
  - The furniture effects of object actions stay in the party room.
  - Over a minigame's screen, avatars are always drawn on top: a game area has no furniture to walk behind, as no planned minigame needs it. In the party room, avatars and props keep sharing one depth-sorted list.
- **Phone.** A minigame's phone screen can switch on the joystick with its game area and start position. The room between rounds and the map keep using it as today.
- **Server.**
  - During a round, `pos` belongs to that minigame's game area. Those positions are kept apart from the party-room positions and are dropped when the round ends, so the room resumes where everyone stood.
  - The minigame's server code decides who may walk during its round, and can read positions, for example to place a fart.
  - Effects such as a fart travel as unsaved messages.
- **For contributors:** avatars are drawn above the minigame's screen, so anything they must line up with is placed in world coordinates (16 × 9).
- Doors never fire at a tableau, which has no children. That stays as it is.

### Results: a common result plus the minigame's own counters

- **The common result.** A minigame reports its ranking (character, score, rank) and its end reason. Shared code records it once, when the status turns from `running` to `finished`, in the same save, as today. It counts `<kind>.played`, `<kind>.won.<character>` (rank 1, with two or more players), `node.<id>.finished` and the totals per kind. These are today's counter names, so content and saves keep working.
- **A minigame's own counters.** A minigame may add counters under its own name, as the quiz does with right answers. The quiz keeps its asked-question list in `facts.asked`.
- **Content decides the rest:** unlocks, rewards and where the party goes. An injected copy of a finished event is refused, as today.

### Messages and views

- **Phone to server: plain messages, with today's names.** Shared code handles `hello`, `join`, `leave`, `enter`, `back`, `gm`, `ack`, `pos`, `say`, `emote`, `interact`, `showJoin` and `hideJoin`, and now also the RPG's round messages:
  - `start`: start a round;
  - `again`: play again;
  - `newGame`: back to the room;
  - `endGame`: end the round;
  - `retire`: take a player out;
  - `config`: the tableau's settings.

  Every other message from a party member goes to the running minigame's server code, which turns it into an action or refuses it; shared code injects the sender's id and the time. A message sent just before a round ends may reach the next round, as today.
- **Server to clients: one field for the running round.** It carries the kind, the status and the minigame's view, and is empty between rounds. `view.state`, `view.quiz` and `view.best` are removed, and the best score moves inside the block view. The campaign on the wire carries no raw round state, and the saved campaign keeps it.
- **The same view for everyone.** A minigame's server code may filter it, the way the quiz hides answers until the reveal.

### The minigame contract (agreed at checkpoint 1)

- **Rules:** `MinigameRules` in `shared/minigames.js`, one entry per minigame in `MINIGAMES`.
- **Server code (phase 2):** a list in `server/minigames.ts`, one file per minigame, each entry with:
  - `message(m, ctx, io)`: every party member's message the RPG doesn't handle → an action, a refusal, or nothing; `io.apply(action)` for later actions such as the quiz's verdict;
  - `inputs?(state, facts)`: server inputs for a round's start (the quiz's candidates);
  - `view(state)`: the same view for everyone, which it may filter;
  - `onChange?(prev, next)`: e.g. the block game's best score.

  The view message carries `round: { kind, status, view } | null`. Phase 5 adds `io.send` for unsaved messages and the walking and position hooks.
- **Running screens (phase 4):** one list for phones and one for the TV, each entry `{ title, mount(root, io) → { update(round, campaign), message(msg), unmount() } }`.
  - The phone's `io` offers `send`, `meId`, `isHost()`, and the joystick on or off with a game area; the TV's offers the avatar layer and the world-to-screen projection.
  - An optional `podium(round)` adds the minigame's podium lines (the quiz's right answers, "New best!").
  - `unmount` removes the screen's listeners, loops, sounds and timers.

### Registration: explicit lists

Each layer has one list: rules, server, phone and TV. Adding a minigame means one import line in each, plus its type entries. Blocks and quiz are registered from their current files.

### Development start and protocol

- **Development start.** A setting starts the server with content made of a hub and one start tableau running the named minigame, with sample settings that live with the minigame. Combined with a scratch `BLOKO_VAR` and its own `PORT`, it lets an agent test a game in `/sim/` without playing the opening. Production content is unchanged.
- **Protocol.** `PROTOCOL.md` changes wherever these decisions need it.

## Behaviour changes

Refactoring commits keep behaviour exactly. Each change below is its own commit; a behaviour change found during the work also gets its own commit, and is reported.

Before phase 1, in this order, on today's code:

1. **The game-master panel treats a running quiz as under way.** Today its Back and enter buttons look enabled during a quiz question, and the server refuses them.
2. **The host can end a quiz from the ☰ menu.** The server already accepts `endGame` during a quiz.
3. **Remove the mock server:** `server/mock.ts`, `npm run mock`, its README row, the mock section of `PROTOCOL.md`, the TV's `bloko.debug`, and client fallbacks that exist only for it. Fallbacks that also cover a failed request stay, such as the TV's `fallbackJoinInfo`.
4. **The quiz's lobby becomes the room,** like the block lobby. The TV shows the party room with the "Quiz!" band; phones show the joystick with the object button, the settings and the host's Start.
5. **The quiz's end follows the block flow.** On the phone, "Play again" starts a new quiz at once, and "Back to the room" returns to the room at the tableau.

Between 3 and 4:

- Done: test-only commits fix two races in `e2e-phone.mts` and add end-to-end tests of chat, emotes and object actions as they work today. Behaviour change 4 flips the marked quiz-lobby line in `e2e-campaign.mts` ("in a quiz lobby") to expect object actions there.
- **Found during the work: the phone's connection banner.** When the server is gone or the network drops, the phone's first reconnect attempt fails within the banner's 700 ms grace, and that second failure cancels the banner for good: the phone shows a frozen screen instead of "reconnecting". `e2e-phone` part 1's "server down: banner" check fails for this reason. Fixed in its own behaviour-change commit (`8e9c855`).
- **Found during the work: the "phone locked" check tests nothing.** In headless Chrome 156, `Page.setWebLifecycleState('frozen')` doesn't freeze the page, so "phone locked … → unlock resumes" passes without exercising the unlock. A test-only commit makes it report a visible skip when the page didn't freeze, and require a fresh socket after the unlock.

Right after phase 3:

6. **"Play again" includes players who joined during the round,** in every minigame.

## Phases

Each phase leaves the game runnable.

### Phase 1: rules, results and the save

Scope:

- the rules list with block and quiz entries;
- the kind next to the round, its derivation for older saves, and the unknown-kind stop;
- the status in place of the phase checks in the campaign;
- the common result and its recording;
- content validation through the list, accepting a tableau of any registered minigame as the start node;
- the server's `isQuiz` and non-quiz checks (resume, boot log, best scores, join refusal, clocks, object actions) made explicit through the list.

Lobbies stay inside the games for now, and the wire stays as it is.

Done when:

- `npm run check`, `npm test`, `e2e:campaign`, `e2e:quiz`, `e2e:resume`, `e2e:inventory` and `e2e:presence` pass, with changes to the suites limited to their direct reads of the save file;
- new tests show that a save with an unregistered kind stops the boot and leaves the file byte-identical, and that a v1 save, a v2 save in a block game and a v2 save mid-question all resume.

**Checkpoint 1**: before phase 2, Konstantin reviews the minigame contract: the rules part, and the planned shapes of the server code and running screens. Agreed, as "The minigame contract" above; Pierre doesn't need to review it.

### Phase 2: server code and the view message

Scope:

- the server list;
- block and quiz server code: messages to actions, views, the quiz's judging and candidate questions, the block's best score;
- plain-message routing;
- the one view field, read by both clients and every e2e client, the clients keeping their current structure;
- `PROTOCOL.md`.

Done when every unit test and every e2e suite passes, including `e2e:tv` and `e2e:phone` in Chrome, and the quiz suite's check that no answer reaches the wire before the reveal still passes.

### Phase 3: players and rounds move to the RPG

This is the riskiest phase. It moves five jobs that the games' lobbies do today into the campaign: seating, the host, settings, replays, and choosing the screen between rounds. Every change in the game passes through the campaign. A mistake here can miscount the story, seat the wrong players, lose the host, break a restart, or show the wrong screen at the start of the evening.

Two rules hold for the whole phase:

- **It comes in three steps**, each leaving the game runnable, with every suite passing and the screenshots matching before the next step starts.
- **Test edits stay limited to message and state shapes.** The suites' assertions about what players experience don't change: who plays, what's counted, what survives a restart. Test changes go in their own commits, so Pierre can review them apart from the code.

**Before 3a**, save screenshots of every block and quiz screen on TV and phone, as the reference for the whole phase. `e2e:tv` and `e2e:phone` save screenshots with `SHOTS=<dir>`; extend them where a screen isn't covered yet.

#### 3a. Settings move to the campaign

The campaign keeps each tableau's settings. The games keep their lobbies, but read and write settings through the campaign. A save whose settings were changed in a lobby or on a podium keeps them.

#### 3b. The host moves to the campaign

The games stop storing a host, and shared code passes the party host's id with every action. Blocks and quiz keep their own rules for who may do what, now checked against that id.

#### 3c. Rounds and seating move to the campaign

Scope:

- the campaign's room-at-a-tableau state between rounds;
- the round messages: start, play again, back to the room, end, take a player out;
- rounds starting with the players handed in;
- blocks and quiz without lobby, `join` or `newGame`;
- the save migration;
- the room at a tableau drawn by shared code from the campaign;
- `PROTOCOL.md`.

Then behaviour change 6, in its own commit.

#### Done when, after each step

- every suite passes;
- the screenshots match the reference;
- after 3a, a test shows that settings saved in a block lobby and on a block podium survive a restart;
- after 3c, tests show that saves in a block lobby, in a quiz lobby and on a block podium all load as described.

### Phase 4: the frame and the running screens

Scope:

- the shared podium and host controls;
- the settings sheet fed by the minigame's schema;
- cutscene gating;
- block and quiz running screens mounted by the frame;
- the block code out of both `main.js` files.

Done when:

- every suite passes;
- screenshots match those from before the phase;
- a test shows that game → map → another game removes the old screens' listeners, loops and timers.

### Phase 5: unsaved messages and avatars for minigames

Scope: unsaved messages; the avatar layer extracted from `createPartyRoom`, with speech bubbles and emotes; the joystick for minigame phone screens; `pos` per round; the server-code hooks for who may walk and for reading positions; `PROTOCOL.md`.

Done when:

- the party room looks and behaves as before, speech bubbles and emotes included, by the existing suites and the screenshots;
- tests with a stand-in minigame show that a game can enable walking for some players and not others, read their positions, and send an unsaved message that reaches the TVs. They also show that the party-room positions are back after the round, and that an unsaved message after the round ended is dropped. The tests call the shared functions with a stand-in, so nothing test-only ships.

### Phase 6: development start and the contributor guide

Scope:

- the development start setting;
- a contributor guide as a `reference` document: what a minigame consists of, its registration lines, what the frame offers, what a minigame can and can't do, avatars and unsaved messages, the development start, and tests. Blocks is the worked example;
- the README's scripts and environment variables.

Done when blocks and quiz each start directly with their own scratch save folder, and the guide matches what adding a minigame actually takes.

## Acceptance

- Blocks look and play as today, apart from behaviour change 6. The quiz plays as today, apart from its lobby and its end (behaviour changes 4 and 5). Replay, return to the world, reclaim from another phone, and save and resume work for both.
- Quiz answers stay hidden until the reveal, in every message.
- A finished round records progression and rewards once, also across reconnect and restart. Timed minigames keep their remaining time after a restart or a sleep.
- Game → map → another game leaves nothing of the old game running on the clients.
- A minigame has no lobby, player-management or host code: its rules get the players when a round starts.
- Shared code names no minigame. Outside each minigame's own files, `blocks` and `quiz` appear only in:
  - the registration lists and type unions;
  - content;
  - the kind derivation for older saves;
  - block and quiz markup that stays in `public/play/index.html`.

Verification uses `npm run check`, `npm test`, and the campaign, quiz, inventory, presence, resume, TV and phone suites. E2e suites run their own servers on their own ports, never 3131, and the TV and phone suites need Chrome started with `--remote-debugging-port`.

## Out of scope

- The first new minigame.
- More RPG rooms (Pierre's work; the avatar layer works in any room).
- Using avatars in blocks or quiz, such as roaming after elimination.
- Fast-moving games.
- Separate views per player.
