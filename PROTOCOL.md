# Bloko — wire protocol (Contract B, FROZEN after P0)

Transport: WebSocket, JSON text frames. HTTP static + WS share port **3131** (`PORT` env overrides, used by agents to run several mocks). WS path: **`/ws`**.

Static serving: `public/` at `/` (`/` redirects to `/ecran/`), and **`shared/` is served at `/shared/`** so browser clients import the same game logic: `import { canPlace } from '/shared/board.js'`.

## Client → server

```jsonc
{ "t": "hello", "role": "jouer", "playerId": "p-abc123" }  // playerId optional (rejoin after reload/sleep)
{ "t": "hello", "role": "ecran" }
{ "t": "join",  "name": "Léa" }                            // after hello; server assigns or reuses the id
{ "t": "start" }                                           // host only, phase lobby
{ "t": "again" }                                           // host only, phase finished
{ "t": "place", "piece": 0, "x": 3, "y": 5 }               // piece = index 0..2 in own hand; (x,y) = piece origin
```

## Server → client

```jsonc
{ "t": "welcome", "playerId": "p-abc123" }   // to a jouer client after join or successful rejoin
{ "t": "view", "state": { /* full State, see shared/game.js */ } }  // broadcast to ALL after every change
{ "t": "err", "code": "full" | "bad-place" | "not-host" | "not-playing" | "unknown-player" }
```

- M1 sends the **full State to everyone** (this game has no secrets); each client derives its own view.
- `role: "ecran"` gets no `welcome`, only `view`s (including immediately on connect).
- Rejoin: `hello` with a known `playerId` → server re-attaches the socket, replies `welcome` + `view`. Unknown `playerId` → treated as a fresh client (must `join`).
- The server re-validates every `place`; on refusal it sends `err: "bad-place"` and the client re-renders from the last `view`.

## Mock server only (`npm run mock`)

`server/mock.ts` implements the above with near-real rules (no `reduce`), plus a debug message for client development:

```jsonc
{ "t": "debug", "scenario": "midgame" | "finished" }
```

- `midgame`: 4 players, half-filled boards, scores/streaks set — for `/ecran` layout work.
- `finished`: phase `finished` with ranked scores — for podium work.
