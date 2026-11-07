# Itloe — wire protocol (Contract B, FROZEN — English rename applied 2026-11-03)

Transport: WebSocket, JSON text frames. HTTP static + WS share port **3131** (`PORT` env overrides). WS path: **`/ws`**.

Static serving: `public/` at `/` (`/` redirects to `/screen/`), and **`shared/` is served at `/shared/`** so browser clients import the same game logic: `import { canPlace } from '/shared/board.js'`.

Pages: `/screen/` (TV), `/play/` (phones), `/sim/` (dev harness), `/admin/` (admin page).

The selectable roster is Pierre, Élodie, Sol, Anna, Nico, Konz and Mathieu (colour slots 1–7).
Mathieu uses the existing join/reclaim messages and story wisp/incarnation behaviour, with
`person.mathieu.unlocked` as his introduction flag.

## Client → server

```jsonc
{ "t": "hello", "role": "player", "room": "ABCD", "playerId": "p-abc123" }
// room comes from the join URL (?room=) and is required to join; a rejoin with a known
// playerId skips the room check (stored ids survive a new code). playerId optional.
{ "t": "hello", "role": "screen" }                          // screen is exempt from the room check
{ "t": "join",  "character": "anna" }                       // after hello; M3: pick a free character from shared/characters.js
                                                            // name + colour derive from the character; err "taken" if already picked
                                                            // RECLAIM (slice 2b): a character held by an OFFLINE (no live socket),
                                                            // non-left player → this socket becomes THAT player, any phase: welcome
                                                            // with the EXISTING playerId (+ own pos), same board/score/hand (Pierre
                                                            // stays game master). Held by an ONLINE player → err "taken". A left player's character
                                                            // is free (never reclaimable). Needs the room code like any join. Refusal codes
                                                            // unchanged: a minigame running or roster exhausted → "full", else "taken".
{ "t": "startMinigame" }                                    // the main game's minigame messages: see Campaign, Routing
{ "t": "endMinigame" }
{ "t": "ready", "on": true }                                // the plain lobby's messages: see Minigames and their lobbies
{ "t": "config", "patch": { "mode": "timed" } }
{ "t": "start" }
{ "t": "lobby" }
{ "t": "place", "piece": 0, "x": 3, "y": 5 }                // piece = index 0..2 in own hand; (x,y) = piece origin
{ "t": "leave" }                                            // leaves the evening; a block game: playing → marked done, podium → removed
{ "t": "endGame" }                                          // game master, a block round playing → finished: every not-done player is
                                                            // marked done (board frozen, score kept), endReason "gm"
{ "t": "retire", "target": "p-abc123" }                     // game master, a block round playing: the target is marked done + retired (board frozen,
                                                            // still ranked, NOT left: keeps seat + character, can reconnect). Everyone
                                                            // done → finished, endReason "stuck". Unknown, done or left target →
                                                            // silent no-op. The game master may retire themself.
{ "t": "pos", "x": 7.2, "y": 4.5, "dir": "down", "moving": true }
{ "t": "jump" }                                             // joined, incarnated player while no minigame runs; visual hop only
// M3 avatar movement — EPHEMERAL, never enters the reducer State. Client-authoritative:
// the phone integrates its joystick locally and sends throttled updates (≤ 15/s, only when
// something changed). World coordinates: x ∈ [0,16], y ∈ [0,9] (16:9 units, avatar ≈ 1.2 units
// tall); dir ∈ up|down|left|right. Server clamps to bounds and drops malformed or non-joined
// senders silently. While no minigame runs, pos moves the player in the room (doors below). While one
// runs (from the game master's start to his end), pos is kept and relayed only from wisps, and from the
// players it shows while its lobby is walkable (spots, under Minigames and their lobbies), in the room's
// positions and without doors; anyone else's is dropped silently, and the room's positions stay where
// everyone stood (no longer moving).
{ "t": "takeSpot", "spot": "team1-clue" }                // a player walking a walkable lobby: onto a free spot (below)
{ "t": "say", "text": "Hello!" }                         // joined player; 1–100 printable characters
{ "t": "emote", "kind": "victory" }                      // incarnated: victory | fart | annoy; wisp: shine
{ "t": "interact", "object": "table" }                    // near an object of the room where the party is (sceneAt),
                                                         // or the chooser near an item on the floor: object = item id
// Speech and emotes are short lived, server relayed events, limited to one per 650 ms per socket.
// Every `hello` (phones, new devices and screens alike) is answered with { t: "chatHistory", messages: [...] }
// holding up to 30 recent speech events. The history is in memory only and is cleared by a server restart.
// Interaction is available while no minigame runs, wherever the party is (hub/world, a scene tableau, the room
// at a tableau). The server checks the sender's latest position (none yet:
// their spawn point in the party room) and their statuses and inventory against the closest allowed object,
// then relays an `interact` event with playerId, object, action, feedback, at, and `speaker: "object"` when the
// prop says the feedback (an NPC's line) rather than the player. It is limited to one per 700 ms per socket.
// Object rules: the furniture's in shared/interactions.js, the story's from its machines' current states
// (objectRules, docs/story-engine.md): player override, character override, first matching status/inventory
// condition, then the default. Each action has key, text, feedback; null denies interaction. A story action
// is then applied to the campaign as `use` (a machine may move on). Wisps cannot use any object action, even a
// player override. An item lying where the party is (a story pickup) is picked up by the chooser within reach.
```

