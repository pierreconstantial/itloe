# Itloe — Build plan (multi-agent)

Goal: a **minimal playable version as fast as possible** (M1), then iterate (M2+).
Strategy: the **main CLI session is the orchestrator**. It does the short **contracts phase** (P0) itself, then spawns **4 subagents in parallel** on disjoint files (P1–P4), reviews their work, and does the **integration pass** (P5). M2 work packages are parallel subagents again.

Spec: `SPEC-BLOCKS.md`. Where this plan and the spec disagree for M1, **this plan wins** (M1 cuts scope on purpose).

---

## M1 — minimal playable game

### M1 scope (cuts are deliberate)

**In:** join by typed URL + room-less (one game per server), name entry, lobby, host starts, 1–4 players, 8×8 board, full piece set, shared seeded hand sequence, drag-to-place with local ghost, server-authoritative placement/clears/score/streak, stuck detection, podium, "Play again", silent auto-rejoin after phone sleep (localStorage id).

**Out (M2+):** QR code, room code, LAN interface picker, persistence to disk, settings UI, timed mode, sounds, animations beyond a basic clear flash, danger indicator, best scores, colour picker (colours auto-assigned), copy-polish pass (plain English labels are enough in M1).

### Phases

| Phase | Who | What |
|---|---|---|
| P0 Contracts & scaffold | orchestrator | Everything below in «Contracts», as real files; repo scaffold; mock server |
| P1–P4 | 4 subagents in parallel | Work packages below, disjoint file ownership |
| P5 Integration | orchestrator | Review P1–P4, wire it, `/sim` harness, e2e smoke, fix seams |

After P0, **contracts are frozen**: any change must be agreed in the main session and announced to all agents.

---

## P0 — Contracts & scaffold (do first, fast)

**Owns:** repo root, `PROTOCOL.md`, `shared/` *stubs*, `server/mock.ts`, `public/` skeletons.

Deliverables:

1. `package.json` (ESM, `typescript` + `@types/node` + `ws`, scripts: `start` = `node server/main.ts`, `mock` = `node server/mock.ts`, `check` = `tsc`, `test` = `node --test`), `tsconfig.json` (type-check only, `checkJs: true` so `shared/*.js` JSDoc is checked), `.gitignore`, `git init`.
2. Directory layout (empty files with TODO headers where needed):
   ```
   server/   main.ts  mock.ts
   shared/   rng.js  pieces.js  board.js  game.js
   public/   play/index.html  screen/index.html  sim/index.html  commun/base.css
   ```
3. `shared/` files containing the **full JSDoc-typed signatures** from «Contract A» below, with naive-or-throwing bodies (P1 replaces bodies, never signatures).
4. `PROTOCOL.md` = «Contract B» below, verbatim + any clarifications.
5. **`server/mock.ts`**: serves `public/`, accepts WS, replies to any `join` with a canned mid-game `view` (2 players, half-filled boards, hands set) and echoes `place` by toggling cells without rules. Purpose: P3/P4 develop against it from minute one.

### Contract A — `shared/` API (plain ESM `.js` + JSDoc, runs in browser and Node)

```js
// rng.js
export function mulberry32(seed) {} // → () => float [0,1)

// pieces.js
// PieceId = string. Piece = { id, cells: [x,y][], w: number (weight) }
export const PIECES = {};            // Record<PieceId, Piece> — full 29-piece set from SPEC §5.2
export function handAt(seed, n) {}   // → [PieceId, PieceId, PieceId] — deterministic n-th hand

// board.js
// Board = (0 | colorIndex)[] of size*size, row-major. Empty = 0.
export function emptyBoard(size) {}
export function canPlace(board, size, cells, x, y) {}      // → boolean
export function place(board, size, cells, x, y, color) {}  // → new Board (pure)
export function findClears(board, size) {}                 // → { rows: number[], cols: number[] }
export function applyClears(board, size, clears) {}        // → new Board
export function anyFit(board, size, hand) {}               // hand: (PieceId|null)[] → boolean

// game.js
// State = {
//   phase: 'lobby'|'playing'|'finished', seed, size,
//   hostId, order: string[],
//   players: Record<string, { id, name, color,          // color: 1..4
//     board: Board, handIndex, hand: (PieceId|null)[],   // null = already placed
//     score, streak, graceLeft, done }>
// }
// Action = { t:'join', id, name } | { t:'start', id } | { t:'again', id }
//        | { t:'place', id, piece: 0|1|2, x, y }
export function initState(seed) {}
export function reduce(state, action) {}  // → new State; invalid action → same state (reference-equal)
export function placementScore(cells, lines, streak, boardEmptied) {}
//   = cells + 10*lines*lines*(1+streak) + (boardEmptied ? 300 : 0)
```

