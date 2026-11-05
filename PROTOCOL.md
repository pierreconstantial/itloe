# Itloe — wire protocol (Contract B, FROZEN — English rename applied 2026-11-03)

Transport: WebSocket, JSON text frames. HTTP static + WS share port **3131** (`PORT` env overrides). WS path: **`/ws`**.

Static serving: `public/` at `/` (`/` redirects to `/screen/`), and **`shared/` is served at `/shared/`** so browser clients import the same game logic: `import { canPlace } from '/shared/board.js'`.

Pages: `/screen/` (TV), `/play/` (phones), `/sim/` (dev harness).

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
                                                            // with the EXISTING playerId (+ own pos), same board/score/hand, host stays
                                                            // host. Held by an ONLINE player → err "taken". A left player's character
                                                            // is free (never reclaimable). Needs the room code like any join. Refusal codes
                                                            // unchanged: game under way or roster exhausted → "full", else "taken".
{ "t": "start" }                                            // the round messages: see Campaign, Routing
{ "t": "again" }
{ "t": "place", "piece": 0, "x": 3, "y": 5 }                // piece = index 0..2 in own hand; (x,y) = piece origin
{ "t": "config", "patch": { "mode": "timed" } }             // the tableau's settings (Campaign below); invalid keys/values ignored
{ "t": "leave" }                                            // leaves the evening; a block game: playing → marked done, podium → removed
{ "t": "newGame" }
{ "t": "endGame" }                                          // host, phase playing → finished: every not-done player is marked
                                                            // done (board frozen, score kept), endReason "host"
{ "t": "retire", "target": "p-abc123" }                     // host, phase playing: the target is marked done + retired (board frozen,
                                                            // still ranked, NOT left: keeps seat + character, can reconnect). Everyone
                                                            // done → finished, endReason "stuck". Unknown, done or left target →
                                                            // silent no-op. The host may retire themself.
{ "t": "pos", "x": 7.2, "y": 4.5, "dir": "down", "moving": true }
// M3 avatar movement — EPHEMERAL, never enters the reducer State. Client-authoritative:
// the phone integrates its joystick locally and sends throttled updates (≤ 15/s, only when
// something changed). World coordinates: x ∈ [0,16], y ∈ [0,9] (16:9 units, avatar ≈ 1.2 units
// tall); dir ∈ up|down|left|right. Server clamps to bounds and drops malformed or non-joined
// senders silently. Between rounds, pos moves the player in the room (doors below). During a round
// (until its podium closes), pos belongs to the round's minigame and its game area: kept only from the
// players its server code lets walk (`walks`, server/minigames.ts; blocks and quiz: nobody), else
// dropped silently; no doors. Those positions are the round's own, apart from the room's, and are
// dropped when it ends: the room's positions stay where everyone stood (no longer moving).
{ "t": "say", "text": "Hello!" }                         // joined player; 1–100 printable characters
{ "t": "emote", "kind": "victory" }                      // joined player; victory | fart | annoy
{ "t": "interact", "object": "table" }                    // near the sofa | table | plant in the party room
// Speech and emotes are short lived, server relayed events, limited to one per 650 ms per socket.
// A reconnecting client receives { t: "chatHistory", messages: [...] } with up to 30 recent
// speech events. The history is in memory only and is cleared by a server restart.
// Interaction is available while avatars are visible, between rounds (hub/world, the room at a tableau). The server
// checks the sender's latest position against the closest object and relays an `interact` event
// with playerId, object and at. It is limited to one per 700 ms per socket.
```

Server-internal reducer inputs (`now` on start/again, the `timeUp` action, `deadline`) are NEVER accepted from the wire: the server injects them itself and strips them from client messages.

### Campaign (slice 3, Contract D v2 + A1): the evening around the block game

The server runs the campaign engine (`shared/campaign/`). The party (who is in the evening, their characters,
the host) lives in `campaign.party`; the party's host is the only host (a minigame stores none: the server passes
it with every action, and the round's view carries none); a minigame's round (the block game, a quiz) is `campaign.at.activity`,
nested in its tableau, with its kind in `campaign.at.kind` and the tableau's settings in `campaign.at.settings`
(the content's, then the host's choice until the party leaves the tableau; a round locks them in when it starts).
Between rounds (`campaign.at.activity` null) the party is in the room at the tableau; `campaign.at.kind` names
the tableau's minigame there too (null on the hub, in a world, at a scene).
`join` and `leave` act on the EVENING: `join` adds a party member (during a round they watch, and play the
next round started from the room), `leave` leaves the evening (reported to the round's minigame, which decides
what it means: a block game marks them done; the stored id stops rejoining; the host passes on). Every id is
injected by the server (socket → playerId; screens: `"screen"`), never taken from the wire.

**Routing.** The server handles `hello`, `join`, `leave`, `enter`, `back`, `gm`, `ack`, `pos`, `say`,
`emote`, `interact`, `showJoin`, `hideJoin`, `config` and the round messages itself. `config { patch }` sets
the tableau's settings, from its minigame's schema: host only (else `err "not-host"`), not while a round runs
(`err "locked"`), and not where no minigame is (`err "not-playing"`); a host's no-op patch is silent.

The round messages, the same for every minigame, at a minigame's tableau (elsewhere → `err "not-playing"`):
`start` (from the room: a round with every party member who hasn't left, online or not; the quiz picks its
questions among the bank's candidates, none left → refused), `again` (on the podium: a new round at once with
the round's players who have not left), `newGame` (on the podium: back to the room at the tableau),
`endGame` (a running round → its podium, endReason "host") and `retire { target }` (the minigame decides what
taking a player out means; a minigame without its own rule, like the quiz, takes the player out of the round as
if they had left it: no more answers, the score kept). A guest's round message → `err "not-host"`;
the host's at the wrong moment → `err "refused"`, except a host's `retire` of an unknown, done or left player
while the round runs, which is a silent no-op. Every round starts with a new seed.

Every other message from a party member goes to the running round's minigame (its server code,
`server/minigames.ts`), with the sender's id, the time and the party's host injected; the minigame turns it
into an action or refuses it, and answers a message it does not know with `err "not-playing"`. With no round
running → `err "not-playing"`; from a socket that is not a party member → `err "unknown-player"`. A message
sent just before a round ends may reach the next round.

A minigame's server code may handle a message without changing saved state, and may answer with unsaved
messages (`unsaved` below) during its round.

```jsonc
{ "t": "enter", "node": "childhood" }   // host, or the content's chooser (Élodie), into an UNLOCKED child of where
                                        // the party is; refused while a game is played, or on a done one-shot
                                        // tableau → err "refused". Entering a minigame's tableau: the room there, no round
                                        // with the whole party seated (host starts).
{ "t": "back" }                         // host only: up one level (tableau → world → hub). Refused while a game is
                                        // played (endGame first) → err "refused"; non-host → err "not-host".
{ "t": "gm", "op": { "op": "unlock", "node": "teens" } }
                                        // host only (game master), ops: goto / unlock / lock / setFlag / count /
                                        // reset-node (shapes: shared/campaign/types.js GmOp). Non-host → err
                                        // "not-host"; a host's no-op is silent, except give/take (Contract F:
                                        // { op:'give', item, to, count? } / { op:'take', item, from, count? }):
                                        // unknown item or character, or taking more than held → err "refused"
                                        // (no partial take).
{ "t": "ack", "upTo": 3 }               // SCREENS only: the TV finished the cutscenes of every news entry with
                                        // seq <= upTo; they leave `campaign.news`. upTo is required. Two TVs, or a
                                        // TV reconnecting mid-cutscene, never drop a cutscene they did not play.