For example, the table is a scene object with `id: "table"` and a `box`, `solid`, `anchorY` and `layer` in
`shared/scene.js`. An action model keyed by that ID in `shared/interactions.js` can use conditions:

```jsonc
"table": {
  "default": { "key": "blow-candles", "text": "🎂 Blow candles", "feedback": "Make a wish!" },
  "variants": [{ "when": { "statuses": ["charged"], "items": { "memory-key-intro": 1 } },
    "action": { "key": "make-wish", "text": "✨ Make a wish", "feedback": "The candles glow." } }]
}
```

An optional `byPlayer` entry may define a different action for one player ID. Conditions can combine
`statuses: ["charged"]` with `items: { "memory-key-intro": 1 }` to require a status and a key.

Server-internal reducer inputs (`now` on startMinigame/start, a round's server `inputs`, the `timeUp` action,
`deadline`) are NEVER accepted from the wire: the server injects them itself and strips them from client messages.

### Campaign (slice 3, Contract D v2 + A1): the evening around its minigames

The server runs the campaign engine (`shared/campaign/`). The party (who is in the evening, their characters)
lives in `campaign.party`. The game master is whoever holds the character the content names (`gameMaster`:
Pierre in every content), wisp or not, and nobody while that character isn't in the evening: the role never
passes on (`gameMasterId`, shared/campaign/index.js). A minigame stores none: the server passes the game master
with every action, and the minigame's view carries none.

A minigame runs from the game master's `startMinigame` to his `endMinigame`: its lobby, its rounds and their
podiums. Its state is `campaign.at.activity`, nested in its tableau, with its kind in `campaign.at.kind`; the
finished rounds' results are kept in `campaign.at.results` until it ends. While none runs (`campaign.at.activity`
null) the party is in the room at the tableau; `campaign.at.kind` names the tableau's minigame there too (null on
the hub, in a world, at a scene).

**Eligible players** (`eligibleOf`, shared/campaign/index.js): the characters the tableau's `activity.eligible`
names, among the party members who haven't left, story wisps included; without names, every member who hasn't
left and isn't a story wisp; online or not, in party order. The minigame starts with them, and hears of every
change while it runs: someone who becomes eligible (joins the evening, is incarnated) as its `join`, someone who
stops being eligible (leaves the evening, becomes a story wisp where the tableau names nobody) as its `leave`.
**The content's ready rule** (`activity.allReady`, `readyRuleMet`): a round starts only when every character the
tableau names is in the party and ready (without names: every eligible player is ready); the main game refuses
any step into a running round otherwise, whatever the minigame.

**Results.** When a round reaches its podium, its result is kept in `campaign.at.results`, in the same step.
When the game master ends the minigame, every kept result is recorded in order, each with its counters and the
settling that follows (unlocks, rewards, news), in one step and one save: a `winner` reward goes to the winners of
the round that completed the node. A minigame ended before any round finished records nothing.

`join` and `leave` act on the EVENING: `join` adds a party member, `leave` leaves the evening (the stored id stops
rejoining). Every id is injected by the server (socket → playerId; screens: `"screen"`), never taken from the wire.

