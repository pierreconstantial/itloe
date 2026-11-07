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
| [Guests controlling NPCs](#guests-controlling-npcs) | Players controlling Marokkanergasse's NPCs, Nico and Mathieu | P3 | Needs decision | High |
| [Room before the content arrives](#room-before-the-content-arrives) | A reloaded phone walks the party room until the content loads | P3 | Open | Low |
| [Debug accessors show only the party room](#debug-accessors-show-only-the-party-room) | `bloko.drawOrder()` and `bloko.scene()` ignore the apartment and Young Adult's rooms | P3 | Open | Trivial |
| [Apartment sofa sparkle](#apartment-sofa-sparkle) | The sofa's sparkle overlaps its "Comfy!" bubble in the apartment | P3 | Open | Trivial |
| [Smarter guess check in Pyramide](#smarter-guess-check-in-pyramide) | A correct guess with a spelling mistake counts as wrong | P3 | Needs decision | Low |
| [Minigame wording in shared folders](#minigame-wording-in-shared-folders) | Block and quiz files in `public/commun/`, block files with generic names | P3 | Open | Low |
| [Screen comparison flags random content](#screen-comparison-flags-random-content) | `--compare` lists room codes, QR codes, questions and scores as changes | P3 | Open | Medium |
| [Two kinds of round in backgammon](#two-kinds-of-round-in-backgammon) | Backgammon's rounds of games share the word "round" with a minigame's round | P3 | Needs decision | Low |

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

`public/commun/settings-text.js` and `public/commun/quiz-text.js` are the block game's and the quiz's own wording, shared between phone and TV, but they sit in the shared folder. `public/screen/fx.js` holds block-only effects next to the confetti the frame uses.

The block game's TV files also have generic names that hide whose they are: `public/screen/game-view.js` and `public/screen/countdown.js`.

**Recommendation:** move each minigame's wording and effects next to its own files, and give its files its name, so `public/commun/` and the frame's `fx.js` name no minigame and a reader can tell a minigame's files at a glance.

### Screen comparison flags random content

Every `npm run e2e -- --compare` run differs from its reference in random content: the room code (`newRoomCode` in `server/store.ts`) and the join URL's free port, both in the join QR code, and the campaign seed (`Date.now()` in `freshGame`, `server/store.ts`), so the quiz questions, the pieces and the scores. Each changed screen has to be looked at by eye, and real changes hide among them. No shot catches the urgent block countdown or the urgent quiz ring.

**Recommendation:** in `--shots` runs, start the server with a fixed room code and campaign seed, so a comparison lists only real changes. Animation phases and the join URL's port stay random, so `--compare` might also ignore differences below a small share of pixels. Consider a shot of each urgent state.

### Two kinds of round in backgammon

A minigame's round is one play from its start to its podium ([minigames.md](minigames.md), "Terms"). Backgammon's round is its whole group phase, made of rounds of games: the boards played at the same time, which the players see as "Round 2 of 3". Its code calls those `round` and `nextRound` too ([`shared/backgammon.js`](../shared/backgammon.js)), so one word names two things.

**Recommendation:** keep "Round" in what players see, and give the rounds of games their own name in the code and docs.
