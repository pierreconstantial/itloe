# Bloko — wire protocol (Contract B, FROZEN — English rename applied 2026-11-03)

Transport: WebSocket, JSON text frames. HTTP static + WS share port **3131** (`PORT` env overrides, used by agents to run several mocks). WS path: **`/ws`**.

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
{ "t": "start" }                                            // host only, phase lobby
{ "t": "again" }                                            // host only, phase finished
{ "t": "place", "piece": 0, "x": 3, "y": 5 }                // piece = index 0..2 in own hand; (x,y) = piece origin
{ "t": "config", "patch": { "mode": "timed" } }             // host only, phase lobby/finished (M2 Q4); invalid keys/values ignored
{ "t": "leave" }                                            // lobby/finished: player removed, slot freed; playing: marked done; host passes on
{ "t": "newGame" }                                          // host only, phase finished → back to the LOBBY: players kept (minus left),
                                                            // scores/boards reset, room code kept, newcomers can join again (M3 slice 2)
{ "t": "endGame" }                                          // host only, phase playing → finished: every not-done player is marked
                                                            // done (board frozen, score kept), endReason "host". Refused → err "not-host"
{ "t": "retire", "target": "p-abc123" }                     // host only, phase playing: the target is marked done + retired (board frozen,
                                                            // still ranked, NOT left: keeps seat + character, can reconnect). Everyone
                                                            // done → finished, endReason "stuck". Non-host / not playing → err "not-host";
                                                            // unknown, done or left target → silent no-op. The host may retire themself.
{ "t": "pos", "x": 7.2, "y": 4.5, "dir": "down", "moving": true }
// M3 avatar movement — EPHEMERAL, never enters the reducer State. Client-authoritative:
// the phone integrates its joystick locally and sends throttled updates (≤ 15/s, only when
// something changed). World coordinates: x ∈ [0,16], y ∈ [0,9] (16:9 units, avatar ≈ 1.2 units
// tall); dir ∈ up|down|left|right. Server clamps to bounds, drops malformed or non-joined
// senders silently, and accepts pos in ANY phase (screens decide when to render avatars).
```

Server-internal reducer inputs (`now` on start/again, the `timeUp` action, `deadline`) are NEVER accepted from the wire: the server injects them itself and strips them from client messages.

### Campaign (slice 3, Contract D v2 + A1): the evening around the block game

The server runs the campaign engine (`shared/campaign/`). The party (who is in the evening, their characters,
the host) lives in `campaign.party`; the block game is `campaign.at.activity`, nested in a blocks tableau.
`join` and `leave` act on the EVENING: `join` adds a party member (seated at once in an open block lobby;
mid-game they watch until the next lobby), `leave` leaves the evening (forwarded to a live game: dropped
from a lobby, marked done in a game; the stored id stops rejoining; the host passes on). All block-game
messages above go to the nested game; with no block game there → `err "not-playing"`. Every id is
injected by the server (socket → playerId; screens: `"screen"`), never taken from the wire.

```jsonc
{ "t": "enter", "node": "childhood" }   // host, or the content's chooser (Élodie), into an UNLOCKED child of where
                                        // the party is; refused while a game is played, or on a done one-shot
                                        // tableau → err "refused". Entering a blocks tableau opens its block lobby
                                        // with the whole party seated (host starts).
{ "t": "back" }                         // host only: up one level (tableau → world → hub). Refused while a game is
                                        // played (endGame first) → err "refused"; non-host → err "not-host".
{ "t": "gm", "op": { "op": "unlock", "node": "teens" } }
                                        // host only (game master), ops: goto / unlock / lock / setFlag / count /
                                        // reset-node (shapes: shared/campaign/types.js GmOp). Non-host → err
                                        // "not-host"; a host's no-op is silent.
{ "t": "ack", "upTo": 3 }               // SCREENS only: the TV finished the cutscenes of every news entry with
                                        // seq <= upTo; they leave `campaign.news`. upTo is required. Two TVs, or a
                                        // TV reconnecting mid-cutscene, never drop a cutscene they did not play.
