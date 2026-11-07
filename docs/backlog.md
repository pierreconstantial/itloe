---
purpose: The curated list of known follow-up work for Itloe that nobody has started yet, for Konstantin and Pierre to pick from.
audience: Konstantin, Pierre, and the agents working for them
maintainer: Konstantin and Pierre
kind: brief
---

# Backlog

Work someone noticed but nobody has started. Pick an item, then delete its row and its section in the same change that does it. Work in progress gets its own brief; its row here says so until it's done.

- **Priority:** P1 matters for the evening; P2 should be done; P3 is nice to have.
- **Status:** Open, Needs decision, or In progress (with a link to its brief).
- **Complexity:** a rough size, by how many places in the code it touches:
  - Trivial: one place;
  - Low: a few places in one area;
  - Medium: several files across layers;
  - High: many places across the server, the campaign engine and both clients.

## Summary

| Item | Description | Priority | Status | Complexity |
|---|---|---|---|---|
| [Lock and invitation on real phones](#lock-and-invitation-on-real-phones) | Locking a phone, and the invitation in a phone's browser, are never tested | P1 | Open | Low |
| [Story opening in a browser test](#story-opening-in-a-browser-test) | No browser test plays the opening past its block game | P1 | Open | Low |
| [Pyramide in the story](#pyramide-in-the-story) | Pyramide has no tableau in the story yet | P1 | Needs decision | Low |
| [Apartment drawings cover avatars](#apartment-drawings-cover-avatars) | The cats, friends, keepsakes and key are always drawn over avatars | P2 | Open | Low |
| [Backgammon's restart and hidden dice untested](#backgammons-restart-and-hidden-dice-untested) | No test resumes a backgammon round or checks its view hides the dice | P2 | Open | Low |
| [Questions of a dropped round come back](#questions-of-a-dropped-round-come-back) | A round dropped by `back` or `goto` doesn't use up its questions or words | P2 | Open | Low |
| [Join QR card covers minigame screens](#join-qr-card-covers-minigame-screens) | On the TV the card covers Pyramide, backgammon and the lobby's panel | P2 | Open | Trivial |
| [TV frame cost unmeasured](#tv-frame-cost-unmeasured) | The room redraws everything at 60 fps; nobody measured it on the evening's laptop | P2 | Open | Low |
| [Guests controlling NPCs](#guests-controlling-npcs) | Players controlling Marokkanergasse's NPCs, Nico and Mathieu | P3 | Needs decision | High |
| [Room before the content arrives](#room-before-the-content-arrives) | A reloaded phone walks the party room until the content loads | P3 | Open | Low |
| [Debug accessors show only the party room](#debug-accessors-show-only-the-party-room) | `bloko.drawOrder()` and `bloko.scene()` ignore the apartment and Young Adult's rooms | P3 | Open | Trivial |
| [Apartment sofa sparkle](#apartment-sofa-sparkle) | The sofa's sparkle overlaps its "Comfy!" bubble in the apartment | P3 | Open | Trivial |
| [Smarter guess check in Pyramide](#smarter-guess-check-in-pyramide) | A correct guess with a spelling mistake counts as wrong | P3 | Needs decision | Low |
| [Minigame wording in shared folders](#minigame-wording-in-shared-folders) | Block and quiz files in `public/commun/`, block files with generic names | P3 | Open | Low |
| [Screen comparison flags random content](#screen-comparison-flags-random-content) | `--compare` lists room codes, QR codes, questions and scores as changes | P3 | Open | Medium |
| [Two kinds of round in backgammon](#two-kinds-of-round-in-backgammon) | Backgammon's rounds of games share the word "round" with a minigame's round | P3 | Needs decision | Low |
| [Pyramide's interrupted round and hyphenated guesses](#pyramides-interrupted-round-and-hyphenated-guesses) | A round ended at 0–0 goes to team 2; "grandmère" is refused for "grand-mère" | P3 | Open | Low |
| [Blocks preview undone by other players](#blocks-preview-undone-by-other-players) | Another player's update puts a dropped piece back in the tray for a moment | P3 | Open | Low |
| [TV after a reconnect](#tv-after-a-reconnect) | A stray socket, avatars gliding in, quiz sounds for what it missed | P3 | Open | Medium |
| [Confetti cut short](#confetti-cut-short) | Backgammon's and the rewards' confetti vanish with the next update | P3 | Open | Trivial |
| [Phone updates reset the chat and Leave](#phone-updates-reset-the-chat-and-leave) | Every update scrolls the chat down and disarms "Leave evening" | P3 | Open | Low |
| [Full game reported as another phone](#full-game-reported-as-another-phone) | During a minigame, a full roster reads "back online on another phone" | P3 | Open | Trivial |
| [Quiz out of questions](#quiz-out-of-questions) | Start is refused with the generic "That can't be done right now" | P3 | Open | Low |
| [Admin page open on a LAN server](#admin-page-open-on-a-lan-server) | Without `BLOKO_ADMIN_TOKEN`, every LAN guest is an admin | P3 | Open | Trivial |
| [Walking state in the server](#walking-state-in-the-server) | Positions, doors, spots and placement each reset in their own place in `server/main.ts` | P3 | Open | Medium |
| [Round clock and ranking per minigame](#round-clock-and-ranking-per-minigame) | Each round's rules write their own clock and result ranking | P3 | Open | Medium |
| [Round screens' helpers and wording](#round-screens-helpers-and-wording) | DOM helpers, countdowns and wording repeated across screens and between phone and TV | P3 | Open | Low |
| [Three meanings of round in the server](#three-meanings-of-round-in-the-server) | `server/round.ts` calls a whole run of a minigame a round | P3 | Open | Low |
| [Dead code](#dead-code) | Screens only Pierre's phone shows, unused exports and CSS, a duplicate range check | P3 | Open | Low |

## Items

### Lock and invitation on real phones

On the evening, phones lock and unlock all the time. The phone suite's "phone locked … → unlock resumes" check is skipped (`e2e-phone` part 1 prints a SKIP): headless Chrome doesn't freeze a page with `Page.setWebLifecycleState('frozen')`, so the unlock path, the `resume` probe on a stale socket, never runs. The other reconnect checks pass.

Every guest also goes through the access gate of the hosted game: the invitation's token, then the access cookie. No browser test does: `test/hosting.test.js` checks the gate with plain HTTP requests and WebSocket connections, and the browser suites run without it.

**Recommendation:** test both by hand on real phones, an iPhone and an Android, during the next manual test on the hosted game:
- lock mid-game for a few minutes, with and without the server restarting meanwhile, then unlock;
- open the invitation, close the browser completely, then reopen the game: it loads without the invitation.

Automate the lock only if a way to freeze a page in headless Chrome turns up.

### Story opening in a browser test

The e2e suites run the sample content (`ITLOE_CONTENT=sample`), except `e2e-phone` part 8, which plays the opening's block game on the story content, with wisps over it. The rest of the birthday opening (the portal, the apartment, the key, the door to Young Adult and back) has only the reducer tests in `test/story.test.js` and one happy path over raw sockets in `test/story-wire.test.js`, which puts the player on the portal instead of walking there. The storyboard (`scripts/storyboard/sequences.mts`) drives the opening on a TV and phones through the portal, the apparition and the key into Young Adult, but it checks nothing, never comes back, and never restarts the server. No test draws the apartment or Tram 5 on a TV, plays the apparition cutscene, or restarts the server during the opening. The door reachability test in `test/movement.test.js` checks only the sample's doors in the party room.

**Recommendation:** one browser scenario on the story content, starting from the storyboard's steps: a TV and four phones play the opening's block game, Pierre ends it, Élodie walks through the portal, picks up the key, walks through the door to Young Adult and comes back, with a kill -9 in the middle. Point the door reachability test at the story's rooms too.

### Pyramide in the story

Pyramide has no place in the story yet: it runs from its development start only (`ITLOE_CONTENT=minigame:pyramide`), and no tableau of the birthday story names it. `GameStory.md` places it at Marokkanergasse (`young-adult/appart-pierre`, "Young Adult game flow"): Élodie starts it by talking to the people there, and after it the Adult Age key (`young-adult-adult-key`, already in the catalogue) lies on the floor. Its eligible players come from the tableau's content, so the tableau also decides who may play. The intended four are Élodie, Nico, Pierre and Sol; a story wisp the tableau names, as Nico is before his reunion, plays as their character (`GameStory.md`, "Reunions").

This is Pierre's content.

**Recommendation:** Pierre decides who plays, and whether ending it introduces Nico (`person.nico.unlocked`). Then add its tableau under Marokkanergasse in `shared/campaign/story/young-adult.js`, with a machine that offers it and leaves the key on the floor after it, and a test in `test/story.test.js` that plays the sequence.

### Apartment drawings cover avatars

In the apartment, the cats, friends, keepsakes and the key are drawn after the depth-sorted list of props and avatars (`public/screen/party-room.js`). An avatar walking in front of a cat still has the cat drawn over it.

**Recommendation:** make them props of the apartment's scene (`apartment-room` in `shared/campaign/story/hub.js`), so they sort with the avatars like the party room's furniture.

### Backgammon's restart and hidden dice untested

`test/backgammon.test.js` never resumes a round through `loadCampaign` (a restart) and never shifts its deadline, and nothing checks that backgammon's view leaves out `seed` and `rolls` (`server/backgammon.ts`), without which a phone could predict the dice. The campaign suite checks that the campaign's own seed stays off the wire; backgammon's view isn't checked.

**Recommendation:** add both to `test/backgammon.test.js`, as `test/pyramide.test.js` does for its words; the same for table football once it has a clock.

### Questions of a dropped round come back

`askedSoFar` (`shared/campaign/index.js`) counts only finished rounds. When the game master leaves a tableau or takes the party elsewhere (`back`, `gm goto`) while a round runs, the questions that round showed, or the Pyramide words it drew, aren't used up and can come up again that evening.

**Recommendation:** when a running round is dropped, record what it asked in `facts.asked`; each round's rules know it (the quiz's shown questions, Pyramide's drawn words).

### Join QR card covers minigame screens

The join QR card sits fixed at the TV's bottom right, above everything. Only `public/screen/blocks.css` and `public/screen/quiz.css` leave room for it, so when someone shows the QR it covers Team 2's pyramid, backgammon's second board and the plain lobby's panel. Inferred from the CSS, not seen.

**Recommendation:** one rule in the frame (on `#app`) in place of the two per-minigame ones.

### TV frame cost unmeasured

For most of the evening the TV's room redraws everything 60 times a second: about 800 furniture rectangles pixel by pixel (`public/screen/party-room.js`; sprites, by contrast, are cached as bitmaps in `shared/sprites.js`), each door plaque measured again, each name label reading the page's computed style (`public/screen/avatar-layer.js`), and the wisp overlay building its room each frame (`public/screen/main.js`). Nobody has measured whether the evening's laptop keeps up.

**Recommendation:** measure the frame time on that laptop with four phones walking. If it's tight: cache the furniture like the sprites, read the player colours once, build the overlay's room once per minigame.

### Guests controlling NPCs

`GameStory.md` ("Young Adult game flow") has Nico and Mathieu at Marokkanergasse as NPCs "who may be controlled by connected players". Elsewhere, guests beyond the opening's four join as wisps until the story introduces their character, and a wisp can't use NPCs. Nothing says who controls an NPC, how they take it, or what they can do with it, so nothing prepares for it yet.

**Recommendation:** Pierre decides what controlling an NPC means there; then design how a player takes one, which phone screens they get, and what the server lets them do.

### Room before the content arrives

Phones and the TV use the bundled sample content until `/api/content` answers, and the sample names no rooms. So a phone reloaded at the hub walks the party room's furniture until the content arrives, then the apartment's. If the request fails, it stays wrong until the content loads.

**Recommendation:** check on real phones during the manual test whether anyone notices. If it matters, send the node's room with the view, or wait for the content before enabling the joystick.

### Debug accessors show only the party room

The TV's debug accessors `bloko.drawOrder()` and `bloko.scene()` report `PARTY_ROOM` even in the apartment or Young Adult's rooms, so `e2e-tv` can't check depth there.

**Recommendation:** pass the room on screen instead of `PARTY_ROOM` in `party.drawOrder()` and `party.scene()` (`public/screen/party-room.js`), now that the TV knows each node's room.

### Apartment sofa sparkle

The sofa's object-action sparkle is placed for the party room's narrow sofa. In the apartment, where the sofa is stretched 1.7×, it overlaps the "Comfy!" bubble.

**Recommendation:** place the effect from the prop's box.

### Smarter guess check in Pyramide

A guess matches only if it equals the word once case, accents, surrounding spaces and a leading article are ignored (`judgeGuess` in `server/pyramide.ts`). "Char" is not "chat", and neither are a plural or a typo.

**Recommendation:** leave it unless the exact match proves insufficient in play. Then replace `judgeGuess`, the one place that judges, by a cheap LLM check that falls back to the exact match when the model is unavailable; keep the verdict server-side.

### Minigame wording in shared folders

`public/commun/settings-text.js` and `public/commun/quiz-text.js` are the block game's and the quiz's own wording, shared between phone and TV, but they sit in the shared folder. `public/screen/fx.js` holds block-only effects next to the confetti the frame uses, and `public/commun/screen-main.css`, which every TV page loads, holds about 120 lines of block-only effect styles.

The block game's TV files also have generic names that hide whose they are: `public/screen/game-view.js` and `public/screen/countdown.js`.

**Recommendation:** move each minigame's wording and effects next to its own files, and give its files its name, so `public/commun/` and the frame's `fx.js` name no minigame and a reader can tell a minigame's files at a glance.

### Screen comparison flags random content

Every `npm run e2e -- --compare` run differs from its reference in random content: the room code (`newRoomCode` in `server/store.ts`) and the join URL's free port, both in the join QR code, and the campaign seed (`Date.now()` in `freshGame`, `server/store.ts`), so the quiz questions, the pieces and the scores. Each changed screen has to be looked at by eye, and real changes hide among them. No shot catches the urgent block countdown or the urgent quiz ring.

**Recommendation:** in `--shots` runs, start the server with a fixed room code and campaign seed, so a comparison lists only real changes. Animation phases and the join URL's port stay random, so `--compare` might also ignore differences below a small share of pixels. Consider a shot of each urgent state.

### Two kinds of round in backgammon

A minigame's round is one play from its start to its podium ([minigames.md](minigames.md), "Terms"). Backgammon's round is its whole group phase, made of rounds of games: the boards played at the same time, which the players see as "Round 2 of 3". Its code calls those `round` and `nextRound` too ([`shared/backgammon.js`](../shared/backgammon.js)), so one word names two things.

**Recommendation:** keep "Round" in what players see, and give the rounds of games their own name in the code and docs.

### Pyramide's interrupted round and hyphenated guesses

- A classic round's tie-break is fewer bricks used, and team 1 always plays first. A round ended at 0–0 after team 1's first clue (the game master's End game, or someone leaving) is won by team 2 (`shared/pyramide.js`). It matters once a Pyramide tableau gives a `winner` reward.
- The guess check (`judgeGuess` in `server/pyramide.ts`) keeps spaces, while the clue check (`squash` in `shared/pyramide.js`) removes them: "grandmère" is refused as a guess for "grand-mère". Five words in the bank have hyphens.

**Recommendation:** a round ended with no word found has no winner; guesses and clues compare words the same way (see also [Smarter guess check in Pyramide](#smarter-guess-check-in-pyramide)).

### Blocks preview undone by other players

The phone clears a dropped piece's preview on any update (`public/play/blocks-ui.js`). If another player's update arrives first, the piece pops back into the tray for one round trip, and can be dragged again. `place` names only the slot, so if the first drop emptied the hand and a new one was dealt, the second drop places a different piece than the one dragged. Inferred, not reproduced.

**Recommendation:** keep the preview until this player's own last placement (`last.n`) moves on, or an `err` arrives.

### TV after a reconnect

- `public/screen/main.js` has its own copy of the phone's connection (`public/play/connection.js`), and it has diverged: its retry timer is never cancelled, so a close followed within a second by a wake or the watchdog opens two sockets and abandons one, which stays open as a stranger on the admin page.
- After every reconnect or laptop wake, avatars glide in from their spawn points: the server sends the view before the positions, and only one of the TV's two avatar layers (the room's, and the one over minigames, kept in step by hand) is reset. Players walking over a minigame also glide in from where they stood in the previous one.
- The quiz's TV screen plays its start and reveal sounds for what it missed while disconnected (`public/screen/quiz-screen.js` ignores `io.continuous`).

**Recommendation:** one connection module in `public/commun/` for both clients; one avatar layer that places an avatar at its first position instead of gliding; the plain lobby plays a round's start sound when it mounts the round, for every minigame.

### Confetti cut short

Backgammon's TV screen adds its confetti inside its stage (`public/screen/backgammon-screen.js`), which the next update replaces, while `fx.confetti` survives updates. After a minigame ends, the reward cutscene's confetti is cleared by the next update in the room (`fx.clearAll` in `public/screen/main.js`).

### Phone updates reset the chat and Leave

Every update renders the chat again (`social.render()` in `public/play/main.js`), which scrolls it to the bottom: someone reading back is pulled down whenever anyone acts. Every update also disarms "Leave evening"'s second tap (`public/play/menu.js`).

**Recommendation:** render the chat when a message arrives; keep the confirmation armed across updates.

### Full game reported as another phone

While a minigame runs, the server refuses a join for a character held by an online member with `full`, and the phone reads `full` during a minigame as "That character is back online on another phone" (`joinRefusal` in `server/main.ts`, the `err` handling in `public/play/main.js`). So when the roster really is full during a minigame, the phone says the wrong thing.

**Recommendation:** `taken` for a held character, `full` only for a full roster; both special cases go.

### Quiz out of questions

When no question is left for the quiz's settings, Start is refused with the generic "That can't be done right now". The phone can't know beforehand, since the bank stays on the server.

**Recommendation:** a refusal code of its own, which the game master's phone words ("No questions left for these settings").

### Admin page open on a LAN server

Without `BLOKO_ADMIN_TOKEN`, a LAN server (no `BLOKO_PUBLIC_ORIGIN`) treats every request as an admin's (`isAdmin` in `server/access.ts`): any guest can open `/admin/` and see the quiz answers and Pyramide's words, or reset the evening. The hosted server requires the token.

**Recommendation:** if the evening falls back to a LAN server, set the token.

### Walking state in the server

`server/main.ts` keeps positions, the door each walker stands in, the spot under each walker and who a walkable lobby has placed, each reset at its own point; standing in the portal when it opened sent Élodie through because one of them wasn't re-read. `main.ts` also loads the save and starts listening as soon as it is imported, so none of this can be unit-tested, and the portal fix (re-reading doors when a minigame starts or ends) has no permanent test.

**Recommendation:** a `server/walking.ts` that owns walking (a position, a tapped spot, each change, a closed socket) with unit tests, about 150 of `main.ts`'s lines.

### Round clock and ranking per minigame

Each round's rules still write their own clock (`deadline`, `deadlineAction`, `shiftDeadline`, and refusing a stale deadline; Pyramide and table football write placeholders) and build their result's ranking themselves. The block game's settings don't use the shared merge (`shared/settings.js`).

**Recommendation:** the plain lobby owns the clock (the round says what happens when time runs out) and builds the ranking with the shared rule (`shared/ranking.js`); blocks moves onto `shared/settings.js`. Worth it when a new minigame would otherwise copy them again.

### Round screens' helpers and wording

- A small `el()` DOM helper is written in four phone files (`quiz-ui.js`, `pyramide-ui.js`, `backgammon-ui.js`, `podium.js`), next to the TV's `h()` in `public/screen/dom.js`.
- A countdown from the server's deadline is written three times on each side.
- "The last message, refused by an `err` until the next update" is identical in `pyramide-ui.js` and `backgammon-ui.js`.
- The phone and the TV each write the plain lobby's `names` and `lastWinners`, backgammon's stamps, settings summary and `totalRounds`, and Pyramide's mode names.

**Recommendation:** one DOM helper and one countdown for both clients; each minigame's wording once for phone and TV, placed as [Minigame wording in shared folders](#minigame-wording-in-shared-folders) says.

### Three meanings of round in the server

`server/round.ts` (`Round`, `roundOf`, `openRound`) and `main.ts`'s `round` mean one run of a minigame, from the game master's start to his end; `roundOf` doesn't change between rounds. `roundDeadline`, `shiftRound` (`server/resume.ts`) and `resumeRound` (`server/store.ts`) work on the running minigame. The documents and the plain lobby mean one round, start to podium.

**Recommendation:** rename the first to `run…` and the second to `minigame…`.

### Dead code

- Screens only Pierre's phone ever shows: a player out of a round becomes a wisp, and their minigame screens unmount, so blocks' game-over screen (`public/play/blocks-ui.js`, about 45 lines), the quiz's "taken out" state and backgammon's "You're out of this game." reach the game master only.
- `THRESHOLDS` in `shared/quiz/judge-local.js`, most of `server/rules.ts`, the `ranking` re-export in `shared/game.js`.
- CSS: `.settings-line` and `@keyframes pop-in` in `public/commun/screen-main.css`; `.quiz-title` and `.lobby > .quiz-credits` in `public/screen/quiz.css`.
- `startFoosball` (`shared/foosball.js`) checks the player range that the plain lobby now enforces from its `players`.
- Apartment drawing in `public/screen/party-room.js` that its painted background replaced (`paintTerrace` and the sofa stretch): check what is still reachable after the story engine.