Reducer rules (normative): join only in lobby, max 4, first = host; start only by host, ≥1 player; place only in playing, by a non-done player, piece non-null, `canPlace` true → place, clear, score, streak (grace 1: first non-clearing placement keeps streak, second resets), refill hand via `handAt(seed, ++handIndex)` when all 3 null, then if `!anyFit` → `done = true`; all done → `phase = 'finished'`; again only by host in finished → fresh boards/scores, **new seed**, same players, straight to playing.

### Contract B — wire protocol (`PROTOCOL.md`)

WebSocket, JSON text frames. Server: HTTP static on **:3131** + WS on same port, path `/ws`.

Client → server:
```json
{ "t": "hello", "role": "player", "playerId": "p-abc123" }   // playerId optional (rejoin)
{ "t": "hello", "role": "screen" }
{ "t": "join",  "name": "Léa" }        // after hello; server assigns/reuses id
{ "t": "start" } { "t": "again" }
{ "t": "place", "piece": 0, "x": 3, "y": 5 }
```

Server → client:
```json
{ "t": "welcome", "playerId": "p-abc123" }   // to player after hello/join
{ "t": "view", "state": { …full State… } }   // broadcast to ALL clients after every change
{ "t": "err", "code": "full" | "bad-place" | "not-host" | "not-playing" }
```

**M1 sends the full `State` to everyone** (no secrets in this game); clients derive their own view. `role:'screen'` gets no `welcome`, just `view`s. Rejoin = `hello` with a known `playerId` → server re-attaches, sends `welcome` + `view`.

---

## P1 — Shared game logic (agent 1)

**Owns:** `shared/*` bodies, `test/shared.test.js`. **Must not touch** signatures, server, public.

- Implement everything in Contract A; `PIECES` per SPEC §5.2 (weights: eyeball something reasonable, tuning is M2).
- `node --test` tests: canPlace bounds/overlap; cross clear (row+col same placement, intersection counted once); scoring table incl. streak ×(1+streak), grace, plateau net; refill at the right moment; stuck → done; all done → finished; determinism: same seed → identical hands, two players same hands; invalid actions return the same state object.
- Done when: `npm test` and `npm run check` pass.

## P2 — Server (agent 2)

**Owns:** `server/main.ts` (and any `server/*.ts` it adds). **Must not touch** shared bodies or public.

- HTTP: serve `public/` (hand-rolled static handler, no dep); `/` → redirect `/screen/`, `/play`, `/sim`.
- WS (`ws` pkg): implement Contract B exactly over `shared/game.js` `reduce`. One game in memory, `seed = Date.now()`.
- Rejoin: map `playerId → socket`, replace old socket on re-hello.
- On start: print LAN URL (`os.networkInterfaces()`, first external IPv4) for phones.
- Done when: starts clean, two `wscat`/node-client sessions can join, start, place, finish (can be tested against P1 stubs early + real shared at integration).

## P3 — Phone client `/play` (agent 3)

**Owns:** `public/play/*`, may add `public/commun/play-*.css`. **Develops against `npm run mock`.**