```

- **Doors:** `pos` stays ephemeral, but the server reads it against the current node's doors (`zoneAt`):
  stepping INTO a door (edge, not standing in it) records `zone.entered` for that character, and for the
  content's chooser on an unlocked door applies `enter`. After the party moves, standing where a door
  now is does not fire it: only a fresh step in does.
- **Exactly once:** a block game's playing → finished (stuck, time, host) is recorded as `game.finished` by
  the engine in the SAME step, and the server saves once per step: a kill -9 persists both or neither, so
  a restart on the podium never counts a game twice.

### Quiz (Contract E + addendum E1): a tableau `activity: { kind: 'quiz', settings }`

The bank (`data/quiz/*.json`) stays on the server and is never served. While a quiz runs, `start`, `endGame`,
`newGame` and `config` (host) go to the quiz; block-only messages get `err "not-playing"`.

```jsonc
{ "t": "start" }                       // host, quiz lobby/finished: picks `count` questions among the bank (filtered by the
                                       // settings, minus every question asked this evening); none left → err "refused"
{ "t": "answer", "choice": 2 }         // a choice round: the DISPLAYED index (choices are shuffled per round)
{ "t": "answer", "text": "Victor Hugo" } // a text round. Once per round, before the deadline; else err "refused".
                                       // The server judges it (choice: index; text: local French matcher; 'uncertain' →
                                       // the pluggable judge, 4 s timeout, none for now → wrong) and only the verdict
                                       // enters the reducer. The last answer closes the round at once.
{ "t": "next" }                        // host, on the reveal: next question, or finished after the last
{ "t": "override", "target": "p-abc", "ok": true }   // host, on the reveal: fixes any answer, both ways, re-scoring it
{ "t": "config", "patch": { "count": 10, "seconds": 20, "mode": "mixed" } }  // host, quiz lobby/finished
                                       // (count 3–30, seconds 10–60 step 5, mode choice | text | mixed; also
                                       // categories: string[] | null, level: 1 | 2 | 3 | null)
```

- **Never the answer before the reveal:** during a quiz `view.state` is null (block clients never see a quiz),
  `view.quiz` is the PUBLIC projection (shared/quiz/bank.js `projectQuiz`), and `view.campaign.at.activity`
  carries the same projection. During `question`: the question text, category, level, the displayed choices
  (choice rounds), and `answered` (who answered, never what). From `reveal` on: `answers` (choice/text, ok,
  points) and `answer` `{ choice: displayed index | null, text, anecdote? }`. The anecdote (a bank question's
  optional fun fact) is part of the answer: it often gives it away, so it never travels before the reveal.
- **Scoring:** right = 100 + up to 50 for speed (linear on the time left); wrong or none = 0.
- **Timed fairness:** an open question's deadline shifts on resume and after a suspended laptop, like the timed
  block game. An answer left waiting for the judge when the server stopped is never re-judged: it is wrong,
  and the host can override it.
- **Campaign:** a finished quiz (last question, or the host's endGame) records `quiz.finished` in the same
  step: counters `quiz.played`, `quiz.won.<character>`, `quiz.correct.<character>`, `node.<id>.finished`,
  totals per character, and the shown question ids appended to `facts.asked` (never asked again).

## Server → client

```jsonc
{ "t": "welcome", "playerId": "p-abc123" }   // to a player client after join or successful rejoin
{ "t": "view", "state": { /* full State, see shared/game.js */ }, "campaign": { /* Campaign, see shared/campaign/types.js */ },
  "online": ["p-abc123"], "now": 1730700000000 }
