# Bloko — Build plan (multi-agent)

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

**M2 assignments (2026-11-04):** P1 → Q4 game-logic (settings in State, timed mode, simple set — contract addendum proposed to the orchestrator BEFORE implementing) + Q5 weight structure. P2 → Q3 (persistence, resume, settings file, best scores) + Q2 server side (QR endpoints `GET /api/join` → `{url, code}` and `GET /api/join-qr.svg`, LAN picker, room code — protocol changes proposed first). P4 → Q1 juice, then Q2 screen-lobby QR once P2's endpoint lands. P3 → Q5 feel (haptics, rules screen, menu), then Q4 settings UI once P1's contract lands. Q6 cleanup last, by the orchestrator. Dependencies flow through the orchestrator.

---

## Working agreements (all agents)

- **File ownership is the lock.** Never edit outside your package; if you must, report it to the orchestrator instead.
- Contracts (A, B, `shared` signatures) are **frozen after P0** — breaking them silently breaks three other agents. Contract changes go through the orchestrator only.
- TS for server, JSDoc-typed JS for `shared` and clients' inline logic; ESM everywhere; no build step; deps only `ws` (+ `qrcode*` in M2). Keep `npm run check` green **for your own files**; errors in other packages' in-progress files are not yours to fix.
- **Subagents never commit.** The orchestrator reviews and commits each package (one line, present tense, prefixed: `P3: drag ghost + clear preview`).
- **English everywhere:** UI copy, identifiers, comments, CSS classes, DOM ids, routes, docs. (Decided 2026-11-03, mid-M1: routes are /play and /screen, protocol roles "player" and "screen".)
- **Build for growth** — the game will grow a lot (attack mode, settings, more modes/players). Decent, reusable, extendable code: small pure functions over God files; data-driven over branching (pieces, scoring, settings, modes as data/tables); no logic duplicated between clients — promote shared helpers into shared/ or public/commun through the orchestrator; clean seams where M2 features will plug in (projections, settings object, mode hooks).