**Routing.** The server handles `hello`, `join`, `leave`, `enter`, `choose`, `back`, `gm`, `ack`, `pos`, `say`,
`emote`, `interact`, `showJoin`, `hideJoin`, `takeSpot`, `startMinigame` and `endMinigame` itself:

- `startMinigame`: the game master, in the room at a minigame's tableau: the minigame starts, in its lobby, with
  the eligible players and the tableau's settings (the content's, over the minigame's defaults). Every start has
  a new seed.
- `endMinigame`: the game master, in the minigame's lobby: the results are recorded, and the party is in the
  room at the tableau.

Elsewhere than at a minigame's tableau → `err "not-playing"`; a guest's → `err "not-gm"`; the game master's at
the wrong moment → `err "refused"`.

Every other message from a party member goes to the running minigame's server code (`server/minigames.ts`),
with the sender's id, the time, the game master and the questions asked this evening (`asked`, the running
minigame's finished rounds included) injected; it turns the message into an action or refuses it, and answers a
message it does not know with `err "not-playing"`. With no minigame running → `err "not-playing"`; from a socket
that is not a party member → `err "unknown-player"`. A message sent just before a round ends may reach the next
round.

A minigame's server code may handle a message without changing saved state, and may answer with unsaved
messages (`unsaved` below) while it runs.

### Minigames and their lobbies

Blocks, quiz, Pyramide and backgammon run in the plain lobby (`shared/plain-lobby.js`, `server/plain-lobby.ts`); a minigame with
its own lobby accepts the same messages where they apply. A guest's game-master message → `err "not-gm"`; the
game master's at the wrong moment → `err "refused"`.

```jsonc
{ "t": "ready", "on": true }           // an eligible player, in the lobby: ready for the next round, or (false) no longer;
                                       // in a lobby with spots (Pyramide) → err "refused": holding a spot is being ready
{ "t": "config", "patch": { … } }      // game master, in the lobby: the minigame's settings, from its schema; invalid
                                       // keys/values ignored, his no-op patch silent; outside the lobby → err "locked"
{ "t": "start" }                       // game master, in the lobby, with one ready player or more (and the content's
                                       // ready rule met): a round with the ready players, in party order; the quiz picks
                                       // its questions among the bank's candidates, none left → refused
{ "t": "endGame" }                     // game master, a round running → its podium, endReason "gm"
{ "t": "retire", "target": "p-abc" }   // game master, a round running: the minigame decides what taking a player out
                                       // means; without its own rule (the quiz) it is the target's leave from the round:
                                       // no more answers, the score kept. An unknown, done or left target → silent no-op
{ "t": "lobby" }                       // game master, on the podium: back to the lobby; the round's players come back
                                       // ready, except who left or was taken out, or is no longer eligible; in a lobby
                                       // with spots, on the spots they left
```

Every other message goes to the running round's server code (blocks: `place`; quiz: `answer`, `next`,
`override`); in the lobby or on the podium → `err "not-playing"`. A player who becomes eligible during a round
is listed in the lobby and plays from the next round on.

**A walkable lobby.** A minigame may make its lobby walkable: while it lists its spots (the view's `spots`, non-null;
empty without spots, as in every plain lobby whose minigame has none), the players it shows walk over its screens as
their characters, with `pos`, `say` and `emote` as in the room, and wisps walk as always. A spot is a named area in
world units, with the player holding it, or null; who holds it is the minigame's saved state.

- **Stepping onto a spot:** the server reads each walker's `pos` against the spots, edge-triggered like the doors:
  stepping onto a spot, off it or from one to another gives the minigame the action `spot { id, spot }` (the spot's
  id, or null), injected by the server, never from the wire. A walker's first known position only sets where it
  stands; a wisp on a spot counts for nothing. The minigame decides what the step means: in the plain lobby with
  spots, a free spot is taken and the one held before is let go; a held spot stays its holder's.
- **`takeSpot`:** a walker onto a free spot from the phone: the server moves the character to the spot's centre,
  sends that `pos` to the walker's phone and the screens, and the step onto it follows as above. An unknown or held
  spot, or a sender not walking the lobby → `err "refused"`.