```

- **Doors:** `pos` stays ephemeral, but between rounds the server reads it against the current node's doors (`zoneAt`):
  stepping INTO a door (edge, not standing in it) records `zone.entered` for that character, and for the
  content's chooser on an unlocked door applies `enter`. After the party moves, standing where a door
  now is does not fire it: only a fresh step in does.
- **Exactly once:** a block game's playing → finished (stuck, time, host) is recorded as the round's result
  (`round.finished`) by the engine in the SAME step, and the server saves once per step: a kill -9 persists both or neither, so
  a restart on the podium never counts a game twice.

### Birthday opening (`story.elo-50`)

The first match requires Pierre, Élodie, Sol and Anna. After it finishes, `campaign.facts.flags` contains
`portal.ready`; the host sends `{ "t": "newGame" }` to return everyone to the room. A portal is then drawn
in the middle of the room, behind the row where the guests start. Elo walks into it with the ordinary
`pos` message; the server applies the portal transition only for her and queues
`{ "seq": 1, "t": "apparition" }` in `campaign.news`. The other phones
continue to show the room. The screen plays the apparition and sends the ordinary `ack` when it ends.
That acknowledgement adds `apparition.seen` to the persisted facts and reveals the key.

```jsonc
{ "t": "interact", "object": "memory-key-intro" }  // Elo, near the key after the apparition
{ "t": "enter", "node": "hub.door4" }          // normally triggered by Elo walking into door #4
{ "t": "back" }                               // Elo returns from the second room to the apartment
```

The key is stored in `campaign.facts.inventory.elodie`, and door #4 unlocks from that fact. The six
memory-world entrances and reunion mini-games are not wired yet; their story specification is in
`GameStory.md`.

### Quiz (Contract E + addendum E1): a tableau `activity: { kind: 'quiz', settings }`

The bank (`data/quiz/*.json`) stays on the server and is never served. While a quiz runs, its messages
below go to the quiz (Routing above); block-only messages (`place`) get `err "not-playing"`, and `retire`
marks the target `left` in the running quiz (the round stops waiting for their answer).

```jsonc
{ "t": "start" }                       // host, in the room: picks `count` questions among the bank (filtered by the
                                       // settings, minus every question asked this evening); none left → err "refused"
{ "t": "again" }                       // host, quiz finished: a new quiz at once, same players minus those who left,
                                       // questions picked as for start
{ "t": "newGame" }                     // host, quiz finished → back to the room at the tableau
{ "t": "answer", "choice": 2 }         // a choice round: the DISPLAYED index (choices are shuffled per round)
{ "t": "answer", "text": "Victor Hugo" } // a text round. Once per round, before the deadline; else err "refused".
                                       // The server judges it (choice: index; text: local French matcher; 'uncertain' →
                                       // the pluggable judge, 4 s timeout, none for now → wrong) and only the verdict
                                       // enters the reducer. The last answer closes the round at once.
{ "t": "next" }                        // host, on the reveal: next question, or finished after the last
{ "t": "override", "target": "p-abc", "ok": true }   // host, on the reveal: fixes any answer, both ways, re-scoring it
{ "t": "config", "patch": { "count": 10, "seconds": 20, "mode": "mixed" } }  // the tableau's settings (Routing)
                                       // (count 3–30, seconds 10–60 step 5, mode choice | text | mixed; also
                                       // categories: string[] | null, level: 1 | 2 | 3 | null)
```

- **Never the answer before the reveal:** during a quiz the round's view is the PUBLIC projection
  (shared/quiz/bank.js `projectQuiz`), and the campaign on the wire carries no round state. During
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
  and the host can override it.
- **Campaign:** a finished quiz (last question, or the host's endGame) records its result in the same
  step: counters `quiz.played`, `quiz.won.<character>`, `quiz.correct.<character>`, `node.<id>.finished`,
  totals per character, and the shown question ids appended to `facts.asked` (never asked again).

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
{ "t": "view", "round": { "kind": "blocks", "status": "running", "view": { /* the minigame's view */ } },
  "campaign": { /* CampaignView, see shared/campaign/types.js */ }, "contentVersion": "3f9a1c0b2d4e",
  "online": ["p-abc123"], "now": 1730700000000 }
