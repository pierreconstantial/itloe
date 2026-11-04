# Elo-D-1

A party game for the living room, played as one long **evening**: it opens on a block puzzle (drop pieces on the board, fill rows and columns to clear them, chain clears for big combos), then a **hub** opens onto **worlds** to explore, with more games inside them, block games and **quizzes** in French, unlocked step by step.
A laptop runs everything and shows it on the TV; 1 to 4 players play on their own phones, in the browser, with no app to install. Each player is a **character** (Pierre, Élodie, Sol, Anna).

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
[elo-d-1] phones → http://192.168.0.227:3131/play?room=MKYN   room MKYN   (via eth0)
```

1. On the laptop, open **http://localhost:3131/** in a browser, go full screen, and send it to the TV. That's the shared screen.
2. Each player scans the QR code with their phone camera (or types the address) and **taps their character**.
3. The **first player to join is the host**: they start each game from their phone, and on the podium choose **Play again** or **Back to the room**.

## Room code

The server picks a 4-letter **room code** (e.g. `MKYN`) whenever it starts a fresh game; "Play again" keeps it. It's already inside the QR code and the address, so scanning just works.
A phone that opens the plain address without it is asked for the code: read it from the `room` line in the terminal.
If a phone holds an old code (the server restarted into a fresh evening), it says so ("That code (ABCD) didn't work") and asks for the new one.
The code only keeps stray devices out; it is not a password.

## During the evening

- **The hub and the worlds.** Élodie walks her character into a door (the phone's joystick) to enter a world; the host can also pick one. New places unlock as the evening goes on, and the TV celebrates each unlock.
- **The host is the game master.** On the host's phone, **☰ → 🎲 Game master**: enter a place, go back up, unlock or lock a place, set flags and counters, and see *why* something is still locked. Every change needs a second tap to confirm.
- **Quizzes.** Questions in French on the TV; players answer on their phones with 4 choices or by typing (spelling mistakes, accents and articles are forgiven; years must be exact). The host can correct any verdict on the reveal. A question is never asked twice in the same evening.
- **A phone died or got lost?** Open the address on any other phone and tap your character: it carries on with your board, score and host role. The old phone, if it comes back, shows "Continued on another device".
- **Someone left mid-game?** The host can take an offline player out, or end the game, from ☰ on their phone.

## Options

Set them in front of `npm start`, e.g. `PORT=8080 npm start`.

| Variable | What it does |
|---|---|
| `PORT` | Port to use (default `3131`). |
| `BLOKO_HOST` | The address phones should use: an interface name (`wlan0`) or an IP address. Use it when the printed address is wrong. |
| `BLOKO_NEW=1` | Start a brand-new game instead of resuming the saved one. Same as `npm start -- --new`. |
| `BLOKO_VAR` | Folder for saved data (default `var/`). |
| `BLOKO_QUIZ_DIR` | Folder of the quiz question bank (default `data/quiz/`). |

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
- **"That code didn't work."** Use the `room` code printed by the server that's running now: a restart into a fresh evening draws a new one.
- **The server refuses to start, listing problems.** The story content or the quiz bank has a mistake: the list says which question or place, and what is wrong.

## Saved data

Everything lives in `var/` (or `BLOKO_VAR`):

| File | Contents |
|---|---|
| `bloko.state.json` | The evening (party, where you are, the game in progress, what is unlocked), for resuming |
| `bloko.state.json.v1-….json` | Only after an upgrade: the save from before the campaign, kept untouched |
| `bests.json` | Solo best scores, per board size and mode |

Delete `bests.json` to reset the best scores, or the whole `var/` folder to reset everything (with the server stopped).

## Quiz questions and credits

The questions live in **`data/quiz/*.json`** (server side only: never sent to the phones, the answers stay on the laptop). Every file is checked when the server starts.

- `openquizzdb.json`: general-culture questions from **[OpenQuizzDB](https://www.openquizzdb.org)**, licensed **CC BY-SA 4.0**, adapted (selection, format). The game shows the credits on the quiz screens and each question's source with its answer.
- `placeholder.json`: a few questions written for this project (CC0), used by the tests.

To refresh the OpenQuizzDB questions (rarely needed):

```sh
node scripts/fetch-openquizzdb.mts          # download the catalogue into data/sources/openquizzdb/ (slow, polite, resumable)
node scripts/import-openquizzdb.mts         # rebuild data/quiz/openquizzdb.json from it (validated, attribution kept)
```

A bank file is `{ "dataset": { "name", "licence", "attribution" }, "questions": [...] }`. Each question has `id` (stable, never reused), `q`, `choices` (4) with `answer` as the right one's index (or `answer` as text for a typed-only question), `category`, `level` (1–3) and `source`, plus optional `accept` (other accepted spellings), `anecdote` (shown with the answer) and `typed: false` (an answer too long to type: asked as a choice only).

---

## For developers

| Command | What it does |
|---|---|
| `npm run check` | Type-checks everything (`tsc`, including the JSDoc-typed `shared/` and client JS) |
| `npm test` | Unit tests of the shared game logic (`node --test`) |
| `npm run mock` | Mock server with near-real rules, for client work (`PORT` works too) |
| `npm start` | The real server (`server/main.ts`, run directly by Node, no build step) |

- **Simulator:** open **/sim/** on a running server: the TV screen plus player phones side by side in one page. With the real server, those phones open without a room code, so type the code from the terminal.
- **End-to-end tests** (exit code 0 = all pass, the last line says `ALL PASS`). Never use port 3131: that's the live server.

  `e2e.mts` needs a separate server with a fresh lobby:

  ```sh
  BLOKO_VAR=/tmp/bloko-e2e PORT=3199 npm start -- --new
  PORT=3199 node scripts/e2e.mts     # in a second terminal
  ```

  All the others start their OWN server (scratch data folder, removed at the end) on `PORT`, and refuse a busy port:

  | Script | Covers | Needs |
  |---|---|---|
  | `e2e-resume.mts` | kill -9 in every phase, timed clock kept, v1 save migration | `PORT` |
  | `e2e-presence.mts` | reclaim a character, newest device wins, host controls | `PORT` |
  | `e2e-campaign.mts` | false start → unlocks → news acked by two TVs → doors, kill -9 at each step | `PORT` |
  | `e2e-inventory.mts` | rewards land in the right inventory (chooser / winner / all), survive kill -9 and a reclaim; host give/take, unknown items refused | `PORT` |
  | `e2e-quiz.mts` | quiz over real sockets: no answer on the wire before the reveal, judging, override, resume | `PORT` (plays a fixed copy of `placeholder.json`) |
  | `e2e-tv.mts` | the TV page in headless Chrome | `PORT`, `CDP`, optional `SHOTS=<dir>` |
  | `e2e-phone.mts` | phone pages in headless Chrome: session never lost, reclaim, host controls, campaign screens, quiz, room code | `PORT`, `CDP`, optional `LOCK_MS` (locked-phone time, default 5 min), `ONLY=1…5` (one part), `SHOTS=<dir>` |

  The browser suites need Chrome started with `--remote-debugging-port=<CDP>`; run **one browser suite at a time** and stop that Chrome afterwards. On a busy machine, `E2E_SLOW=3` multiplies every wait.

- **Docs:** [`SPEC-BLOCKS.md`](SPEC-BLOCKS.md) (game design), [`PROTOCOL.md`](PROTOCOL.md) (WebSocket protocol and HTTP API), [`BUILD-PLAN.md`](BUILD-PLAN.md) (milestones and work packages).
- **Layout:** `server/` (Node server, TypeScript), `shared/` (pure logic used by server and browsers: the block game, `campaign/` the evening, `quiz/` the quiz), `public/` (`/screen`, `/play`, `/sim` pages; `commun/` shared by them), `data/quiz/` (question bank), `test/`, `scripts/` (e2e suites, simulator, OpenQuizzDB fetch + import).
