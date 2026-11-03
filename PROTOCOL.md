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
{ "t": "join",  "name": "Lea" }                             // after hello; server assigns or reuses the id
{ "t": "start" }                                            // host only, phase lobby
{ "t": "again" }                                            // host only, phase finished
{ "t": "place", "piece": 0, "x": 3, "y": 5 }                // piece = index 0..2 in own hand; (x,y) = piece origin
{ "t": "config", "patch": { "mode": "timed" } }             // host only, phase lobby/finished (M2 Q4); invalid keys/values ignored
{ "t": "leave" }                                            // lobby/finished: player removed, slot freed; playing: marked done; host passes on
```

Server-internal reducer inputs (`now` on start/again, the `timeUp` action, `deadline`) are NEVER accepted from the wire: the server injects them itself and strips them from client messages.

## Server → client

```jsonc
{ "t": "welcome", "playerId": "p-abc123" }   // to a player client after join or successful rejoin
{ "t": "view", "state": { /* full State, see shared/game.js */ }, "now": 1730700000000 }
// broadcast to ALL after every change; "now" = server epoch ms (M2 Q4): clients compute
// clock skew = now - Date.now() on receive and render timed-mode countdowns from state.deadline - (Date.now() + skew)
{ "t": "err", "code": "full" | "bad-place" | "not-host" | "not-playing" | "unknown-player" | "locked" | "bad-room" }
// "locked": config refused because a game is in progress
// "bad-room": join refused — wrong or missing room code (phone shows "ask for the code on the TV")
```

- M1 sends the **full State to everyone** (this game has no secrets); each client derives its own view.
- `role: "screen"` gets no `welcome`, only `view`s (including immediately on connect).
- Rejoin: `hello` with a known `playerId` → server re-attaches the socket, replies `welcome` + `view`. Unknown `playerId` → treated as a fresh client (must `join`).
- The server re-validates every `place`; on refusal it sends `err: "bad-place"` and the client re-renders from the last `view`.

## Solo best scores (M2 Q3)

In solo games the view gains an optional sibling: `{ "t": "view", "state": …, "now": …, "best": { "score": 4210, "previous": 3980 } }` for the current (size, mode) — `previous` is the record before this game, so a client shows "New best!" when its score exceeds it. Absent in multiplayer.

## HTTP API (M2 Q2)

- `GET /api/join` → `{"url":"http://<lan-ip>:<port>/play?room=ABCD","code":"ABCD"}`
- `GET /api/join-qr.svg` → QR of that URL (image/svg+xml, no-store)

## Mock server only (`npm run mock`)

`server/mock.ts` implements the above with near-real rules (no `reduce`), plus a debug message for client development:

```jsonc
{ "t": "debug", "scenario": "midgame" | "finished" }
```

- `midgame`: 4 players, half-filled boards, scores/streaks set — for `/screen` layout work.
- `finished`: phase `finished` with ranked scores — for podium work.