- **Start positions:** whoever starts walking the lobby (the minigame's start, a join, back from a round they sat
  out, a restart: positions are in memory only) is placed by the server, on the screens and on its phone: a holder on
  its spot's centre, anyone else on one of the minigame's start positions. A disconnected walker stays where it stood,
  so a holder keeps its spot.

```jsonc
{ "t": "enter", "node": "childhood" }   // game master, or the content's chooser (Élodie), into an UNLOCKED child of where
                                        // the party is; refused while a minigame runs, or on a done one-shot
                                        // tableau → err "refused". Entering a minigame's tableau: the room there, no
                                        // minigame running (the game master starts it).
{ "t": "back" }                         // game master only (birthday story after the portal: the chooser only, while no
                                        // minigame runs): up one level (tableau → world → hub). A running minigame ends
                                        // first, as endMinigame (a running round dropped). At the hub → err "refused";
                                        // anyone else → err "not-gm".
{ "t": "gm", "op": { "op": "unlock", "node": "teens" } }
                                        // game master only, even while he is a Wisp. A goto while a minigame runs
                                        // ends it first, as back does. Ops: goto / unlock / lock /
                                        // setFlag / count / reset-node / give / take / wisp / machine
                                        // (shapes: shared/campaign/types.js GmOp; machine: put a story machine
                                        // in a state, docs/story-engine.md).
                                        // Anyone else → err "not-gm"; a GM's no-op is silent, except give/take (Contract F:
                                        // { op:'give', item, to, count? } / { op:'take', item, from, count? }):
                                        // unknown item or character, or taking more than held → err "refused"
                                        // (no partial take).
{ "t": "gm", "op": { "op": "wisp", "character": "sol", "on": true } }
                                        // GM only: switch a joined character into Wisp Mode at any time.
                                        // on:false starts the existing 3-second incarnation. While a
                                        // minigame runs whose tableau names nobody, on:true makes that player
                                        // no longer eligible (out of a running round); once incarnated they
                                        // are eligible again and play from the next round.
{ "t": "ack", "upTo": 3 }               // SCREENS only: the TV finished the cutscenes of every news entry with
                                        // seq <= upTo; they leave `campaign.news`. upTo is required. Two TVs, or a
                                        // TV reconnecting mid-cutscene, never drop a cutscene they did not play.
```

- **Story offers:** a story machine's state can offer the chooser a child node (`offerAt`, e.g. the painted tram's
  quiz, offered for 30 s after Élodie talks to the tram). Accept sends the ordinary `enter`; the node's `enterWhen`
  holds only during the offer, and a node with `startsOnEnter` opens its minigame's lobby in the same step (one
  save). Dismiss sends nothing.
- **Doors:** `pos` stays ephemeral, but while no minigame runs the server reads it against the current node's doors (`zoneAt`):
  stepping INTO a door (edge, not standing in it) records `zone.entered` for that character, and for the
  content's chooser on an unlocked door applies `enter`. After the party moves, standing where a door
  now is does not fire it: only a fresh step in does.
- **Exactly once:** a round's running → podium (stuck, time, game master) keeps its result in `campaign.at.results`
  in the SAME step, and the minigame's end records them all (`round.finished`) in one step; the server saves once per
  step: a kill -9 persists both or neither, so a restart never counts a round twice.

### The story on the wire (Contract D v3, docs/story-engine.md)

The story's sequences are machines in the content; their states travel in `campaign.facts.machines`
(`{ [machine]: { state, since } }`), and the clients derive everything else from the content with the shared
queries (hints, zones, pickups, NPC lines, hidden props, offers, the held chooser). No message names the story:

- the chooser walking into a story zone (the portal) is an ordinary `pos`; the server applies `zone` and, if the
  zone says so, sends the chooser's new position (`pos` echo) where they arrive;
- using a story object is an ordinary `interact`; picking up an item on the floor is `interact` with the item id;
- the chooser answering a story choice (`choiceAt`, e.g. where the tram goes after its quiz) sends
  `{ "t": "choose", "option": "flat" }`; an option not open now, or anyone but the chooser → err `refused`;
- a scripted cutscene is the news entry `{ "seq": 1, "t": "cutscene", "id": "apparition" }`; the TV plays the
  cutscene of that id and sends the ordinary `ack`, which moves the machines waiting for it;