- Screens: name entry → lobby (players list, host sees "Start") → game → done → podium (+ host "Play again").
- Game: top bar (score, rank, opponents' scores small), own board ~60% height (CSS grid), 3-piece tray.
- **Drag:** pointer events; piece renders offset ~1.5 cells above finger; grid-snapped ghost, green/red via `shared/board.js canPlace`; preview of lines that would clear; drop sends `place`, release elsewhere cancels. Render strictly from last `view` — optimistic paint allowed but must reconcile.
- localStorage: `playerId`, `name`; auto re-hello on WS close (retry 1 s).
- Done when: full flow works against the mock, drag feels right on a real phone (test at 390 px), `npm run check` passes.

## P4 — Big screen `/screen` (agent 4)

**Owns:** `public/screen/*`, may add `public/commun/screen-*.css`. **Develops against `npm run mock`.**

- Lobby: join URL huge (`http://<ip>:3131/play` — read from `location`), player slots live.
- Game: boards laid out 1 / 2 / 2×2 by player count; per board: name+colour, animated score, hand preview, streak flame, leader crown, "Done" overlay; basic clear flash (CSS) on lines that disappeared between views (diff old/new state).
- Podium: ranking, champion highlighted; basic only, juice is M2.
- Dark, 1080p-at-3m legible. Done when: renders all phases correctly from mock views at 1/2/3/4 players.

## P5 — Integration (agent 5, after P1–P4)

**Owns:** `public/sim/*`, small cross-cutting fixes anywhere (announce them).

- `/sim`: `/screen` + 4 `/play` iframes in one page.
- Replace mock with real server; run a full 2-player game in `/sim`; fix protocol/rendering seams; verify phone-sleep rejoin (kill a socket mid-game); `npm run check` + `npm test` green.
- Tag the repo state `m1` (git tag). **M1 done = a real game is playable on a TV + 2 phones.**

---

## M2 — iterate (parallel packages, order by value)

| Pkg | What | Owns |
|---|---|---|
| Q1 Juice | Clear/combo animations, screen-shake, call-outs ("Combo ×3!", "Clean board!"), sounds on `/screen` (autoplay unlocked on start click), podium sequence, danger pulse | `public/screen` |
| Q2 Onboarding | `qrcode` lib QR on `/screen` lobby + `qrcode-terminal`, room code, LAN interface picker, "Invite" menu on phone | `server`, both clients' lobby |
| Q3 Robustness | State persisted to disk after each action, resume on restart, settings file, solo best scores | `server`, `shared` |
| Q4 Options | Settings UI (host phone): board size, timed mode + timer, simple piece set, grace; colour picker | `shared/game.js`, `public/play` |
| Q5 Feel | Phone haptics, piece-weight tuning from playtests, copy polish pass, rules screen | `shared/pieces.js`, `public/play` |
| Q6 Cleanup | Promote the duplicated piece-shape renderer + colour dot into a public/commun module used by both clients (deferred from P5 to avoid blind refactors at the finish line) | `public/commun`, both clients |

Playtest after Q1/Q2 — tuning questions in SPEC §13 get answered there, then Q5.

---

## M3 — Birthday party shell (REFRAME, 2026-11-04)

The whole project is the centerpiece of a birthday: the host runs an evening of **story steps**; the
block game is ONE step, replayed several times. Guests play as **Zelda-style pixel characters** whose
avatars walk around on the TV. The full flow and the step screens will be specified later by the user —
**slice 1 builds only the base**: character pick at join + avatars movable on the TV lobby.

### Contract C — characters & movement (frozen like A/B; changes through the orchestrator)

Amendment (2026-11-06, agreed for `small-improvements`): the live roster is Pierre, Élodie,
Sol, Anna, Nico, and Konz, with unique colour slots 1–6. An incarnated player may send
`{ t: 'jump' }` between rounds. The server binds the sender's identity and relays
`{ t: 'jump', playerId }` to screens only; it is an ephemeral visual hop that does not move
the feet, enter doors, or affect saved state. After ten seconds without movement, speech,
emotes, or a jump, the TV plays that character's idle scene until the next activity.

Amendment (2026-11-07, agreed with Pierre): Mathieu is phone-selectable, with colour slot 7 and the
same story wisp/incarnation rules as Nico (`person.mathieu.unlocked`). The live roster has seven
characters. Room spawns span x = 2 through x = 14 evenly across the roster at y = 7.6. Minigame
lobby layouts are unchanged at Pierre's request.

Amendment (2026-11-07, agreed with Pierre): Johanna is phone-selectable, with colour slot 8 and the same
story wisp/incarnation rules (`person.johanna.unlocked`). The live roster has eight characters.

```js
// shared/characters.js (P1)
// CharacterId = 'pierre' | 'elodie' | 'sol' | 'anna' | 'nico' | 'konz' | 'mathieu' | 'johanna'
// Character = { id, name, color }   // color 1..8 — the character IS the colour slot
export const CHARACTERS = {};        // Record<CharacterId, Character>, insertion order = display order
export function freeCharacters(state) {}  // → CharacterId[] not picked by any non-left player

// shared/game.js (P1) — Player gains `character: CharacterId`; join becomes
// { t:'join', id, character } : valid only if the character exists and is free; name and
// color copy from CHARACTERS. Old saved states without `character` stay loadable.

// shared/world.js (P1) — single source for movement geometry (server clamps with it,
// phone integrates with it, TV spawns/interpolates with it)
export const WORLD = { w: 16, h: 9 };        // world units, 16:9
export const WALK_SPEED = 4;                 // units/s
export function spawnPoint(characterId) {}   // → { x, y, dir } deterministic per character:
                                             //    x = 2 + 12·(color−1)/(ROSTER_SIZE−1), y = 7.6, dir 'down'

// shared/sprites.js (P4 — ownership exception inside shared/)
// 16×16 indexed-palette pixel grids, per character: 4 directions × 3 walk frames + 1 idle
// (user 2026-11-04: "smoother" — was 2 walk frames; clients animate by cycling WALK_FRAMES at 8 fps).
export const SPRITES = {};  // Record<CharacterId, SpriteSheet>
export const WALK_FRAMES = [1, 2, 3, 2];  // one stride: contact A, passing, contact B, passing — cycle these, never hardcode
export const WALK_FPS = 8;                // shared flip rate — clients animate WALK_FRAMES at this rate
export function drawSprite(ctx, characterId, dir, frame, x, y, scale) {}  // canvas 2d, crisp pixels
```

Movement is **ephemeral** (wire `pos`, see PROTOCOL.md): client-authoritative, relayed by the server
to screens, held in server memory only — it never touches the reducer, persistence or tests.

### Slice 1 assignments

| Who | What |
|---|---|
| P1 | `shared/characters.js`, join-by-character in the reducer (+ `taken` semantics), `Player.character`, tests updated |
| P2 | `pos` relay (validate/clamp, joined players only, screens only), pos snapshot on screen connect, forward `taken` |
| P3 | Phone: character picker replaces name entry (sprites via `drawSprite`, taken ones greyed live from state), virtual joystick on the phone lobby, local movement integration (speed ~4 units/s, clamp to world), throttled `pos` |
| P4 | `shared/sprites.js` FIRST (P3 depends on it; coloured-rectangle stub until it lands), then TV lobby becomes the party room: ground, avatars at positions, name labels, walk animation from dir/moving, interpolation between updates |

Character designs (recognisable, 16×16): Pierre, Élodie (the birthday star — give her something festive),
Sol (taller teen), Anna (14, K-pop style). Keep the QR/room-code lobby elements — avatars share the scene.

### Slice 2 — bulletproof sessions (user feedback from the first live playtest, 2026-11-04)

The user lost their phone session at the podium while looking for a way back to the room, and the
podium's only exit was "Play again". Directives: "That's need to be super ultra solid" and "save
always the state on the laptop, so that it can pause, resume without needing to restart everything.
It must be super safe." Slice 2 makes session continuity unbreakable:

| Who | What |
|---|---|
| P1 | `{ t:'newGame', id }` reducer action: host only, finished → lobby; players kept (minus left) with fresh boards/scores via newPlayer (character/name/colour kept), deadline/endReason cleared, new derived seed; tests |
| P2 | Wire `newGame` (err not-host); timed-pause fairness: persist `savedAt` in the envelope and shift a live `deadline` by the downtime on load, so a killed/resumed timed game keeps its REMAINING time instead of expiring while the laptop was closed; e2e: newGame flow + kill -9 resume in every phase incl. the shifted deadline |
| P3 | Phone session is NEVER losable. Acceptance (each must pass): reload; browser back then forward; back to the join URL (QR re-scan) with a live session → silent resume, no picker; bfcache restore (pageshow); phone locked 5 min mid-game → unlock resumes; WS drop → auto-reconnect with banner, never dumped to a menu. Picker appears ONLY when the server does not know the stored id; then it preselects the stored character ("Continue as Élodie") when that character is free. Podium: host gets BOTH "Play again" and "Back to the room" (newGame); guests see which was chosen |
| P4 | TV: verify lobby re-entry after newGame (party room back, avatars resume, newcomers join); TV auto-reconnect after a server restart mid-game (banner → re-hello → same boards); cross-check P3's acceptance list from the TV side |

### Slice 2b — the character IS the identity (user decision, 2026-11-04)

The evening is one long **campaign** that people join, leave and rejoin, with the server stopped and
restarted along the way. A browser-stored id alone loses people: another browser, a private tab, cleared
data, or a dead battery (Élodie borrows Sol's phone). The user chose **"tap your character"**: any device
can take back a character whose phone is offline.

- **Presence** (ephemeral like `pos`, never in State or on disk): `view` gains `online: string[]`, the
  playerIds with a live socket. The server re-broadcasts the view whenever a player socket attaches or
  closes, so every client sees who is online.
- **Reclaim**: `join` with a character held by an OFFLINE non-left player → the server attaches the
  socket to THAT player (no reducer change) and replies `welcome` with the existing playerId. The phone
  stores it and resumes with the same board, score and hand. Held by an ONLINE player → `err taken`, as before.
- **Bump**: if the old device comes back with its stored id after a reclaim (or the same id is opened in a
  second tab), the newest socket wins and the old one gets `{ t:'replaced' }` and stops reconnecting.
  The phone shows "Continued on another device", with a button that brings back the picker.
- **Picker**: free characters are pickable; offline-held ones show "Continue as Élodie" (same sprite,
  normal colour); online-held ones are greyed. The phone's stored character is preselected when pickable.
- **The host follows its character**: a host who reclaims on a new phone is still host. A host is never
  lost because a phone died.

| Who | What |
|---|---|
| P1 (server) | presence in `view` + broadcasts on attach/close, reclaim in `join`, `replaced` + newest-socket-wins, PROTOCOL.md lines, e2e (reclaim mid-game keeps the board, bump, two tabs, host reclaim) |
| P2 (phone) | picker states (free / continue / taken), `replaced` screen, never auto-reconnect after `replaced`, acceptance pass on a second "device" (a fresh browser context) |

### Contract D v2 — campaign: hub, worlds, unlocks (FROZEN 2026-11-04, user approved; changes through the orchestrator)

**Superseded by Contract D v3 (2026-11-07, agreed with Pierre): [docs/story-engine.md](docs/story-engine.md).** The story
is data (`shared/campaign/story/`): story machines replace the `portal` and `collect` actions and every `storyId`
branch; nodes, facts and `settle` below still hold, with the additions listed there. Read v3 first; what follows is
the history of v2.

Amendment (2026-11-06, agreed for `small-improvements`): the game master can send
`gm { op: 'wisp', character, on }` for any joined character, including during a round.
Switching Wisp Mode on removes that character from the current round; switching it off
uses the existing three-second incarnation, and the character joins the next round.

**The story (user, 2026-11-04).** It starts as a false start: just the 4-player block game. Then the game
turns into Élo's life. A central **hub** (menu map) opens onto **worlds**, one per period of her life
(childhood, teens, late teens / becoming adult, young adult in Vienna, Pierre…, more to come). Each world
holds **tableaux** (scenes, games, quizzes, secrets). Worlds and tableaux **unlock progressively**:
several at once, in any order Élodie likes, **triggered by actions** (e.g. "after playing the block game
3 times, Élodie gets a reward and a new region opens"). Pierre is the game master and can override anything.
Story content lives in data files and stays private to the repo.

**Design: a pure rule engine over facts.** No hand-written transitions. Content is a graph of nodes
whose unlock conditions are DATA. Activities report **events**, events update **facts**, and a pure `settle`
recomputes what is unlocked until nothing changes (fixpoint), so chains and simultaneous unlocks come
for free. The live game state stays a separate State machine (the block game as today), nested in the
campaign as the current activity.

```js
// shared/campaign/ (pure, JSDoc, no I/O — runs in Node and browsers like shared/game.js)

// ---- content (data, edited by the user between sessions; ids are STABLE, titles free) ----
// Node = {
//   id: 'childhood' | 'childhood.ballet' | …,  // dotted: parent.child
//   kind: 'hub' | 'world' | 'tableau',
//   parent: id | null,
//   title, intro?,                              // copy shown on the TV
//   activity?: { kind: 'blocks', settings? } | { kind: 'quiz', quizId } | { kind: 'scene', sceneId } | …,
//   unlock: Condition,                          // when the node becomes available ({ always: true } = from the start)
//   complete?: Condition,                       // when it counts as done (default: its activity finished once)
//   rewards?: Effect[],                         // applied ONCE, the first time the node completes
//   replayable?: boolean,                       // games: yes; one-shot reveals: no
//   room?: roomId,                              // the room the TV draws here (ROOMS in shared/scene.js); default: the party room
// }
// Condition (data, evaluated by holds(cond, facts)):
//   { always: true } | { flag: 'x' } | { done: nodeId } | { unlocked: nodeId }
//   | { count: 'blocks.played', gte: 3 }                 // counters, see Facts
//   | { all: Condition[] } | { any: Condition[] } | { not: Condition }
// Effect (data): { flag: 'x' } | { item: 'ballet-shoes' } | { unlock: nodeId }   // { unlock } = forced, beyond conditions
export const CONTENT = {};   // Record<nodeId, Node>, built from small per-world files

// ---- facts (persisted, keyed by STABLE ids and characters, never playerIds) ----
// Facts = {
//   counters: Record<string, number>,  // 'blocks.played', 'blocks.won.elodie', 'quiz.childhood.correct', …
//   flags: string[],                   // arbitrary story facts: 'met-christel', 'false-start-over', …
//   items: string[],                   // Élodie's rewards, shown on the hub
//   unlocked: string[], done: string[],// derived by settle, stored so the TV can diff "NEW!" and so
//   seen: string[],                    //   content edits can never RE-LOCK what guests already saw
//   totals: Record<CharacterId, number>// points across the whole evening
// }

// ---- campaign state machine (the reducer the server persists) ----
// Campaign = {
//   v: 1,
//   at: { node: nodeId, activity: State | null },  // where the party is now; activity = the live game
//   facts: Facts,
//   news: Unlock[],   // unlocks not yet celebrated on the TV (cutscene queue), drained by 'ack'
// }
// Phases follow `at.node`'s kind: hub (TV map; avatars walk it; a world door is chosen by Élodie
// walking into it or by the host) → world (its tableaux) → tableau (runs its activity) → back up.
export function reduceCampaign(campaign, action, content) {}
// actions:
//   { t:'enter', id, node }             // Élodie or the host: an UNLOCKED node of the current hub/world
//   { t:'back', id }                    // up one level (host, or Élodie outside a running game)
//   { t:'activity', action }            // forwarded to the nested game reducer (place, start, again…)
//   { t:'event', event }                // server-internal: an activity finished or something happened →
//                                       //   record(facts, event) then settle(facts, content)
//   { t:'ack', id }                     // TV finished the unlock cutscene(s) → drop them from news
//   { t:'gm', id, op }                  // HOST ONLY (game master): goto / unlock / lock / setFlag /
//                                       //   count / reset-node; for live fixes ("skip that", "redo it")
export function record(facts, event) {}      // pure: event → counters/flags/totals
export function settle(facts, content) {}    // pure fixpoint: → { facts, news }; never removes an unlock
export function holds(condition, facts) {}   // pure

// Event (what activities report, data):
//   { t:'game.finished', kind:'blocks', ranking: [{ character, score, rank }], mode, size }
//   { t:'quiz.answered', quizId, character, correct }
//   { t:'scene.seen', sceneId }   { t:'zone.entered', zone, character }   // walking into a spot on the TV
```

Rules that keep the evening safe:
- **Monotonic:** `settle` only adds unlocks and done marks. Only the host's `gm lock` takes anything back.
- **Content-tolerant:** on load, unknown node ids in facts are ignored and `settle` re-runs, so the user can
  add or edit worlds between sessions without breaking a saved evening.
- **Facts hang on characters:** a reclaimed or replaced phone keeps everything (slice 2b).
- **One persisted envelope** `{ v, campaign, room, savedAt }`, written atomically after every action and
  resumed in every phase. Today's block `State` becomes `campaign.at.activity`. Migration: a saved bare
  State loads as the hub's false-start blocks tableau.
- **Server-only inputs stay server-only:** an `activity` action is rebuilt field by field by the server;
  `now`, `deadline` and `timeUp` are never taken from the wire.
- **Timed-pause fairness follows the move:** `shiftDeadline` and the heartbeat apply to `campaign.at.activity`,
  and the envelope keeps `savedAt`.
- **Acks name what they acknowledge:** news entries carry an increasing `seq`, and `{ t:'ack', id, upTo: seq }`
  drops only the entries up to it. Then two open TVs, or a TV reconnecting mid-cutscene, never lose a cutscene.
- **Wire:** `view` carries `campaign` (TV and phones derive their screens from it), `news` drives the TV
  reward and unlock cutscenes, and the phone host panel sends `gm` ops.

**Contract D addendum A1 (orchestrator, 2026-11-04, from P2's pre-coding questions):**
1. **Party roster in the campaign:** `campaign.party = { order, players: { [id]: { id, character, name, color, left } }, hostId }`,
   owned by `reduceCampaign`. `join` (incl. the server's reclaim), `leave` (leave the evening: `left` = true,
   also forwarded to a live activity) and host passing are campaign actions. Presence, `pos`, host checks and
   doors all read the party. An activity's own players are seeded from the party.
2. **Blocks lifecycle:** `enter` on a blocks tableau creates its State in the block **lobby**, seeded with every
   non-left party member, with the node's `settings`. The host can configure, then `start`. A party member who
   joins while that block lobby is open is added to it too; one who joins mid-game watches until the next game.
   `again` (rematch) and `newGame` (back to the block lobby) keep their meaning inside the tableau. `back`
   leaves the tableau: host only, refused while playing (use `endGame` first).
3. **Ack:** accepted only from `role:'screen'` sockets; the server injects `id: 'screen'`; `upTo` is required.
4. **`game.finished` exactly once, from the ENGINE:** `reduceCampaign` derives it itself when a nested
   activity moves playing → finished (any cause: stuck, time, host), recording and settling in the same step.
   A single pure step plus one atomic save means a kill -9 persists both or neither. The event carries
   `endReason`; a host-ended game counts as played. The server emits only external events (`zone.entered`).
5. **Versions:** the envelope is `v:2`, independent of `campaign.v:1`. `bestPrevious` carries over as envelope
   metadata.
6. **Doors:** door rectangles are content data (`node.door = { x, y, w, h }` on the hub/world's children).
   A pure `zoneAt(content, nodeId, x, y)` lives in shared/campaign. On a `pos` from the content's `chooser`
   character (sample: 'elodie'), the server applies `enter` when it goes from outside to INSIDE an unlocked
   door (edge-triggered). The host can always `enter` directly.
7. **Wire compat:** `view` keeps `state` (= `campaign.at.activity`, possibly null) next to `campaign` while the
   clients migrate. A NEW campaign starts AT the false-start blocks tableau (the story begins as just a
   block game), so today's clients keep working until the hub is first entered.
8. **GM ops:** shapes are defined by the engine; the server only checks host and forwards.

**Slice 3 assignments (approved 2026-11-04). World entry: Élodie walks into a door, the host can override. Copy language is data: the user writes the real story text, placeholders are English.** P1 builds `shared/campaign/` (engine + tests,
plus a tiny sample CONTENT with placeholder ids: false start → 3 blocks games → reward + 2 worlds
unlock at once). P2 builds the server (envelope + migration, events from the finished block game,
wire, e2e). Then the TV hub map + unlock cutscene and the phone host panel. The user writes the real
content.

### Contract E draft — quiz activity (user request 2026-11-04; NOT frozen)

User: quiz games inside the campaign. Questions in **French**, general culture (geography, history,
literature, art…), intermediate to good level. Basic mode first: the question shows on the TV, players
answer on their phones, by **multiple choice or typed text**. The laptop will have access to a Claude
model, for example to accept misspellings. The question bank comes from free open-licensed French
datasets, bundled locally (research pending; licence and attribution must be kept).

```js
// data/quiz/*.json — the bank, server-side only (never served whole: it holds the answers)
// Question = { id, q, choices?: string[4], answer: string | number /* index when choices */,
//              accept?: string[], category, level: 1..3, source }   // source = dataset + licence

// shared/quiz/ (pure, JSDoc, like shared/game.js)
// QuizState = { kind:'quiz', phase:'lobby'|'question'|'reveal'|'finished', seed, settings,
//   order, players{ id, character, name, color, score }, hostId,
//   round: { index, questionId, deadline, answers: Record<id, { choice?|text?, at, verdict? }> } | null,
//   endReason }
// settings: { count: 10, seconds: 20, mode: 'choice'|'text'|'mixed', categories?, level? }
// actions: start (host) · answer { id, choice | text } (once per round, before the deadline)
//   · close (server: deadline or everyone answered) · verdict { id, ok } (server: async text judge)
//   · override { id, target, ok } (host: fixes a text verdict on the reveal) · next (host) · endGame (host)
// scoring: data table — correct +100, speed bonus ≤ +50 linear on the time left, 0 when wrong
```

- **The answer is never on the wire before the reveal.** The server keeps the bank. The view projects the
  current question only: text and choices during `question`, plus the answer and verdicts at `reveal`.
- **Text judging pipeline (server):** normalize (case, accents, punctuation, French articles) → exact or
  `accept` match → edit distance under a length-relative threshold → otherwise **uncertain**. An uncertain
  answer goes to a pluggable `judge(question, text) → Promise<boolean | null>` with a timeout. With no judge,
  or null or a timeout: wrong, and the host can override on the reveal. The verdict enters the reducer as a
  server action, so the reducer stays pure and a restart never re-judges.
- **No repeats across the evening:** asked question ids are kept in the campaign (engine addition).
- **Campaign:** a tableau `activity: { kind:'quiz', settings }`. It reports `quiz.finished` with the ranking
  per character, exactly once (same derivation as blocks).
- **Timed fairness:** the round deadline shifts on resume like the blocks deadline.

**Addendum E1 (orchestrator, 2026-11-04, from P2's questions; all of P2's proposals accepted):**
1. **The reducer never sees the bank.** The server judges each answer on arrival and injects its verdict
   ('right' | 'wrong' | 'uncertain') into the rebuilt `answer` action. An uncertain verdict is settled later
   by `{t:'verdict'}`.
2. **Projection in both places:** `view.quiz` and `campaign.at.activity` on the wire carry the public quiz view.
   During `question`: no verdicts and no other players' texts, only "answered ✓". `view.state` stays block-only.
3. **Selection:** the server injects the candidates into `start`, and the reducer does a seeded pick. Fewer
   candidates than `count`: play with what there is. None: err 'refused'.
4. **Modes:** a question with choices can be asked as choice OR text; one without choices is text-only.
   Choices are shuffled per round by a seeded permutation, and `choice` is the displayed index.
5. **Close:** the deadline (with a stale-timer guard) or everyone answered → reveal. Pending judgements show
   "judging…"; judge timeout 4 s → wrong; `next` with judgements pending → wrong. On resume, an unjudged
   uncertain answer → wrong (never re-judged); the host can override.
6. **Override:** host, on the reveal, ANY answer (a disputed choice question too), both ways, re-scored.
7. **Scoring** as proposed (+100, speed bonus ≤ +50, linear), credited at close or when the verdict lands.
8. **Engine:** a quiz lobby on enter; nested dispatch by `kind`; `quiz.finished` derived in the same step
   with `asked`; counters quiz.played / node.<id>.finished / quiz.won.<char> / quiz.correct.<char>; totals;
   `facts.asked` (deduped, kept by loadCampaign). `quiz.answered` is DROPPED from the event union.
   P2 implements these in shared/campaign (P1 is on the TV); P1 reviews.
9. **Wire** as proposed; `config` edits the quiz settings in its lobby, host only.
10. **judge-local** rules as proposed (one leading article dropped, years exact, length thresholds,
    token-subset → uncertain).
11. The bank lives in data/quiz/, never served (a 404 test), and is validated at boot.

### Contract F — inventory (user request 2026-11-04: "a simple and basic inventory system, object must exist"; FROZEN)

Today an item is a free string in `facts.items`, shared by everyone. Contract F makes items **real objects**
and gives each **player** their own inventory.

```js
// content: Content gains an item CATALOGUE; nothing outside it can exist
// Item = { id, name, icon /* emoji */, description }
// Content = { start, chooser, nodes, items: Record<itemId, Item> }
// validateContent: every { item } reward, { has } condition and gm give/take names a catalogue item;
//   catalogue keys = ids; name/icon/description non-empty

// facts.inventory: Record<CharacterId, Record<itemId, number>>   (counts; 0 is removed)
//   migration: the old facts.items → inventory[content.chooser] (one each); facts.items is dropped

// Effect (rewards):  { item, to?: 'chooser' | 'winner' | 'all' | CharacterId, count?: 1 }
//   default `to` = 'chooser'; 'winner' = rank 1 of the activity that completed the node (all if tied);
//   'all' = every non-left party member
// Condition:         { has: itemId, who?: CharacterId | 'anyone' /* default */, gte?: 1 }
// News:              { seq, t:'item', item, to: CharacterId[] }     (TV: "🎁 Élodie gets <icon> <name>")
// GmOp:              { op:'give', item, to: CharacterId, count? } | { op:'take', item, from: CharacterId, count? }
```

- **Items are data, never invented at runtime:** an unknown item id is refused everywhere (validation at boot,
  gm ops → refused). Loading drops inventory entries whose item left the catalogue.
- **Inventory hangs on characters** (like all facts), so it survives a phone change or a reclaim.
- **UI v1, nothing more:**
  - **Phone:** a "🎒 Bag" view (from ☰ and on the hub/world screen) listing my items: icon, name,
    description, ×count.
  - **TV:** the reward cutscene names who got what, and the hub band shows each player's item icons.
  - **Game master:** give/take, with the two-tap confirm.
- **Not in v1:** using, combining or trading items (a later contract, once the story needs it).

| Who | What |
|---|---|
| P1 | engine (types, validateContent, rewards `to`, `has`, gm give/take, migration, tests, sample catalogue: 3 placeholder items) + TV (cutscene recipient, hub item icons) |
| P2 | phone (🎒 Bag view, gm give/take with an item picker, "why locked" shows `has` leaves), server pass-through + e2e (reward lands in the right inventory, survives kill -9 and reclaim) |

### Scene direction (user, 2026-11-04): the party room is **an Altbau apartment in Vienna** — herringbone
(Fischgrät) parquet floor, high pale stucco walls with mouldings, tall casement double windows (evening
sky), tall white double door, warm light (chandelier); the birthday bunting and balloons live INSIDE
this room. Keep it simple, readable, airy — old Zelda interior style.

**M2 assignments (2026-11-04):** P1 → Q4 game-logic (settings in State, timed mode, simple set — contract addendum proposed to the orchestrator BEFORE implementing) + Q5 weight structure. P2 → Q3 (persistence, resume, settings file, best scores) + Q2 server side (QR endpoints `GET /api/join` → `{url, code}` and `GET /api/join-qr.svg`, LAN picker, room code — protocol changes proposed first). P4 → Q1 juice, then Q2 screen-lobby QR once P2's endpoint lands. P3 → Q5 feel (haptics, rules screen, menu), then Q4 settings UI once P1's contract lands. Q6 cleanup last, by the orchestrator. Dependencies flow through the orchestrator.

---

## Working agreements (all agents)

- **File ownership is the lock.** Never edit outside your package; if you must, report it to the orchestrator instead.
- Contracts (A, B, `shared` signatures) are **frozen after P0** — breaking them silently breaks three other agents. Contract changes go through the orchestrator only.
- TS for server, JSDoc-typed JS for `shared` and clients' inline logic; ESM everywhere; no build step; deps only `ws` (+ `qrcode*` in M2). Keep `npm run check` green **for your own files**; errors in other packages' in-progress files are not yours to fix.
- **Subagents never commit.** The orchestrator reviews and commits each package (one line, present tense, prefixed: `P3: drag ghost + clear preview`).
- **English everywhere:** UI copy, identifiers, comments, CSS classes, DOM ids, routes, docs. (Decided 2026-11-03, mid-M1: routes are /play and /screen, protocol roles "player" and "screen".)
- **Build for growth** — the game will grow a lot (attack mode, settings, more modes/players). Decent, reusable, extendable code: small pure functions over God files; data-driven over branching (pieces, scoring, settings, modes as data/tables); no logic duplicated between clients — promote shared helpers into shared/ or public/commun through the orchestrator; clean seams where M2 features will plug in (projections, settings object, mode hooks).
