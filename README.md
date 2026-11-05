# Itloe

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
[itloe] phones → http://192.168.0.227:3131/play?room=MKYN   room MKYN   (via eth0)
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
| `BLOKO_BIND` | Listen address. Use `127.0.0.1` for a local tunnel, or the guest's private IP in production. Default: all interfaces. `npm run start:local` sets this and `BLOKO_HOST` to `127.0.0.1` on Linux/macOS. |
| `BLOKO_HOST` | The address phones should use: an interface name (`wlan0`) or an IP address. Use it when the printed address is wrong. |
| `BLOKO_PUBLIC_ORIGIN` | Public HTTPS origin, e.g. `https://itloe.kputnik.com`. Requires `BLOKO_ACCESS_TOKEN`; replaces LAN address detection for invitations. |
| `BLOKO_ACCESS_TOKEN` | Shared invitation secret, at least 32 characters. Requires `BLOKO_PUBLIC_ORIGIN`. Never put it in Git, release files or logs. |
| `BLOKO_NEW=1` | Start a brand-new game instead of resuming the saved one. Same as `npm start -- --new`. |
| `BLOKO_VAR` | Folder for saved data (default `var/`). |
| `BLOKO_QUIZ_DIR` | Folder of the quiz question bank (default `data/quiz/`). |
| `ITLOE_CONTENT=sample` | Play the sample content (`shared/campaign/sample.js`) instead of the birthday story (`shared/campaign/story.js`). The end-to-end suites run on it. |
| `ITLOE_CONTENT=minigame:<kind>` | Start a hub and one tableau running that minigame with its sample settings (`sampleSettings` in its rules), without the story's opening, e.g. `ITLOE_CONTENT=minigame:quiz BLOKO_VAR="$(mktemp -d)" PORT=3199 npm start -- --new`. An unknown kind refuses to boot. |

If the laptop has several network connections (Wi-Fi + Ethernet, VPN…), `npm start` asks which one the phones are on. Press Enter for the first one.

**Windows with WSL:** phones must reach the *Windows* machine, not the WSL virtual machine.
With WSL's mirrored networking (`networkingMode=mirrored` in `.wslconfig`), the printed address is already the right one.
Otherwise, forward the port from Windows into WSL and start with `BLOKO_HOST=<the Windows Wi-Fi IP>`.
Either way, allow the port through the Windows firewall when asked.

## Hosted production

Infrastructure owns the LXC, Node 24 runtime, systemd service, public HTTPS/WebSocket proxy, secrets, backups and deployment timer. The game runs as an unprivileged user, with releases under `/opt/itloe/releases/<commit>`, `/opt/itloe/current` pointing at the active release, and `BLOKO_VAR=/var/lib/itloe` outside the release. The proxy forwards to the guest's private port `3131`; it must suppress URL/Referer-bearing access and error logs for this host.

Open `https://itloe.kputnik.com/?token=<shared-secret>` to authorize a browser. The server exchanges the token for a Secure/HttpOnly cookie and redirects to a clean URL. All HTTP routes and WebSocket upgrades require authorization; WebSockets also require the configured public Origin. The token-bearing join links and QR codes authorize new phones. Everyone with the invitation joins the same evening, with the four characters. Rotating the configured secret invalidates existing cookies after a restart. Without either public setting, local LAN play stays open.

Pushing to `production` runs [the production workflow](.github/workflows/production.yml): locked dependency install, type-checking, tests, save/resume checks, packaging and an extracted-runtime access test. It then publishes a GitHub Release tagged `prod-<full-commit-sha>` with:

- `itloe-<full-commit-sha>-linux-x64.tar.gz`: `server/`, `shared/`, `public/`, `data/quiz/`, `package.json`, `package-lock.json`, production `node_modules/`, and `release.json`.
- `SHA256SUMS`: the SHA-256 checksum and archive filename.

`release.json` is `{ "commit": "<full-sha>", "nodeMajor": 24, "platform": "linux", "arch": "x64" }`. Node executes the TypeScript directly. No development tools, saves, raw quiz imports or secrets are packaged. For a manual build on Linux x64 with Node 24, run `npm run release` (or `npm run release -- <commit>`); output is in ignored `dist/release/`. The builder packages **committed files**, so uncommitted edits are not released.

Publishing the completed release is the handover to Infrastructure. Its guest-local timer checks the `production` branch every two minutes and downloads that commit's release by its exact URL, without a GitHub token or public deployment webhook. Failed builds or missing releases leave the current game running; rapid pushes may coalesce into deployment of the newest commit. GitHub Actions uses its built-in `GITHUB_TOKEN` with `contents: write`, with no server credentials.

Infrastructure verifies checksums and the manifest, rechecks the branch head before activation, stops the process, copies the current saves, switches `current`, and restarts. Authenticated `/api/join` (a read-only route), a WebSocket connection and saved-room comparison validate startup. On failure, restore both the previous release and its saved data: startup can migrate or replace an incompatible save. Deployments briefly disconnect clients; they reconnect, though application changes may require a browser refresh.