- timed states (an NPC leaving after three seconds) are fired by the server's clock, also after a restart.

The opening (`opening` machine): the four play the block game (its tableau names them and requires them all
ready); when Pierre ends it after a finished round, a portal opens in the room; Élodie walks into it, the others
become wisps and everyone moves to the dream apartment while the apparition plays (Élodie is held still); then
the key lies on the floor until she picks it up, which unlocks Young Adult. From the portal on, Élodie alone
moves the party (`leadAfter`): the game master moves it with `gm goto`.

Wisps: a later joiner who selects a predefined character starts in Wisp Mode unless the story introduced that
character (`cast`). Wisps have no name label, keep a hint of their character's color, and pulse slightly while
moving. They can move and send `{ "t": "emote", "kind": "shine" }`, which briefly brightens their light; the phone
offers Shine beside nearby objects and items. Wisps cannot speak, interact with objects or NPCs, or trigger zones.
They are eligible for a minigame only where its tableau names their character. Pierre may still use game-master
commands while a Wisp. The engine incarnates a wisp when the story sets its `person.<character>.unlocked` flag, when a story
machine's `incarnate` effect names its character (Pierre arriving in Élodie's flat), or from the GM's `wisp`
operation; a machine's `wisp` effect makes it a wisp again. When incarnation begins, the campaign persists `statuses: ["wisp",
"incarnating"]` and the next `view` includes `incarnations: { "<playerId>": { "at": <server epoch ms>, "kind":
<emote> } }`. Until `at`, the TV draws the wisp, the phone vibrates and displays **3, 2, 1**, and the server
rejects character actions. At `at`, the server removes both statuses, broadcasts a new `view`, then broadcasts the
chosen normal `emote`. A restart during the countdown reschedules it from the persisted pending status.

### Quiz (Contract E + addendum E1): a tableau `activity: { kind: 'quiz', settings }`

The bank (`data/quiz/*.json`) stays on the server and is never served. While a quiz round runs, its messages
below go to the quiz (Routing above); block-only messages (`place`) get `err "not-playing"`, and `retire`
marks the target `left` in the running quiz (the round stops waiting for their answer).

```jsonc
{ "t": "start" }                       // game master, in the quiz's lobby: picks `count` questions among the bank (filtered by
                                       // the settings, minus every question asked this evening, the quiz's earlier rounds
                                       // included); none left → err "refused"
{ "t": "answer", "choice": 2 }         // a choice round: the DISPLAYED index (choices are shuffled per round)
{ "t": "answer", "text": "Victor Hugo" } // a text round. Once per round, before the deadline; else err "refused".
                                       // The server judges it (choice: index; text: local French matcher; 'uncertain' →
                                       // the pluggable judge, 4 s timeout, none for now → wrong) and only the verdict
                                       // enters the reducer. The last answer closes the round at once.
{ "t": "next" }                        // game master, on the reveal: next question, or finished after the last
{ "t": "override", "target": "p-abc", "ok": true }   // game master, on the reveal: fixes any answer, both ways, re-scoring it
{ "t": "config", "patch": { "count": 10, "seconds": 20, "mode": "mixed" } }  // the quiz's settings, in its lobby
                                       // (count 3–30, seconds 10–60 step 5, mode choice | text | mixed; also
                                       // categories: string[] | null, level: 1 | 2 | 3 | null)
```

- **Never the answer before the reveal:** during a quiz the round's view is the PUBLIC projection
  (shared/quiz/bank.js `projectQuiz`), and the campaign on the wire carries no minigame state. During
  `question`: the question text, category, level, the displayed choices (choice rounds), and `answered`
  (who answered, never what). From `reveal` on: `answers` (choice/text, ok, points) and `answer`
  `{ choice: displayed index | null, text, anecdote? }`. The anecdote (a bank question's
  optional fun fact) is part of the answer: it often gives it away, so it never travels before the reveal.
  `answer.source` (the question's dataset + licence) comes with it, and the view's `credits` (every phase) lists
  one attribution line per loaded bank file (`dataset.attribution`, else "name — licence"): CC BY-SA datasets
  must stay credited in the game.
- **Scoring:** right = 100 + up to 50 for speed (linear on the time left); wrong or none = 0.
- **Timed fairness:** an open question's deadline shifts on resume and after a suspended laptop, like the timed
  block game. An answer left waiting for the judge when the server stopped is never re-judged: it is wrong,
  and the game master can override it.
- **Campaign:** a finished quiz round (last question, or the game master's endGame) keeps its result, and the
  quiz's end records it: counters `quiz.played`, `quiz.won.<character>`, `quiz.correct.<character>`, `node.<id>.finished`,
  totals per character, and the shown question ids appended to `facts.asked` (never asked again).

### Pyramide: a tableau `activity: { kind: 'pyramide', settings: { mode } }`

Two teams of two in the plain lobby with four spots (`team1-clue`, `team1-guess`, `team2-clue`, `team2-guess`): a
round starts when all four are held. The word bank (`data/pyramide/*.json`) stays on the server and is never served.
Rules and the round's state: `shared/pyramide.js`.

```jsonc
{ "t": "config", "patch": { "mode": "duel" } }   // game master, in the lobby: classic | duel
{ "t": "start" }                       // game master, all four spots held: the mode's first words drawn among the bank's
                                       // words minus every word used this evening; too few left → err "refused"
{ "t": "clue", "text": "fromage" }     // the clue giver whose turn it is: one word (letters, hyphens, apostrophes), not
                                       // containing the word, nor contained in it with 4 letters or more (case and
                                       // accents ignored): a brick
{ "t": "guess", "text": "la maison" }  // the guesser whose turn it is, after a clue. The server judges it (equal once case,
                                       // accents, spaces and a leading article are ignored) and only the verdict enters
                                       // the reducer
{ "t": "skip" }                        // classic: a clue giver, before the word's first clue: another word of its level
{ "t": "bid", "n": 4 }                 // duel: the bidding clue giver, 1–10, strictly lower than the last bid
{ "t": "pass" }                        // duel: the bidding clue giver, after the first bid: the last bid plays
```

Anything refused → `err "refused"`. `retire` and a player leaving end the round with the scores so far, like
`endGame` (endReason `retired`, `left`, `gm`).

- **The word in play is in the view:** the round's view is the same for everyone, so every phone and TV receives
  each team's current word (`teams[i].word`); Pyramide's screens show it only on its clue givers' phones. Words
  resolved are in the log with their word.
- **Campaign:** each word drawn, skipped ones too, is reported in the round's `asked` and never drawn again that
  evening. Each player scores their team's words found (classic) or points (duel); ranks are the teams'.

### Backgammon: a tableau `activity: { kind: 'backgammon', settings: { minutes, games } }`

Two to four players play each other on up to two boards, in rounds of games; one round in the plain lobby is the
whole group phase. Rules and the round's state: `shared/backgammon.js`. Points are in each player's own numbering:
1–24, `25` the bar, `0` off.

```jsonc
{ "t": "config", "patch": { "minutes": 12, "games": 3 } }   // game master, in the lobby: minutes 5 | 8 | 12 | 15 | 0 (no
                                       // time limit), games 1 | 3 (best of 3)
{ "t": "start" }                       // game master, 2 to 4 ready players: the first round's games, each with its opening roll
{ "t": "roll" }                        // the player to move, before moving: their dice
{ "t": "move", "from": 13, "to": 8 }   // the player to move: one checker, by one die or several in a row, as the rules allow
{ "t": "undo" }                        // the player to move: takes back the turn's last move
{ "t": "done" }                        // the player to move, once no move is left: the other side's turn
{ "t": "nextRound" }                   // game master, between rounds: the next round, or after the last the podium
```

Anything refused → `err "refused"` (a guest's `nextRound` → `err "not-gm"`). A player who leaves or is taken out
loses their game and every game left; with fewer than two players left the group phase ends (endReason `left`,
`retired`). `endGame` ends it with the standings so far (endReason `gm`).

- **The dice can't be told in advance:** they come from the round's seed and how many have been rolled, and the view
  leaves out both.
- **Campaign:** each player scores their points (a win 1, a gammon 2); ranks follow the standings (points, then the
  points between the players level on points, then the pips their opponents had left).

### Show the join QR again (any player, any moment)

```jsonc
{ "t": "showJoin", "requestId": 1 }   // any JOINED player, any phase: the TVs show the join QR for 15 s.
                                    // The reply gives this phone a token for that particular window.
{ "t": "hideJoin", "requestId": 2, "token": "<token from accepted show>" }
// Closes only that window. A later show replaces its token, so an older invite sheet cannot close it.
// Rate limits: one show AND, separately, one hide per socket per 2 s. Ignored requests from joined
// players receive accepted:false; unknown senders are ignored. EPHEMERAL: never in State or on disk.
```

## Server → client

```jsonc
{ "t": "welcome", "playerId": "p-abc123" }   // to a player client after join or successful rejoin
{ "t": "view", "minigame": { "kind": "blocks", "status": "running", "view": { /* the minigame's view */ },
  "shows": ["p-abc123"], "spots": null, "required": { "eligible": ["pierre", "elodie", "sol", "anna"], "allReady": true } },
  "campaign": { /* CampaignView, see shared/campaign/types.js */ }, "contentVersion": "3f9a1c0b2d4e",
  "online": ["p-abc123"], "now": 1730700000000 }