// "round" = the running round (shared/minigames.js RoundView), null between rounds (the hub, a world, a
// scene, the room at a tableau): its minigame "kind", its "status" (running | finished: the podium) and its minigame's
// "view" of its state, the same for everyone (server/minigames.ts). blocks: the full State (shared/game.js),
// plus "best" in solo games (below); quiz: the public projection (below).
// "campaign" = the whole evening (at.node, at.kind, at.settings, party, facts, news, …) WITHOUT the round's raw state
// (`at.activity`): that travels only through "round". The saved campaign keeps it.
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
// to EVERY socket: an unsaved message from the running round's minigame (its server code's io.send,
// server/minigames.ts), never saved. "data" is the minigame's own object, for its running screens, which get
// the whole message; a client with no minigame screen running ignores it. Only during its round: once the
// round has ended (its podium closed, or Play again replaced it), the server drops what the server code
// still sends. Messages on a socket keep their order, so one sent before the round ended arrives before
// the view that ends it.
{ "t": "err", "code": "full" | "bad-place" | "not-host" | "not-playing" | "unknown-player" | "locked" | "bad-room" | "taken" | "refused" }
// "refused" (slice 3): enter/back not allowed here (locked node, game being played, one-shot already done)
// Round buttons (start, again, newGame, endGame, retire) answer alike in every minigame: a guest's →
// "not-host", the host's at the wrong moment → "refused"
// "locked": config refused because a game is in progress
// "bad-room": join refused — wrong or missing room code (phone shows "ask for the code on the TV")
// "taken": join refused — that character is already picked by an active player (M3)
{ "t": "pos", "playerId": "p-abc123", "x": 7.2, "y": 4.5, "dir": "down", "moving": true }
// M3: relayed to SCREEN clients only, with ONE exception: right after welcome (join or rejoin)
// the server sends a player its OWN last pos in the room if it has one — the phone seeds its local
// position from that, else from shared/world.js spawnPoint(character); a minigame's phone screen picks
// its own start in its game area. On screen connect the server sends one pos per known player: the
// round's positions during a round, else the room's (last position, in-memory only — positions reset
// on restart, so after a restart everyone is back at their spawn point on all clients consistently).
// When a round ends, every screen gets the room's positions again, before the view that ends it.
```

**Forward compatibility rule (M3): every client MUST silently ignore messages with an unknown `t`.**

- M1 sends the **full State to everyone** (this game has no secrets); each client derives its own view.
- `role: "screen"` gets no `welcome`, only `view`s (including immediately on connect).
- Rejoin: `hello` with a known `playerId` → server re-attaches the socket, replies `welcome` + `view`. Unknown `playerId` → treated as a fresh client (must `join`). A rejoin also bumps any other live socket of that id (`replaced`).
- The server re-validates every `place`; on refusal it sends `err: "bad-place"` and the client re-renders from the last `view`.

## Solo best scores (M2 Q3)

In solo games the block view gains an optional field: `"round": { "kind": "blocks", …, "view": { …, "best": { "score": 4210, "previous": 3980 } } }` for the current (size, mode) — `previous` is the record before this game, so a client shows "New best!" when its score exceeds it. Absent in multiplayer.

## HTTP API (M2 Q2)

- `GET /api/join` → `{"url":"http://<lan-ip>:<port>/play?room=ABCD","code":"ABCD"}`
- `GET /api/join-qr.svg` → QR of that URL (image/svg+xml, no-store)
- `GET /api/content` → `{ "version": "3f9a1c0b2d4e", "start": …, "chooser": …, "nodes": { … } }`: the active campaign
  content (shared/campaign/types.js `Content`) plus `version`, a short hash of the content computed once at boot,
  also sent as the `ETag` header (application/json, no-store). Clients fetch it on load and again whenever a
  view's `contentVersion` differs from the version they hold (public/commun/content.js); the view carries the
  campaign state, never the content itself.
