# Bloko — Block-puzzle Party Game Spec (v1: 1–4 players, shared screen + phones)

A **Block-Blast / Woodoku-style** puzzle (the genre of the Netflix mobile games), turned into a living-room party game:

- Each player has an **8×8 board** and a **hand of 3 pieces**.
- Pieces **cannot be rotated**. You place them anywhere they fit; when the hand is empty you get 3 new ones.
- Completing a **row or a column** clears it (no gravity). Several lines at once and clear streaks make **combos**.
- You lose when **no piece in your hand fits** anywhere. Last score standing wins.

It is **not real Tetris**: nothing falls, there is no time pressure by default, so it is forgiving to play on a phone and fair over Wi-Fi.

**1 to 4 players.** A **laptop runs the server** on the local network and its browser is put on the **TV / big screen**, which shows all the boards. Each player joins by scanning a **QR code**; their **phone is their controller** and private board view. The UI, the code and all docs are in English.

---

## 1. Goals & constraints

| | |
|---|---|
| **Devices** | One laptop (server + the `/screen` page shown on the TV) + **1–4 smartphones**, one per player |
| **Players** | 1 to 4. Solo works (it's a score chase); 2–4 is the party mode |
| **Joining** | Scan the QR code → the phone opens the game in its browser. No app to install |
| **Language** | English — UI copy, code identifiers, comments, routes |
| **Connectivity** | Works **without internet**: laptop and phones on the **same local network** (Wi-Fi or hotspot) |
| **Install** | Node.js on the laptop only. One command starts everything. Phones need nothing |
| **Session length** | One game ≈ 5–15 min. Designed for instant rematches ("Play again") |

### Out of scope (v1)
- Attack / garbage mode (combos hurting opponents) — planned, §14
- More than 4 players, teams, tournaments
- Playing across the internet, hosted version, native apps, accounts
- Bots

---

## 2. Principle: the screen is the show, the phone is the hand

- The **big screen** (`/screen`) shows **all boards side by side**, scores, hands, combo call-outs and the podium. It is the spectacle: everyone can watch everyone struggle.
- The **phone** (`/play`) is where you actually play: your own board, your 3 pieces, drag to place. It never shows other boards bigger than a score line — eyes go up to the TV for that.
- There are **no secrets** in this game (everyone may see everything), so unlike Pyramide the projection problem is trivial. The split is ergonomic, not informational.
- **The server is the single source of truth**: phones send placement **actions**, the server validates, scores and broadcasts the new state. A phone reloading or sleeping loses nothing.

---

## 3. Architecture

```
  ┌─────────────────────────── Laptop ───────────────────────────┐
  │  Node server  (HTTP + WebSocket)                             │
  │   • serves the web app to phones and screen                  │
  │   • authoritative game state (pure reducer)                  │
  │   • generates the shared piece sequence (seeded RNG)         │
  │   • validates placements, computes clears / combos / scores  │
  │   • persists state to disk after every action                │
  │                                                              │
  │  Browser → /screen  (on the TV: lobby QR, boards, podium)     │
  └──────────────────────────────────────────────────────────────┘
                  ▲  WebSocket, same Wi-Fi / hotspot
        ┌─────────┼─────────┬─────────┐
     📱 /play  📱 /play  📱 /play  📱 /play
     player 1   player 2   player 3   player 4
     (host)
```

- **Start-up:** `npm start` → the server finds the LAN IP (picker if several interfaces), prints the URL + an ASCII QR code, and the laptop browser opens `/screen`, which shows the **join QR code** in large plus the room code. The laptop is then plugged into the TV and left alone.
- **Latency:** placement is turn-free and untimed, so tens of ms of Wi-Fi latency are invisible. The only real-time feel needed is the drag ghost, which is computed **locally on the phone**.
- Same network gotchas as Pyramide (client isolation → hotspot help panel; plain HTTP so no Wake Lock → "Disable screen sleep during the game"; laptop must not sleep: reminder on `/screen`).

---

## 4. Joining & the lobby

- The QR encodes `http://<ip-lan>:<port>/play?salle=<CODE>`. The room code stops stray devices, it is not security.
- On the phone: **first name** (remembered) + **personal colour** from a colour-blind-safe palette of 4–6. Your colour fills your board's pieces on the big screen all game.
- The **lobby** on `/screen`: QR large, slots filling live with online dots. Phones show "Waiting for the other players…" plus a mini how-to-play (3 lines, with piece drawings).
- **Host = first player to join.** Host-only controls (on their phone): settings (§8), remove a player, hand over host role, **"Start game"** (active from 1 player).
- A 5th phone sees "Game is full".
- **Reconnection:** player id in `localStorage`; reload or sleep → silent reconnect, current view restored. A disconnected player's board simply idles (others keep playing — the game is asynchronous); a banner on their board on `/screen` shows "disconnected". The host can remove them, which freezes their board and score.

---

## 5. Game rules

### 5.1 Board & pieces

- Board: **8×8** (configurable 9×9, 10×10). Cells are empty or filled; filled cells keep the colour of the piece that made them.
- **Hand:** 3 pieces, visible to everyone (on your phone and under your board on `/screen`). Place them in any order, anywhere they fit. When all 3 are placed, the hand refills.
- **No rotation, no gravity, no discard.**

### 5.2 Piece set

Orientations are distinct pieces (since there is no rotation). v1 set, 29 pieces:

| Family | Variants | Cells |
|---|---|---|
| Point | 1×1 | 1 |
| Barres | 1×2, 1×3, 1×4, 1×5 — each horizontal **and** vertical | 2–5 |
| Carrés | 2×2, 3×3 | 4, 9 |
| Rectangles | 2×3, 3×2 | 6 |
| Petits coins (L of 3) | 4 orientations | 3 |
| Grands coins (L of 5, 3×3 corner) | 4 orientations | 5 |
| S / Z | horizontal + vertical each | 4 |
| T | 4 orientations | 4 |

- Weights: small pieces slightly more frequent; the 3×3 carré and 1×5 barres rare. Exact weights in a data file, tuned in playtests.
- "Simple set" setting removes S/Z/T for younger players.

### 5.3 Fairness: the shared sequence

- The server generates **one seeded sequence of hands** (triples) per game. **Every player receives the same hands in the same order**, consumed at their own pace: your 4th hand is identical to everyone's 4th hand.
- So the race is pure skill: same luck for all. The seed is stored with the game (replayable, debuggable).
- No "mercy" reroll: if a hand doesn't fit, you're out — watching an opponent survive the hand that killed you is the game.

### 5.4 Clears & scoring

On each placement, in order:

1. **Placement points:** +1 per cell of the piece.
2. **Clears:** every full row and full column is detected **simultaneously** and cleared at once (a cell at a row/column intersection counts once). `L` = number of lines cleared by this placement (a cross = 2).
3. **Clear points:** `10 × L²` — 1 line = 10, 2 = 40, 3 = 90…
4. **Streak (combo):** consecutive placements that clear something build a streak. Clear points are multiplied by `(1 + streak)`: second clearing placement in a row ×2, third ×3… One non-clearing placement is forgiven (grace of 1); the second in a row resets the streak to 0.
5. **Clean board:** if the board is completely empty after the clear, **+300**.

The big screen celebrates: "Combo ×3!", "Double line!", "Clean board!" with the player's colour.

### 5.5 End of game

- A player with **no possible placement** for any piece left in their hand is **done**: board frozen, final score locked, a subtle "💀 Done" overlay on `/screen`. Their phone shows their final score and the live boards of the others (their one moment of spectating).
- The game ends when **all players are done** → **podium** on `/screen` and on every phone, champion crowned with confetti. Host: **"Play again"** (same players, new seed) and **"New game"** (back to the lobby).
- **Timed mode** (optional setting): fixed duration (3 min default); at the end, highest score wins and players still alive just stop. Stuck players before the end are done as usual.
- Solo: the podium is replaced by the score + the local **best score** (stored on disk, per board size and mode).

---

## 6. The big screen (`/screen`)

- **Lobby:** QR + room code + slots, how-to-play panel.
- **In game:** layout by player count — 1 board centered large; 2 side by side; 3–4 in a 2×2 grid. Each board shows: name + colour, score (animated counting), the 3-piece hand, streak flame when ≥1, crown on the current leader, "💀 Done" overlay when stuck.
- **Danger indicator:** when a player has very few legal placements left (< 3 positions across their hand), their board frame pulses — the room sees the drama coming.
- **Juice is the point** (the "Netflix sophistication"): clear animations (line flash + particles in player colour), screen-shake on 2+ lines, combo call-outs, podium sequence. Animations never block input.
- **Sound comes from the big screen only** (place, clear, combo, game over, podium) — one audio source, phones stay silent by default. iOS/laptop autoplay is unlocked by the "Start game" click.

---

## 7. The phone (`/play`)

Portrait, one-hand drag, no scrolling in game.

1. **Join:** first name + colour.
2. **Lobby:** waiting view; host sees settings + "Start game".
3. **Game screen:**
   - Top bar: your score, your rank (①–④), opponents' scores small.
   - Your **board** (~60% of the height).
   - Your **3-piece tray** below.
   - **Drag to place:** the piece lifts and renders **above your finger** (offset ~1.5 cells so the thumb doesn't hide it); a **ghost** snaps to the grid, green when legal, red when not; lines that would clear light up in preview. Release on a legal spot places it; release elsewhere returns it to the tray. Ghost and legality are computed **locally** for zero-latency feel; the server re-validates.
   - **Haptics** (Android): tick on pickup, thump on place, buzz on clear.
   - If an illegal placement slips through (double-send, race), the server refuses and the phone restores the tray — no trust in the client.
4. **Done:** final score + rank so far + mini live view of remaining boards.
5. **Podium**, synchronised with the screen; "Play again" on the host's phone.
6. **Menu (☰):** Inviter (QR), règles, vibration on/off, quitter. Host: settings, remove player, end game.

---

## 8. Settings (host)

| Setting | Default | Range |
|---|---|---|
| Board size | 8×8 | 8×8 / 9×9 / 10×10 |
| Mode | Marathon (until stuck) | Marathon / Timed |
| Timed duration | 3 min | 1–5 min |
| Piece set | Complet | Complet / Simple (no S/Z/T) |
| Combo grace | 1 placement | 0 / 1 / 2 |
| Plateau net bonus | 300 | 0–500 |
| Sounds (screen) | on | on / off |

Stored on disk, reused next game.

---

## 9. State & resilience

- The server saves the full state to a JSON file after every action: players, boards, hands, sequence seed + per-player cursor, scores, streaks, settings, action log.
- Server restart → `/screen` offers to resume; phones reconnect automatically.
- Disconnections **never pause** the game (play is asynchronous); the disconnected player resumes where they were.
- Best scores (solo) persisted per board size and mode.

---

## 10. Security & fairness

- Every placement is validated server-side: the piece must be in **that player's current hand**, within bounds, on empty cells only. Out-of-turn is meaningless here (no turns), but a done player's actions are ignored.
- Scores, clears, streaks and stuck-detection are computed **only on the server** from the same pure functions the phone uses for preview — shared module, one implementation.
- The piece sequence is server-generated; phones never pick their pieces.

---

## 11. Technical notes

- **Server:** Node 24+, TypeScript run directly by Node (`node server/main.ts`), ESM. Dependencies kept minimal: `ws` (WebSocket), `qrcode` + `qrcode-terminal` (offline QR). `package.json` with `typescript` + `@types/node`, `npm run check` = `tsc` (type-check only).
- **Clients:** vanilla HTML / CSS / JS (ES modules), served by the server, **no build step**. Rendering: DOM/CSS grid for boards (canvas only if perf demands it). Fonts and sounds bundled locally.
- **Shared game logic is pure** and must run on both server (authoritative) and phone (drag preview): `shared/` is written in plain modern **ESM `.js` with JSDoc types**, type-checked by the same `tsc` run (`checkJs`), so browsers execute it untouched and the server imports the same files. One implementation of: `canPlace`, `place`, `findClears`, `applyClears`, `score`, `isStuck`, `generateSequence(seed)`.
- Message protocol: phones send `{ type: "action", action: { type: "placer", pieceIndex, x, y } }` (+ join/host actions); the server broadcasts `{ type: "view", view }` after every change. Views are per-client only in that `/screen` and `/play` want different shapes.
- Suggested layout:
  ```
  server/          (http, websocket, persistence, LAN IP, QR)   — .ts
  shared/          (pieces, board ops, scoring, sequence, rng)  — .js + JSDoc
  public/
    screen/         (TV client)
    play/         (phone client)
    commun/        (css, sounds, fonts)
  data/            (pieces.json: shapes + weights)
  ```
- **Tests** (node:test): placement validation & bounds; simultaneous row+column clears (cross counts cells once); scoring table incl. streak grace and plateau net; stuck detection; sequence determinism (same seed → same hands) and equality across players; reconnection resync.
- **Dev tooling:** "simulate players" page — `/screen` plus 4 `/play` iframes in one browser window, so the whole game is testable alone.

---

## 12. Target devices

- iOS Safari 16+ and Android Chrome (recent). Phones 360–430 px portrait, usable at 320 px.
- `/screen` designed for 1080p TV at 2–4 m viewing distance: big type, high contrast, dark background.

---

## 13. Open questions

1. **Combo tuning:** is `10 × L² × (1 + streak)` with grace 1 exciting without letting one lucky streak decide the game? Playtest.
2. **Danger indicator:** is showing an opponent's near-death on the big screen fun pressure or too mean? (Option to turn off.)
3. **Timed mode:** should stuck players in timed mode get a fresh board at −50% streak instead of dying, to keep everyone playing until the bell?
4. Piece **weights**: start values needed, then tune so an average player survives ~15–25 hands.

---

## 14. Later

- **Attack mode:** combos send junk cells to opponents' boards (the "Tetris 99" feel) — needs the danger/served-junk UX designed carefully.
- Shared-screen-less fallback (pure phones, like Pyramide) for travel.
- 5–8 players (screen layout, performance).
- Daily-seed challenge (same seed for everyone that day, local leaderboard).