// "minigame" = the running minigame (shared/minigames.js MinigameView), null while none runs (the hub, a world, a
// scene, the room at a tableau): its "kind", its "status" (lobby | running | podium), its server code's "view" of its
// state, the same for everyone (server/minigames.ts), the players it shows itself ("shows": in the lobby the eligible
// players, during a round those still playing, on the podium the round's players), its spots while its lobby is
// walkable ("spots": [{ id, label, x, y, w, h, holder }], [] without spots, else null; shared/minigames.js Spot), and the tableau's
// content rules for the Start button ("required": its `eligible` and `allReady`, absent ones left out).
// The plain lobby's view: { stage, settings, players: [{ id, character }], ready: [id], round }, with "round" the round
// server's view of the running or finished round (null in the lobby). blocks: the full State (shared/game.js), plus
// "best" in solo games (below); quiz: the public projection (below); Pyramide: its round without the words still
// drawable (below); backgammon: its round without the seed and the rolls (below). In a lobby with spots, "ready" is the spots' holders.
// "campaign" = the whole evening (at.node, at.kind, at.results, party, facts, news, …) WITHOUT the minigame's raw state
// (`at.activity`): that travels only through "minigame"; nor the seed, which each minigame's seed comes from (and with
// it backgammon's dice). The saved campaign keeps both.
// "online" lists party members. "contentVersion": the
// hash served by GET /api/content: re-fetch the content when it changes (content edited + server restarted).
// broadcast to ALL after every change; "now" = server epoch ms (M2 Q4): clients compute
// clock skew = now - Date.now() on receive and render timed-mode countdowns from the view's deadline - (Date.now() + skew)
// "online" (slice 2b): playerIds with a live socket, in seat order. EPHEMERAL: never in State or on
// disk, empty after a server restart until phones reconnect. The view is re-broadcast whenever a
// player socket attaches or closes. Dead sockets are detected by ping/pong within ~10 s.
{ "t": "joinQr", "until": 1730700015000, "now": 1730700000000 }
// SCREENS only, after a showJoin / hideJoin: show the join QR (GET /api/join-qr.svg) until `until` (server
// epoch ms; `now` for the clock skew); until <= now means CLOSE it now. Also sent to a screen that says
// hello while a window is open (nothing after a close or an expiry).
{ "t": "joinQrAck", "action": "show", "requestId": 1, "accepted": true,
  "token": "<window token>", "until": 1730700015000, "now": 1730700000000 }