// slice 3: "campaign" = the whole evening (at.node, party, facts, news, …); "state" = campaign.at.activity
// (the block game), null on the hub or in a world. "online" lists party members. "contentVersion": the
// hash served by GET /api/content: re-fetch the content when it changes (content edited + server restarted).
// broadcast to ALL after every change; "now" = server epoch ms (M2 Q4): clients compute
// clock skew = now - Date.now() on receive and render timed-mode countdowns from state.deadline - (Date.now() + skew)
// "online" (slice 2b): playerIds with a live socket, in seat order. EPHEMERAL: never in State or on
// disk, empty after a server restart until phones reconnect. The view is re-broadcast whenever a
// player socket attaches or closes. Dead sockets are detected by ping/pong within ~10 s.
{ "t": "tick", "now": 1730700000000 }
// liveness (slice 2b): sent to EVERY open socket every 10 s. A client that receives NO message at all
// for 25 s treats its socket as dead (half-open after a silent Wi-Fi drop: no close event, and ping
// frames are invisible to JS), abandons it and reconnects — public/commun/liveness.js. "now" also
// refreshes the clock skew. Old clients ignore it (forward-compatibility rule).
{ "t": "replaced" }
// slice 2b: another socket attached this player's id (reclaim on another device, or a second tab):
// newest socket wins. Sent to the OLD socket, which the server then closes (code 4001). The client
// must NOT auto-reconnect; it shows "Continued on another device" and offers the picker.
{ "t": "err", "code": "full" | "bad-place" | "not-host" | "not-playing" | "unknown-player" | "locked" | "bad-room" | "taken" | "refused" }
// "refused" (slice 3): enter/back not allowed here (locked node, game being played, one-shot already done)
// "locked": config refused because a game is in progress
// "bad-room": join refused — wrong or missing room code (phone shows "ask for the code on the TV")
// "taken": join refused — that character is already picked by an active player (M3)
{ "t": "pos", "playerId": "p-abc123", "x": 7.2, "y": 4.5, "dir": "down", "moving": true }
// M3: relayed to SCREEN clients only, with ONE exception: right after welcome (join or rejoin)
// the server sends a player its OWN last pos if it has one — the phone seeds its local position
// from that, else from shared/world.js spawnPoint(character). On screen connect the server sends
// one pos per known player (last position, in-memory only — positions reset on restart, so after
// a restart everyone is back at their spawn point on all clients consistently).
```

**Forward compatibility rule (M3): every client MUST silently ignore messages with an unknown `t`.**

- M1 sends the **full State to everyone** (this game has no secrets); each client derives its own view.
- `role: "screen"` gets no `welcome`, only `view`s (including immediately on connect).
- Rejoin: `hello` with a known `playerId` → server re-attaches the socket, replies `welcome` + `view`. Unknown `playerId` → treated as a fresh client (must `join`). A rejoin also bumps any other live socket of that id (`replaced`).
- The server re-validates every `place`; on refusal it sends `err: "bad-place"` and the client re-renders from the last `view`.

## Solo best scores (M2 Q3)

In solo games the view gains an optional sibling: `{ "t": "view", "state": …, "now": …, "best": { "score": 4210, "previous": 3980 } }` for the current (size, mode) — `previous` is the record before this game, so a client shows "New best!" when its score exceeds it. Absent in multiplayer.

## HTTP API (M2 Q2)

- `GET /api/join` → `{"url":"http://<lan-ip>:<port>/play?room=ABCD","code":"ABCD"}`
- `GET /api/join-qr.svg` → QR of that URL (image/svg+xml, no-store)
- `GET /api/content` → `{ "version": "3f9a1c0b2d4e", "start": …, "chooser": …, "nodes": { … } }`: the active campaign
  content (shared/campaign/types.js `Content`) plus `version`, a short hash of the content computed once at boot,
  also sent as the `ETag` header (application/json, no-store). Clients fetch it on load and again whenever a
  view's `contentVersion` differs from the version they hold (public/commun/content.js); the view carries the
  campaign state, never the content itself.

## Mock server only (`npm run mock`)

`server/mock.ts` implements the above with near-real rules (no `reduce`), plus a debug message for client development:

```jsonc
{ "t": "debug", "scenario": "midgame" | "finished" }
```

- `midgame`: 4 players, half-filled boards, scores/streaks set — for `/screen` layout work.
- `finished`: phase `finished` with ranked scores — for podium work.