For deployment readiness, derive the cookie value as hex HMAC-SHA256 with the UTF-8 access token as key and `itloe-access-v1` as message. Send it as `Cookie: __Host-itloe_access=<value>`. The `/ws` upgrade also needs `Origin: https://itloe.kputnik.com`; its first message is a `view`. Never log the `/api/join` response: its `url` contains the invitation token.

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
- **The server refuses to start, naming a minigame.** The save holds a round of a minigame this version of the game doesn't have, e.g. after going back to an older release. Run a version that has it: the save is left exactly as it was.

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

### Architecture

The application runs locally on Node.js 24+, with HTTP and WebSocket traffic on the same port. Node runs the server's TypeScript directly; browsers run JavaScript ES modules directly. There is no build step or external database, and play works without internet access.

| Location | Responsibility |
|---|---|
| `server/` | TypeScript: HTTP, WebSockets, trusted inputs, clocks, persistence, and server integration |
| `shared/` | JavaScript with JSDoc types: reusable game rules, campaign rules/content, quiz helpers, characters, and scene/sprite helpers |
| `public/play/` | Phone interface and controls |
| `public/screen/` | TV interface, rendering, audio, and effects |
| `public/commun/` | Shared browser helpers and CSS |
| `public/sim/` | Development page combining the TV and phone pages |
| `data/quiz/` | Server-only question banks |
| `test/`, `scripts/` | Node unit tests, end-to-end suites, simulation, and data import tools |

Phones send actions; the server binds them to a player, validates them, runs the shared reducers, and saves and broadcasts accepted changes. The server handles the evening's own messages and passes every other one to the running minigame's server code, listed in `server/minigames.ts` beside the rules list in `shared/minigames.js`. The campaign owns the party and progression, with the current block game or quiz nested inside it. Phone placement previews use the same rules as the server and reconcile with its next view.

Rule reducers are deterministic: time and seeds are explicit inputs, and reducers perform no I/O. Refused/no-op actions return the same state object; the server uses object identity to skip change hooks. Accepted state changes flow through `apply`/`commit` in `server/main.ts`, including atomic JSON persistence. Activity completion and the resulting campaign facts are saved together. Timed games retain their remaining time across restart or laptop suspension.

Positions, presence, and temporary join-QR display state are held in memory rather than saved. Avatar movement is client-authoritative under the protocol; game results and campaign progression are server-authoritative. Reconnection and character reclaim preserve the player's game and host role; the newest socket wins, and a replaced device stops reconnecting.

Both `public/` and `shared/` are publicly served. Quiz bank data stays on the server; the quiz's view uses `projectQuiz`, and the campaign on the wire carries no round state, to hide answers and submitted answers/verdicts until reveal. Question IDs and campaign content IDs are stable; inventory and campaign totals follow characters rather than devices. Player capacity comes from the character roster in `shared/characters.js`.

### Code conventions

- ESM throughout, with explicit relative import extensions (`.ts` for TypeScript modules, `.js` for JavaScript modules) and `node:` imports for Node built-ins. Server TypeScript uses syntax compatible with Node's type stripping. Shared rules and client JavaScript use JSDoc types; one strict `tsc` run checks both languages.
- Vanilla HTML/CSS/JavaScript clients and locally served assets. Runtime dependencies are kept small; `package.json` is the current dependency list.
- Two-space indentation, semicolons, and single-quoted JS/TS strings. Functions and variables use `camelCase`, types use `PascalCase`, constants/tables use `UPPER_SNAKE_CASE`, and multiword filenames, CSS classes, and DOM IDs generally use hyphens. Formatting follows neighboring code; there is no configured formatter or linter.
- Small functions, plain data, named exports, and closure-based `create…`/`make…` helpers are common. Existing tables describe pieces, settings, characters, campaign conditions/rewards, and scenes. Shared rule logic runs in Node and browsers; browser-specific common helpers live in `public/commun/`. Some shared assets, such as sprites, also provide rendering helpers.
- Code, comments, docs, and interface wording use English. Quiz questions are intentionally French; story copy is content data. Existing `bloko` storage keys and `BLOKO_*` environment variables remain compatible despite the visible Itloe name.
- UI uses the tokens in `public/commun/base.css` and existing DOM helpers. Boards use DOM/CSS grids; sprites and scenes use canvas. Phone layouts account for touch, keyboards, and safe areas; TV layouts prioritize readability.
- Unit tests use `node:test` and `node:assert/strict` in `test/<topic>.test.js`, with small fixtures and explicit seeds/times. They cover shared rules and browser helper logic. Integration and browser scenarios live in `scripts/e2e-*.mts`.

### Development commands and testing

| Command | What it does |
|---|---|
| `npm run check` | Type-checks everything (`tsc`, including the JSDoc-typed `shared/` and client JS) |
| `npm test` | Unit tests of shared rules and client helpers (`node --test`) |
| `npm start` | The real server (`server/main.ts`, run directly by Node, no build step) |