// REQUESTING PLAYER only: show/hide result. Rejected requests have accepted:false and no token.
// A successful hide has action:"hide", accepted:true, until <= now, and no token.
{ "t": "tick", "now": 1730700000000 }
// liveness (slice 2b): sent to EVERY open socket every 10 s. A client that receives NO message at all
// for 25 s treats its socket as dead (half-open after a silent Wi-Fi drop: no close event, and ping
// frames are invisible to JS), abandons it and reconnects — public/commun/liveness.js. "now" also
// refreshes the clock skew. Old clients ignore it (forward-compatibility rule).
{ "t": "replaced" }
// slice 2b: another socket attached this player's id (reclaim on another device, or a second tab):
// newest socket wins. Sent to the OLD socket, which the server then closes (code 4001). The client
// must NOT auto-reconnect; it shows "Continued on another device" and offers the picker.
{ "t": "unsaved", "data": { "t": "fart", "x": 7.2, "y": 4.5 } }
// to EVERY socket: an unsaved message from the running minigame (its server code's io.send,
// server/minigames.ts), never saved. "data" is the minigame's own object, for its screens, which get
// the whole message; a client with no minigame screen running ignores it. Only while it runs: once the
// game master has ended it, the server drops what the server code still sends. Messages on a socket keep
// their order, so one sent before the minigame ended arrives before the view that ends it.
{ "t": "err", "code": "full" | "bad-place" | "not-gm" | "not-playing" | "unknown-player" | "locked" | "bad-room" | "taken" | "refused" }
// "refused" (slice 3): enter/back not allowed here (locked node, minigame running, one-shot already done)
// The game master's buttons (startMinigame, endMinigame, config, start, lobby, endGame, retire) answer alike in every
// minigame: a guest's → "not-gm", the game master's at the wrong moment → "refused"; "not-gm" also answers anyone
// else's back and gm
// "locked": config refused outside the minigame's lobby
// "bad-room": join refused — wrong or missing room code (phone shows "ask for the code on the TV")
// "taken": join refused — that character is already picked by an active player (M3)
{ "t": "pos", "playerId": "p-abc123", "x": 7.2, "y": 4.5, "dir": "down", "moving": true }
{ "t": "jump", "playerId": "p-abc123" }                      // relayed to screens only; never saved or used for doors
// M3: relayed to SCREEN clients only, with ONE exception: a player gets its OWN pos right after welcome (join or
// rejoin) if it has one, and whenever the server moves its character (the portal; takeSpot; a walkable lobby's
// start positions and holders) — the phone takes its local position from that, else from shared/world.js
// spawnPoint(character). On screen connect the server
// sends one pos per known player: the room's (last position, in-memory only — positions reset
// on restart, so after a restart everyone is back at their spawn point on all clients consistently).
```

**Forward compatibility rule (M3): every client MUST silently ignore messages with an unknown `t`.**

- M1 sends the **full State to everyone** (this game has no secrets); each client derives its own view.
- `role: "screen"` gets no `welcome`, only `view`s (including immediately on connect).
- Rejoin: `hello` with a known `playerId` → server re-attaches the socket, replies `welcome` + `view`. Unknown `playerId` → treated as a fresh client (must `join`). A rejoin also bumps any other live socket of that id (`replaced`).
- The server re-validates every `place`; on refusal it sends `err: "bad-place"` and the client re-renders from the last `view`.

## Solo best scores (M2 Q3)

In solo games the block view gains an optional field: `"minigame": { "kind": "blocks", …, "view": { …, "round": { …, "best": { "score": 4210, "previous": 3980 } } } }` for the current (size, mode) — `previous` is the record before this game, so a client shows "New best!" when its score exceeds it. Absent in multiplayer.

## HTTP API (M2 Q2)

- `GET /api/join` → `{"url":"http://<lan-ip>:<port>/play?room=ABCD","code":"ABCD"}`
- `GET /api/join-qr.svg` → QR of that URL (image/svg+xml, no-store)
- `GET /api/content` → `{ "version": "3f9a1c0b2d4e", "start": …, "chooser": …, "nodes": { … } }`: the active campaign
  content (shared/campaign/types.js `Content`) plus `version`, a short hash of the content computed once at boot,
  also sent as the `ETag` header (application/json, no-store). Clients fetch it on load and again whenever a
  view's `contentVersion` differs from the version they hold (public/commun/content.js); the view carries the
  campaign state, never the content itself.
- `POST /api/client-error` ← `{ "page", "playerId", "message", "source", "stack" }`: an uncaught error, unhandled
  rejection or failed load of a page (public/commun/report-errors.js), kept in memory for the admin page → 204.
  Any page may send it; `playerId` is what the page claims.
- Admins only (`BLOKO_ADMIN_TOKEN`, server/access.ts): `GET /api/admin` → the server's state for the admin page,
  in memory and on disk, the round's raw state included, with its recent events and the pages' errors
  (server/admin.ts); `GET /api/admin/save` → the save file; `/?reset=1` → the reset. Others get 401. Any page
  opened with `?admin=<token>` sets the admin cookie and reloads without it.
