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
3. **Pierre is the game master**: he starts each game from his phone, and the game opens its **lobby**. Each player taps **I'm ready**, and Pierre taps **Start**. After each round's podium, Pierre takes everyone **Back to the lobby**, where he can **Play again** or end the game, which brings everyone back to the room. Nobody else can, so Pierre joins before the first game.

## Room code

The server picks a 4-letter **room code** (e.g. `MKYN`) whenever it starts a fresh evening; it stays the same for the whole evening. It's already inside the QR code and the address, so scanning just works.
A phone that opens the plain address without it is asked for the code: read it from the `room` line in the terminal.
If a phone holds an old code (the server restarted into a fresh evening), it says so ("That code (ABCD) didn't work") and asks for the new one.
The code only keeps stray devices out; it is not a password.

## During the evening

- **The hub and the worlds.** Élodie walks her character into a door (the phone's joystick) to enter a world; the game master can also pick one. New places unlock as the evening goes on, and the TV celebrates each unlock.
- **Wisp Mode.** A late player selects a predefined character and joins as a tiny floating light with a hint of their character's color. Wisps have no name label and pulse slightly while moving. They can tap **Shine** in reactions or beside nearby objects, but cannot speak, use objects, or affect the story through their Wisp action. During a game, everyone who isn't playing (not one of its players, not ready, or out of the round) floats over the TV as a wisp too. When the story introduces that character, the phone vibrates and counts down **3, 2, 1** before the TV reveals the character with an emote. Nico is available as a fifth character slot.
- **Pierre is the game master.** On Pierre's phone, **☰ → 🎲 Game master** is available even when he is a Wisp. He can move the party, unlock or lock a place, set flags and counters, and see *why* something is still locked. Every change needs a second tap to confirm. He also starts and ends every game, sets it up in its lobby, and starts its rounds.
- **Quizzes.** Questions in French on the TV; players answer on their phones with 4 choices or by typing (spelling mistakes, accents and articles are forgiven; years must be exact). The game master can correct any verdict on the reveal. A question is never asked twice in the same evening.
- **Pyramide.** A word game in French, in teams of two: one player gives one-word clues and the other guesses the secret word, and each clue costs a brick. Players walk their characters onto spots in its lobby to choose their team and role. There is a classic mode (each team plays its own words with a few bricks) and a bidding duel (both teams play the same words and bid how few clues they need). The word shows only on its clue givers' phones, and a remote player can play from the phone alone, with no TV. A word is never used twice in the same evening.
- **Backgammon.** Two to four players play each other on up to two boards side by side, in rounds against a clock the game master sets, then the most points win (a gammon counts double). Each player plays on their phone, where their board stands upright and the points a checker can reach light up. Between rounds the TV celebrates the winners, and the game master starts the next round.
- **Table football.** Two to six players in two teams, Blue and Red, play live on a table on the TV. Each player slides a finger up and down their phone to move their rods; a man the ball touches kicks it, and holding the power button makes the next touch a strong shot. The game master tunes the ball's speeds in the settings. A prototype: a match runs until the game master ends it.
- **A phone died or got lost?** Open the address on any other phone and tap your character: it carries on with your board and score. The old phone, if it comes back, shows "Continued on another device".
- **Someone left mid-game?** The game master can take an offline player out, or end the game, from ☰ on their phone.

## Options

Set them in front of `npm start`, e.g. `PORT=8080 npm start`.

| Variable | What it does |
|---|---|
| `PORT` | Port to use (default `3131`). |
| `BLOKO_BIND` | Listen address. Use `127.0.0.1` for a local tunnel, or the guest's private IP in production. Default: all interfaces. `npm run start:local` sets this and `BLOKO_HOST` to `127.0.0.1` on Linux/macOS. |
| `BLOKO_HOST` | The address phones should use: an interface name (`wlan0`) or an IP address. Use it when the printed address is wrong. |
| `BLOKO_PUBLIC_ORIGIN` | Public HTTPS origin, e.g. `https://itloe.kputnik.com`. Requires `BLOKO_ACCESS_TOKEN`; replaces LAN address detection for invitations. |
| `BLOKO_ACCESS_TOKEN` | Shared invitation secret of 6 letters or digits, short enough for guests to type from the TV. Requires `BLOKO_PUBLIC_ORIGIN`. Never put it in Git, release files or logs. |
| `BLOKO_ADMIN_TOKEN` | Admin secret of 6 letters or digits, different from `BLOKO_ACCESS_TOKEN`. Opening any page with `?admin=<token>` once lets that browser use the admin page and the reset. Without it, a LAN server leaves both open to everyone, and a public one to nobody. Never put it in Git, release files or logs. |
| `BLOKO_NEW=1` | Start a brand-new game instead of resuming the saved one. Same as `npm start -- --new`. |
| `BLOKO_VAR` | Folder for saved data (default `var/`). |
| `BLOKO_QUIZ_DIR` | Folder of the quiz question bank (default `data/quiz/`). |
| `BLOKO_PYRAMIDE_DIR` | Folder of Pyramide's word list (default `data/pyramide/`). |
| `ITLOE_CONTENT=sample` | Play the sample content (`shared/campaign/sample.js`) instead of the birthday story (`shared/campaign/story/`). The end-to-end suites run on it. |
| `ITLOE_CONTENT=minigame:<kind>` | Start at a hub and one tableau with that minigame and its sample settings (`sampleSettings` in its rules), which Pierre starts from his phone, without the story's opening, e.g. `ITLOE_CONTENT=minigame:quiz BLOKO_VAR="$(mktemp -d)" PORT=3199 npm start -- --new`. An unknown kind, or any `ITLOE_CONTENT` value other than these two, refuses to boot. |

If the laptop has several network connections (Wi-Fi + Ethernet, VPN…), `npm start` asks which one the phones are on. Press Enter for the first one.

**Windows with WSL:** phones must reach the *Windows* machine, not the WSL virtual machine.
With WSL's mirrored networking (`networkingMode=mirrored` in `.wslconfig`), the printed address is already the right one.
Otherwise, forward the port from Windows into WSL and start with `BLOKO_HOST=<the Windows Wi-Fi IP>`.
Either way, allow the port through the Windows firewall when asked.

## Hosted production

Until the evening this is a development deployment; a change may break it.

Infrastructure owns the LXC, Node 24 runtime, systemd service, public HTTPS/WebSocket proxy, secrets, backups and deployment timer. The game runs as an unprivileged user, with releases under `/opt/itloe/releases/<commit>`, `/opt/itloe/current` pointing at the active release, and `BLOKO_VAR=/var/lib/itloe` outside the release. The proxy forwards to the guest's private port `3131`; it must suppress URL/Referer-bearing access and error logs for this host.

The service also needs `BLOKO_ADMIN_TOKEN`: without it, nobody can use the admin page or reset the evening. The admin page takes each device's address from the proxy's `X-Real-IP` header, which the proxy overwrites; a client reaching port 3131 directly could set its own, and only Konstantin's machine can. Open `https://itloe.kputnik.com/?token=<shared-secret>` to authorize a browser. The server exchanges the token for a 30-day Secure/HttpOnly cookie and redirects to a clean URL. All HTTP routes and WebSocket upgrades require authorization; WebSockets also require the configured public Origin. The token-bearing join links and QR codes authorize new phones. Everyone with the invitation joins the same evening, with the five predefined character slots. Rotating the configured secret invalidates existing cookies after a restart. Without either public setting, local LAN play stays open.

Pushing to `production` runs [the production workflow](.github/workflows/production.yml): locked dependency install, type-checking, tests, save/resume checks, packaging and an extracted-runtime access test. It then publishes a GitHub Release tagged `prod-<full-commit-sha>` with:

- `itloe-<full-commit-sha>-linux-x64.tar.gz`: `server/`, `shared/`, `public/`, `data/quiz/`, `data/pyramide/`, `package.json`, `package-lock.json`, production `node_modules/`, and `release.json`.
- `SHA256SUMS`: the SHA-256 checksum and archive filename.

`release.json` is `{ "commit": "<full-sha>", "nodeMajor": 24, "platform": "linux", "arch": "x64" }`. Node executes the TypeScript directly. No development tools, saves, raw quiz imports or secrets are packaged. For a manual build on Linux x64 with Node 24, run `npm run release` (or `npm run release -- <commit>`); output is in ignored `dist/release/`. The builder packages **committed files**, so uncommitted edits are not released.

Publishing the completed release is the handover to Infrastructure. Its guest-local timer checks the `production` branch every two minutes and downloads that commit's release by its exact URL, without a GitHub token or public deployment webhook. Failed builds or missing releases leave the current game running; rapid pushes may coalesce into deployment of the newest commit. GitHub Actions uses its built-in `GITHUB_TOKEN` with `contents: write`, with no server credentials.

Infrastructure verifies checksums and the manifest, switches `current`, and restarts. Authenticated `/api/join` (a read-only route), a WebSocket connection and saved-room comparison check startup and report the result; nothing is rolled back on failure. Deployments briefly disconnect clients; they reconnect, though application changes may require a browser refresh.

For deployment readiness, derive the cookie value as hex HMAC-SHA256 with the UTF-8 access token as key and `itloe-access-v1` as message. Send it as `Cookie: __Host-itloe_access=<value>`. The `/ws` upgrade also needs `Origin: https://itloe.kputnik.com`; its first message is a `view`. Never log the `/api/join` response: its `url` contains the invitation token.

## If the server stops

The whole evening is saved after every move. Just run `npm start` again:

- **everything is resumed**: where the party is, who is playing, a game's lobby and who is ready, a round in progress (a timed game keeps its remaining time), the podium, what has been unlocked so far. Phones and the TV reconnect on their own;
- `npm start -- --new` always starts a fresh evening.

To start a fresh evening on the hosted server, open `https://itloe.kputnik.com/?reset=1&admin=<admin token>` and confirm. The server saves a fresh evening, as `--new` would start it, and exits with code 75; the hosted service restarts it after a failure exit, and it loads that evening. Phones and TVs reconnect on their own; players join again with the new code from the TV. Only a browser with the admin token can reset (see `BLOKO_ADMIN_TOKEN`). Run locally, `/?reset=1` only stops the server: start it again with `npm start`.

A phone that goes to sleep or reloads also comes back to its own board automatically.

## Troubleshooting

- **Phones can't open the page.** Check that they're on the same Wi-Fi as the laptop. Guest and hotel networks often block devices from talking to each other ("client isolation"): put the laptop and the phones on a **phone's hotspot** instead.
- **Wrong address in the terminal.** Set `BLOKO_HOST` (see Options).
- **Everything freezes after a while.** The laptop went to sleep: keep it plugged in and turn off sleep while you play.
- **A phone keeps dimming.** Turn off its screen auto-lock for the evening, or just tap it: the game picks up where it was.
- **"That code didn't work."** Use the `room` code printed by the server that's running now: a restart into a fresh evening draws a new one.
- **Finding out what happened.** The admin page, **/admin/** (with `?admin=<admin token>` the first time when the server has one), shows each device's connection, address and last message, the running minigame's state with its answers, the recent actions and whether the server accepted or refused each one, and the errors the phones and TVs reported. It changes nothing. It also downloads the save, and links to the reset.
- **The server refuses to start, listing problems.** The story content or the quiz bank has a mistake: the list says which question or place, and what is wrong.
- **The server refuses to start, naming a minigame.** The save holds a game this version of the game doesn't have, e.g. after going back to an older release. Run a version that has it: the save is left exactly as it was.

## Saved data

Everything lives in `var/` (or `BLOKO_VAR`):

| File | Contents |
|---|---|
| `bloko.state.json` | The evening (party, where you are, the game in progress, what is unlocked), for resuming |
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

Exploratory proposals live in [ideas.md](docs/planning/ideas.md), with usage instructions at the top. Consult it only when requested; ideas are separate from the [backlog](docs/planning/backlog.md).

## For developers

### Architecture

The application runs locally on Node.js 24+, with HTTP and WebSocket traffic on the same port. Node runs the server's TypeScript directly; browsers run JavaScript ES modules directly. There is no build step or external database, and play works without internet access.

| Location | Responsibility |
|---|---|
| `server/` | TypeScript: HTTP, WebSockets, trusted inputs, clocks, persistence, and server integration |
| `shared/` | JavaScript with JSDoc types: reusable game rules, the campaign engine and its story machines, quiz helpers, characters, and scene/sprite helpers |
| `shared/campaign/story/` | The birthday story as data, one file per world: places, rooms, items and story machines ([docs/story-engine.md](docs/story-engine.md)) |
| `public/play/` | Phone interface and controls |
| `public/screen/` | TV interface, rendering, audio, and effects |
| `public/commun/` | Shared browser helpers and CSS |
| `public/sim/` | Development page combining the TV and phone pages |
| `public/admin/` | Admin page: the server's state, recent events and the pages' errors, from `server/admin.ts` |
| `data/quiz/`, `data/pyramide/` | Server-only question banks and Pyramide's word list |
| `test/`, `scripts/` | Node unit tests, end-to-end suites, simulation, and data import tools |

Phones send actions; the server binds them to a player, validates them, runs the shared reducers, and saves and broadcasts accepted changes. The server handles the evening's own messages and passes every other one to the running minigame's server code, listed in `server/minigames.ts` beside the rules list in `shared/minigames.js`. The campaign owns the party and progression, with the running minigame (its lobby, rounds and podiums) nested inside it. Phone placement previews use the same rules as the server and reconcile with its next view.

The phone and the TV each have a frame (`public/play/main.js`, `public/screen/main.js`) around the minigames: the room at a tableau, the map, the cutscenes, the menus, and wisps over a running minigame. The frame mounts a minigame's screens from the game master's start to his end, listed in `public/play/minigames.js` and `public/screen/minigames.js`. Blocks and quiz wrap their round screens (`blocks-ui.js`, `blocks-screen.js`; `quiz-ui.js`, `quiz-screen.js`) in the plain lobby (`plain-lobby.js`), which draws the lobby and the podium and mounts the round screens while a round runs. The screens build their own markup, load their own CSS, and remove their listeners, loops, sounds and timers when they are unmounted.

Rule reducers are deterministic: time and seeds are explicit inputs, and reducers perform no I/O. Refused/no-op actions return the same state object; the server uses object identity to skip change hooks. Accepted state changes flow through `apply`/`commit` in `server/main.ts`, including atomic JSON persistence. A round's result is kept with the running minigame in the same save as its end, and the main game records the results as campaign facts in one save when the minigame ends. Timed games retain their remaining time across restart or laptop suspension.

Positions, presence, and temporary join-QR display state are held in memory rather than saved. Avatar movement is client-authoritative under the protocol; game results and campaign progression are server-authoritative. Reconnection and character reclaim preserve the player's game; the newest socket wins, and a replaced device stops reconnecting.

Both `public/` and `shared/` are publicly served. Quiz bank data stays on the server; the quiz's view uses `projectQuiz`, and the campaign on the wire carries no minigame state, to hide answers and submitted answers/verdicts until reveal. Question IDs and campaign content IDs are stable; inventory and campaign totals follow characters rather than devices. Player capacity comes from the character roster in `shared/characters.js`.

### Code conventions

- ESM throughout, with explicit relative import extensions (`.ts` for TypeScript modules, `.js` for JavaScript modules) and `node:` imports for Node built-ins. Server TypeScript uses syntax compatible with Node's type stripping. Shared rules and client JavaScript use JSDoc types; one strict `tsc` run checks both languages.
- Vanilla HTML/CSS/JavaScript clients and locally served assets. Runtime dependencies are kept small; `package.json` is the current dependency list.
- Two-space indentation, semicolons, and single-quoted JS/TS strings. Functions and variables use `camelCase`, types use `PascalCase`, constants/tables use `UPPER_SNAKE_CASE`, and multiword filenames, CSS classes, and DOM IDs generally use hyphens. Formatting follows neighboring code; there is no configured formatter or linter.
- Small functions, plain data, named exports, and closure-based `create…`/`make…` helpers are common. Existing tables describe pieces, settings, characters, campaign conditions/rewards, and scenes. Shared rule logic runs in Node and browsers; browser-specific common helpers live in `public/commun/`. Some shared assets, such as sprites, also provide rendering helpers.
- Code, comments, docs, and interface wording use English. Quiz questions are intentionally French; story copy is content data. Storage keys and environment variables still use the old `bloko` name.
- UI uses the tokens in `public/commun/base.css` and existing DOM helpers. Boards use DOM/CSS grids; sprites and scenes use canvas. Phone layouts account for touch, keyboards, and safe areas; TV layouts prioritize readability.
- Tests in `test/<topic>.test.js` use `node:test` and `node:assert/strict`, with small fixtures and explicit seeds/times. Most run rules without a server; a few start a real one. Browser scenarios and longer runs over real sockets live in `scripts/e2e-*.mts`.

### Development commands and testing

| Command | What it does |
|---|---|
| `npm run check` | Type-checks everything (`tsc`, including the JSDoc-typed `shared/` and client JS) |
| `npm test` | The tests in `test/` (`node --test`): rules without a server, and a few against a real one |
| `npm start` | The real server (`server/main.ts`, run directly by Node, no build step) |

- **Simulator:** open **/sim/** on a running server: the TV screen plus player phones side by side in one page. The phones get the room code from `/api/join`.
- **Tram 5 scene shortcuts:** run `BLOKO_VAR="$(mktemp -d /tmp/itloe-scene.XXXXXX)" PORT=3199 npm run start:local -- --new`,
  then open `http://127.0.0.1:3199/test/young-adult/tram-5/`. The index lists `base` (day, Shelter closed)
  and `night` (Shelter open, Tschick-Toni gone, Élodie has his crowbar and a Shelter ticket). Opening a preset starts a fresh scratch evening
  at Tram 5 and opens `/sim/` with Élodie ready to play and Pierre as game master in wisp mode. Optional query parameters override the setup:
  `characters=elodie,pierre` (up to four simulator phones), `inventory=elodie:shelter-ticket:1`,
  `flags=young-adult.shelter.open`, `statuses=pierre:wisp`, and `context=base|night`. Separate entries in a
  parameter with commas. These URLs work only on a loopback server using a `/tmp/` save folder and a port
  other than 3131; opening a preset replaces that scratch evening.
- **Hub scene shortcut:** on the same scratch server, open `http://127.0.0.1:3199/test/hub/` and select `base`.
  It opens Élodie’s dream apartment with Élodie, Pierre, Sol and Anna already joined. The same `characters`,
  `inventory`, `flags` and `statuses` overrides apply.
- **End-to-end tests:** the runner requires Linux, Google Chrome at `/usr/bin/google-chrome` (or `CHROME` set to another Chrome/Chromium executable), and `flock` on `PATH` (provided by util-linux). `npm run e2e` runs every suite; `npm run e2e -- quiz phone:4` runs the named ones. Run it in the foreground: it blocks until all are done (a full run takes about 2 minutes), then prints one line per suite (pass or fail, duration, log file), the FAIL lines of a failed suite, and an overall line; it exits non-zero on a failure. It runs the suites in parallel through the machine's shared slots, and does the setup for you: free ports, headless Chrome for the browser suites, a server for `base`, scratch data folders, all removed afterwards, also after Ctrl-C.

  | Suite | Covers |
  |---|---|
  | `base` | a running server over sockets: room code, join, avatar positions, the lobby, moves, rejoin and replaced sockets, Play again, the end, leaving |
  | `resume` | kill -9 in the room, the lobby, a round and on a podium, timed clock kept, results recorded once at the end |
  | `presence` | reclaim a character, newest device wins, the game master's round controls |
  | `campaign` | false start → unlocks → news acked by two TVs → doors, kill -9 at each step; chat, emotes and object actions (relay, history, rate limits, where interact works); `pos` while a minigame runs dropped unless from a wisp |
  | `inventory` | rewards land in the right inventory (chooser / winner / all), survive kill -9 and a reclaim; the game master's give/take, unknown items refused |
  | `quiz` | quiz over real sockets: no answer on the wire before the reveal, judging, override, resume (plays a fixed copy of `placeholder.json`) |
  | `pyramide` | Pyramide in headless Chrome (four phones, a TV): a classic round and a bidding duel played through the phones' forms, from the lobby's spots to the podium; the word in play on its clue givers' phones and on no guesser's phone or TV screen; a clue giver reconnecting mid-word (plays a fixed word bank) |
  | `backgammon` | Backgammon in headless Chrome (four phones, a TV): a move by each side through the phones' taps (the checkers marked movable and the points lit match the rules, on that phone only; the server applies the tapped move; the TV and the phone draw the board as the server has it; Undo, Done, Roll), then the group phase's three rounds played through the phones' sockets, the results between rounds and Pierre's button, to the podium ranked as the standings |
  | `tv` | the TV page in headless Chrome: the minigame's lobby, the room again after its end, the minigame screens' teardown; one section: `tv:<section>` |
  | `phone` | phone pages in headless Chrome: session never lost, reclaim, the minigame's lobby, the game master's round controls, campaign screens, quiz and the screens' teardown, room code, wisps over a minigame; one part: `phone:<n>` |

  The suite's header lists its sections or parts, and the suite refuses an unknown one with the list. A browser suite fails when one of its pages throws an uncaught exception. `--shots <dir>` saves the TV and phone screens, each with its visible text, to `<dir>/<suite>`. `LOCK_MS` (how long the phone suite freezes a locked phone: 20 s in the runner, 5 min in the suite alone) and `E2E_SLOW=3` (multiplies every wait on a busy machine) pass through. The `e2e:<suite>` scripts run one suite bare, as CI does, with the caller's `PORT`.

  To check that screens didn't change: take a reference with `npm run e2e -- --shots <ref> tv phone` on the base, then `npm run e2e -- --shots <dir> --compare <ref> tv phone` on your change. It lists each screen that differs, most changed first, with its share of changed pixels and its text diff, and saves `<screen>.diff.png` next to the new screenshot. It judges nothing: two runs of the same code also differ in random content (room codes, QR codes, quiz questions, scores, animation phases), so look at what differs.

- **Storyboard:** `node scripts/storyboard.mts [sequence…]` plays the evening's sequences (the opening, Young Adult, a quiz, Pyramide, edge moments, backgammon) on a scratch server and writes `shots/storyboard/storyboard.html`: one slide per moment, with the TV and the phones side by side, as one file to send. Screens the game already draws are captured; planned ones are mockups, marked as such. The sequences live in [`scripts/storyboard/sequences.mts`](scripts/storyboard/sequences.mts): when the game starts drawing a planned screen, replace its mockup with the steps that reach it.
- **Checking by hand from a script:** [`scripts/drive.mts`](scripts/drive.mts) starts a server on any content (e.g. `minigame:quiz`, a free port, a scratch save folder) and opens a TV and phones in headless Chrome, each phone a separate device. Your script joins characters, taps by visible label or selector, types, waits for text or a condition, reads the screens and takes screenshots, and sends a phone's messages through its own connection (`send`, through the socket the test-only `SOCKET_PROBE` records), e.g. to play many moves quickly; the server, Chrome and scratch folder go on close, on a failure or on Ctrl-C. The file's header shows a round; run the script with `node` in the foreground.

### Further reading

- [docs/story-engine.md](docs/story-engine.md): the campaign engine and the story as data (Contract D v3): places, story machines (scenes, NPCs, quests, offers), and how to add to the story. Read it before touching story content or code that reads the campaign.
- [docs/minigames.md](docs/minigames.md): adding a minigame: its parts and its lobby, registration lines, what the main game hands it, what shared code offers, the development start and tests.
- [PROTOCOL.md](PROTOCOL.md): WebSocket messages, HTTP endpoints, trusted inputs, view filtering, and compatibility rules.
- [SPEC-BLOCKS.md](SPEC-BLOCKS.md): original block-game design and technical direction.
- [AGENTS.md](AGENTS.md): instructions for coding agents working in this repository.

The spec includes earlier designs and examples. Quizzes introduce hidden answers and French content; the current wire format uses `t` messages as documented in `PROTOCOL.md`. For a change to a shared contract, compare its documentation with the current implementation and tests and resolve any discrepancy explicitly.

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

Several agents on devbox run end-to-end suites at the same time. `npm run e2e` runs each suite through `scripts/e2e-slot.sh`, which waits for one of three slots shared by every run on the machine (`E2E_SLOTS` changes the number), so the suites run side by side without overloading it.
