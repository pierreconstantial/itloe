# Bloko

A block-puzzle party game for the living room: drop pieces on an 8×8 board, fill rows and columns to clear them, and chain clears for big combos.
A laptop runs the game and shows every board on the TV; 1 to 4 players play on their own phones, in the browser, with no app to install.

## What you need

- A laptop with **Node.js 24 or newer**.
- A **TV or big screen** plugged into the laptop (any browser).
- **Phones on the same Wi-Fi** as the laptop.

## Quick start

```sh
npm install      # once
npm start
```

The terminal prints a QR code and a line like:

```
[bloko] phones → http://192.168.0.227:3131/play?room=MKYN   room MKYN   (via eth0)
```

1. On the laptop, open **http://localhost:3131/** in a browser, go full screen, and send it to the TV. That's the shared screen.
2. Each player scans the QR code with their phone camera (or types the address), enters a name, and joins.
3. The **first player to join is the host**: they start the game from their phone, and "Play again" at the end.

## Room code

The server picks a 4-letter **room code** (e.g. `MKYN`) whenever it starts a fresh game; "Play again" keeps it. It's already inside the QR code and the address, so scanning just works.
A phone that opens the plain address without it is asked for the code: read it from the `room` line in the terminal.
The code only keeps stray devices out; it is not a password.

## Options

Set them in front of `npm start`, e.g. `PORT=8080 npm start`.

| Variable | What it does |
|---|---|
| `PORT` | Port to use (default `3131`). |
| `BLOKO_HOST` | The address phones should use: an interface name (`wlan0`) or an IP address. Use it when the printed address is wrong. |
| `BLOKO_NEW=1` | Start a brand-new game instead of resuming the saved one. Same as `npm start -- --new`. |
| `BLOKO_VAR` | Folder for saved data (default `var/`). |

If the laptop has several network connections (Wi-Fi + Ethernet, VPN…), `npm start` asks which one the phones are on. Press Enter for the first one.

**Windows with WSL:** phones must reach the *Windows* machine, not the WSL virtual machine.
With WSL's mirrored networking (`networkingMode=mirrored` in `.wslconfig`), the printed address is already the right one.
Otherwise, forward the port from Windows into WSL and start with `BLOKO_HOST=<the Windows Wi-Fi IP>`.
Either way, allow the port through the Windows firewall when asked.

## If the server stops

The whole evening is saved after every move. Just run `npm start` again:

- **everything is resumed**: where the party is, who is playing, a game in progress (a timed game keeps its remaining time), the podium, what has been unlocked so far. Phones and the TV reconnect on their own;
- `npm start -- --new` always starts a fresh evening.

A phone that goes to sleep or reloads also comes back to its own board automatically.

## Troubleshooting

- **Phones can't open the page.** Check that they're on the same Wi-Fi as the laptop. Guest and hotel networks often block devices from talking to each other ("client isolation"): put the laptop and the phones on a **phone's hotspot** instead.
- **Wrong address in the terminal.** Set `BLOKO_HOST` (see Options).
- **Everything freezes after a while.** The laptop went to sleep: keep it plugged in and turn off sleep while you play.
- **A phone keeps dimming.** Turn off its screen auto-lock for the evening, or just tap it: the game picks up where it was.
- **"That code didn't work."** Use the `room` code printed by the server that's running now: a restart into a fresh game draws a new one.

## Saved data

Everything lives in `var/` (or `BLOKO_VAR`):

| File | Contents |
|---|---|
| `bloko.state.json` | The evening (party, where you are, the game in progress, what is unlocked), for resuming |
| `bloko.state.json.v1-….json` | Only after an upgrade: the save from before the campaign, kept untouched |
| `bests.json` | Solo best scores, per board size and mode |

Delete `bests.json` to reset the best scores, or the whole `var/` folder to reset everything (with the server stopped).

---

## For developers

| Command | What it does |
|---|---|
| `npm run check` | Type-checks everything (`tsc`, including the JSDoc-typed `shared/` and client JS) |
| `npm test` | Unit tests of the shared game logic (`node --test`) |
| `npm run mock` | Mock server with near-real rules, for client work (`PORT` works too) |
| `npm start` | The real server (`server/main.ts`, run directly by Node, no build step) |

- **Simulator:** open **/sim/** on a running server: the TV screen plus player phones side by side in one page. With the real server, those phones open without a room code, so type the code from the terminal.
- **End-to-end test:** it needs a fresh lobby and its own data folder, so give it a separate server:

  ```sh
  BLOKO_VAR=/tmp/bloko-e2e PORT=3199 npm start -- --new
  PORT=3199 node scripts/e2e.mts     # in a second terminal; exit code 0 = all pass
  ```

  The other e2e scripts start their OWN server (scratch data folder) on `PORT`, never 3131:
  `e2e-resume.mts` (kill -9 in every phase, v1 save migration), `e2e-presence.mts` (reclaim, bump, host controls),
  `e2e-campaign.mts` (false start → unlocks → news acks with two TVs → doors, kill -9 at each step).
  The browser ones also need Chrome with `--remote-debugging-port=<CDP>`: `e2e-tv.mts` (TV) and
  `e2e-phone.mts` (phones: session never lost, reclaim, host controls; `LOCK_MS` = locked-phone time, default 5 min).

- **Docs:** [`SPEC-BLOCKS.md`](SPEC-BLOCKS.md) (game design), [`PROTOCOL.md`](PROTOCOL.md) (WebSocket protocol and HTTP API), [`BUILD-PLAN.md`](BUILD-PLAN.md) (milestones and work packages).
- **Layout:** `server/` (Node server, TypeScript), `shared/` (pure game logic used by both server and browsers), `public/` (`/screen`, `/play`, `/sim` pages), `test/`, `scripts/`.