- **Simulator:** open **/sim/** on a running server: the TV screen plus player phones side by side in one page. The phones get the room code from `/api/join`.
- **End-to-end tests** (exit code 0 = all pass, the last line says `ALL PASS`). Never use port 3131: that's the live server.

  `e2e.mts` needs a separate server with a fresh evening, on the sample content:

  ```sh
  ITLOE_CONTENT=sample BLOKO_VAR=/tmp/bloko-e2e PORT=3199 npm start -- --new
  PORT=3199 node scripts/e2e.mts     # in a second terminal
  ```

  All the others start their OWN server on the sample content (scratch data folder, removed at the end) on `PORT`, and refuse a busy port:

  | Script | Covers | Needs |
  |---|---|---|
  | `e2e-resume.mts` | kill -9 in every phase, timed clock kept, v1 save migration | `PORT` |
  | `e2e-presence.mts` | reclaim a character, newest device wins, host controls | `PORT` |
  | `e2e-campaign.mts` | false start → unlocks → news acked by two TVs → doors, kill -9 at each step; chat, emotes and object actions (relay, history, rate limits, where interact works); `pos` during a round kept apart from the room's | `PORT` |
  | `e2e-inventory.mts` | rewards land in the right inventory (chooser / winner / all), survive kill -9 and a reclaim; host give/take, unknown items refused | `PORT` |
  | `e2e-quiz.mts` | quiz over real sockets: no answer on the wire before the reveal, judging, override, resume | `PORT` (plays a fixed copy of `placeholder.json`) |
  | `e2e-tv.mts` | the TV page in headless Chrome | `PORT`, `CDP`, optional `SHOTS=<dir>` |
  | `e2e-phone.mts` | phone pages in headless Chrome: session never lost, reclaim, host controls, campaign screens, quiz, room code | `PORT`, `CDP`, optional `LOCK_MS` (locked-phone time, default 5 min), `ONLY=1…5` (one part), `SHOTS=<dir>` |

  The browser suites need Chrome started with `--remote-debugging-port=<CDP>`; run **one browser suite at a time** and stop that Chrome afterwards. On a busy machine, `E2E_SLOW=3` multiplies every wait.

### Further reading

- [PROTOCOL.md](PROTOCOL.md): WebSocket messages, HTTP endpoints, trusted inputs, view filtering, and compatibility rules.
- [SPEC-BLOCKS.md](SPEC-BLOCKS.md): original block-game design and technical direction.
- [BUILD-PLAN.md](BUILD-PLAN.md): implementation history, contracts, and milestone-specific working agreements.
- [AGENTS.md](AGENTS.md): instructions for coding agents working in this repository.

The spec and build plan include earlier designs and examples. Quizzes introduce hidden answers and French content; the current wire format uses `t` messages as documented in `PROTOCOL.md`. Historical P1–P4 ownership and commit prefixes belong to those coordinated work packages. For a change to a shared contract, compare its documentation with the current implementation and tests and resolve any discrepancy explicitly. Draft proposals describe future work, not existing interfaces.

### Konstantin's devbox setup

This section documents Konstantin's personal setup for testing from a home PC and running agents on devbox. It is optional and specific to that environment; Pierre's local development and LAN play use the Quick start above.

On devbox, install dependencies with `npm ci`, then run:

```sh
npm run start:local
```

This runs the real server on **127.0.0.1:3131**, accessible only from that machine or through a tunnel. Pages and WebSockets share this port; there is no build step or external database. Saved games stay in the ignored `var/` folder. Source changes require a server restart; refresh the browser for client changes.

From Konstantin's home PC, open the tunnel and leave SSH running (use the usual SSH destination if different):

```sh
ssh -N -L 127.0.0.1:3131:127.0.0.1:3131 kputnik@devbox
```

Open **http://127.0.0.1:3131/sim/** for the shared screen and four player panels together, or **http://127.0.0.1:3131/** for the screen alone. `/api/join` gives the player URL and room code. The join URL/QR points at loopback, so it works on the computer with the tunnel; a separate phone needs its own connection.

On devbox, the shared server can be kept running in a detached terminal:

```sh
tmux new-session -d -s itloe -c /home/kputnik/itloe 'npm run start:local'
tmux attach -t itloe   # detach with Ctrl-b, then d; stop with Ctrl-c
```

Agents on devbox can use the same loopback URLs. For tests or changes that alter game state, start a separate instance on a free port with its own save directory:

```sh
BLOKO_VAR="$(mktemp -d /tmp/itloe-agent.XXXXXX)" PORT=3199 npm run start:local -- --new
```

That instance is at `http://127.0.0.1:3199/sim/`. Keep port 3131 and its saved game for interactive testing. Run the existing checks with `npm run check` and `npm test`; the end-to-end scripts are described above.
