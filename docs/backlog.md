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
| [Story opening in a browser test](#story-opening-in-a-browser-test) | No test plays the birthday opening on a TV and phones | P1 | Open | Low |
| [Apartment drawings cover avatars](#apartment-drawings-cover-avatars) | The cats, friends, keepsakes and key are always drawn over avatars | P2 | Open | Low |
| [A room per character at the hub](#a-room-per-character-at-the-hub) | Should the others stay in the party room while Élodie is in the apartment? | P2 | Needs decision | Medium |
| [Story rules in shared code](#story-rules-in-shared-code) | The opening's rules are spread through shared code | P2 | Needs decision | High |
| [Ids in client code](#ids-in-client-code) | Node, character and item ids written into the clients | P2 | Open | Low |
| [Other guests in other roles](#other-guests-in-other-roles) | Guests beyond the four players, e.g. controlling NPCs or in games | P3 | Needs decision | High |
| [Room before the content arrives](#room-before-the-content-arrives) | A reloaded phone walks the party room until the content loads | P3 | Open | Low |
| [Unknown content setting](#unknown-content-setting) | An unknown `ITLOE_CONTENT` silently starts the story | P3 | Open | Trivial |
| [Four-player check written twice](#four-player-check-written-twice) | The phone and the server each count the opening's players | P3 | Open | Trivial |
| [Pickup handles one item](#pickup-handles-one-item) | `collect` only knows the first key | P3 | Open | Low |
| [TV lobby band parameters](#tv-lobby-band-parameters) | `renderLobby` takes two option objects side by side | P3 | Open | Trivial |
| [Protocol differences](#protocol-differences) | `PROTOCOL.md` disagrees with the code in three places | P3 | Open | Trivial |
| [Debug accessors show only the party room](#debug-accessors-show-only-the-party-room) | `bloko.drawOrder()` and `bloko.scene()` ignore the apartment and door #4's room | P3 | Open | Trivial |
| [Apartment sofa sparkle](#apartment-sofa-sparkle) | The sofa's sparkle overlaps its "Comfy!" bubble in the apartment | P3 | Open | Trivial |
| [Portal drawn after use](#portal-drawn-after-use) | The TV still draws the used portal at the false start | P3 | Open | Trivial |
| [Shared urgent keyframes](#shared-urgent-keyframes) | `blocks.css` and `quiz.css` both define `@keyframes urgent` | P3 | Open | Trivial |
| [Minigame wording in shared folders](#minigame-wording-in-shared-folders) | Block and quiz files in `public/commun/`, block files with generic names | P3 | Open | Low |
| [Debug view of a running screen](#debug-view-of-a-running-screen) | Nothing shows what a minigame's TV screen draws | P3 | Open | Low |
| [GameStory.md frontmatter](#gamestorymd-frontmatter) | The story document lacks the standard frontmatter | P3 | Open | Trivial |

## Items

### Lock and invitation on real phones

On the evening, phones lock and unlock all the time. The phone suite's "phone locked … → unlock resumes" check is skipped (`e2e-phone` part 1 prints a SKIP): headless Chrome doesn't freeze a page with `Page.setWebLifecycleState('frozen')`, so the unlock path, the `resume` probe on a stale socket, never runs. The other reconnect checks pass.

Every guest also goes through the access gate of the hosted game: the invitation's token, then the access cookie. No browser test does: `test/hosting.test.js` checks the gate with plain HTTP requests and WebSocket connections, and the browser suites run without it.

**Recommendation:** test both by hand on real phones, an iPhone and an Android, during the next manual test on the hosted game:
- lock mid-game for a few minutes, with and without the server restarting meanwhile, then unlock;
- open the invitation, close the browser completely, then reopen the game: it loads without the invitation.

Automate the lock only if a way to freeze a page in headless Chrome turns up.

### Story opening in a browser test

Every e2e suite runs the sample content (`ITLOE_CONTENT=sample`). The birthday opening (the match, the portal, the apartment, the key, door #4 and back) has only the reducer tests in `test/story.test.js` and one happy path over raw sockets in `test/story-wire.test.js`, which puts the player on the portal instead of walking there. No test draws the apartment or door #4's room on a TV, plays the apparition cutscene, or restarts the server during the opening. The door reachability test in `test/movement.test.js` checks only the sample's doors in the party room.

**Recommendation:** one browser scenario on the story content: a TV and four phones play the opening match, Élodie walks through the portal, picks up the key, enters door #4 and comes back, with a kill -9 in the middle. Point the door reachability test at the story's rooms too.

### Apartment drawings cover avatars

In the apartment, the cats, friends, keepsakes and the key are drawn after the depth-sorted list of props and avatars (`public/screen/party-room.js`). An avatar walking in front of a cat still has the cat drawn over it.

**Recommendation:** make them props of the apartment's scene (`APARTMENT_ROOM`), so they sort with the avatars like the party room's furniture.

### A room per character at the hub

Before each node named its room (`roomAt`, see `docs/minigames.md`), Élodie walked the apartment at the hub after the portal, while the other players stayed "in the old lobby": their phones walked the party room, and the TV hid them unless a game master set `person.<id>.unlocked`. A node's room puts everyone at the hub in the apartment; who may walk and who is drawn stay the story's rules, so the others remain hidden as before.

**Recommendation:** Pierre decides whether the others being somewhere else is a story moment. If it is, the story needs a rule for who is in which room, which a room chosen by node can't express.

### Story rules in shared code

The opening's rules are branches on `STORY_MODE` / `storyId === 'elo-50'` spread through shared code:
- `server/main.ts`: `walk`, `pos`, `interact`, `back`, `start`, `again`;
- the campaign reducer, `shared/campaign/index.js`: who may `enter` and `back`, `portal`, `collect`, and `ack` setting `apparition.seen`;
- `public/play/main.js` (about ten places), `public/screen/main.js`, and the hints in `public/screen/doors.js`.

Each new story step adds more branches in all three layers.

**Recommendation:** decide with Pierre where story rules live before the story grows. Two options:
- story steps as content data, read by generic engine code;
- one story module per layer that shared code calls at a few named points.

[Ids in client code](#ids-in-client-code) and [Four-player check written twice](#four-player-check-written-twice) would fold into it.

### Ids in client code

The clients write content ids into code: node ids (`'hub.false-start'`, `'hub.door4'`), the character `'elodie'` where `content.chooser` exists, and the item `'memory-key-intro'`. Renaming a node or item in the content breaks the clients silently.

**Recommendation:** read them from the content (`content.start`, `content.chooser`, item ids from the node that offers them). Do it together with [Story rules in shared code](#story-rules-in-shared-code) if that goes ahead.

### Other guests in other roles

The party is the four players Pierre, Élodie, Sol and Anna. Other guests may later join in other roles, e.g. controlling NPCs or taking part in games, but the details are undecided, so nothing prepares for it yet.

**Recommendation:** decide the roles first, then design how such a guest joins, which phone screens they get, and what the server lets them do. The roster stays at the four players either way.

### Room before the content arrives

Phones and the TV use the bundled sample content until `/api/content` answers, and the sample names no rooms. So a phone reloaded at the hub walks the party room's furniture until the content arrives, then the apartment's. If the request fails, it stays wrong until the content loads. Before a node's room, the phone chose the room from the campaign's flags, which come with the first view.

**Recommendation:** check on real phones during the manual test whether anyone notices. If it matters, send the node's room with the view, or wait for the content before enabling the joystick.

### Unknown content setting

`server/campaign.ts` starts the story for any `ITLOE_CONTENT` value other than `sample` or `minigame:<kind>`, without a warning. A typo such as `ITLOE_CONTENT=smaple` silently starts the story.

**Recommendation:** refuse unknown values at boot, listing the accepted ones, as `minigame:<kind>` already does for unknown kinds.

### Four-player check written twice

The opening requires four players before its first game. The phone and the server each count them, so the rule lives in two places.

**Recommendation:** one shared function, or a `required` value in the content that both read.

### Pickup handles one item

The campaign's `collect` action accepts only `memory-key-intro`, at the hub. Each further item to pick up in the story would need its own code.

**Recommendation:** when the story needs a second pickup, make pickups content data: which item, at which node, under which condition. Until then, leave it.

### TV lobby band parameters

`renderLobby` in `public/screen/lobby-view.js` takes the band (title and settings line) and Pierre's `{ required }` options as two parameters side by side, and one caller passes `undefined` for the band.

**Recommendation:** fold `required` into the band object.

### Protocol differences

`PROTOCOL.md` and the code disagree; the end-to-end tests follow the code:
- `chatHistory` goes to every `hello`, screens and new devices included, not only to reconnecting phones;
- `interact` from a sender with no known position counts as standing at their spawn point;
- `interact` also works at a scene tableau.

**Recommendation:** update `PROTOCOL.md` to match the code; the code's behaviour is fine.

### Debug accessors show only the party room

The TV's debug accessors `bloko.drawOrder()` and `bloko.scene()` report `PARTY_ROOM` even in the apartment or door #4's room, so `e2e-tv` can't check depth there.

**Recommendation:** pass the room on screen instead of `PARTY_ROOM` in `party.drawOrder()` and `party.scene()` (`public/screen/party-room.js`), now that the TV knows each node's room.

### Apartment sofa sparkle

The sofa's object-action sparkle is placed for the party room's narrow sofa. In the apartment, where the sofa is stretched 1.7×, it overlaps the "Comfy!" bubble.

**Recommendation:** place the effect from the prop's box.

### Portal drawn after use

If a game master sends the party back to the false start after Élodie went through the portal, the TV still draws the portal there (`public/screen/main.js`, `show`), but the server refuses to let anyone through it.

**Recommendation:** draw the portal only while it can be entered: `portal.ready` set and `portal.entered` not set.

### Shared urgent keyframes

`public/screen/blocks.css` and the quiz's `quiz.css` both define `@keyframes urgent`. The quiz's, loaded last, also drives the block countdown's pulse. It looks as intended only because of the load order.

**Recommendation:** give each its own name, scoped like the rest of the minigame's CSS.

### Minigame wording in shared folders

`public/commun/settings-text.js` and `public/commun/quiz-text.js` are the block game's and the quiz's own wording, shared between phone and TV, but they sit in the shared folder. `public/screen/fx.js` holds block-only effects next to the confetti the frame uses.

The block game's TV files also have generic names that hide whose they are: `public/screen/game-view.js` and `public/screen/countdown.js`.

**Recommendation:** move each minigame's wording and effects next to its own files, and give its files its name, so `public/commun/` and the frame's `fx.js` name no minigame and a reader can tell a minigame's files at a glance.

### Debug view of a running screen

The TV's debug accessors (`window.bloko`) show the round, the room's draw order and its avatars, but nothing about what a running minigame screen draws. When the contributor guide's stand-in minigame drew its avatars off-screen, finding out took an extra run.

**Recommendation:** let a running screen expose what it draws (e.g. the avatars it passed to the layer and its canvas size) through the existing accessors.

### GameStory.md frontmatter

`GameStory.md` has no frontmatter, unlike the other documents.

**Recommendation:** add the four fields (purpose, audience, maintainer, kind), with Pierre as maintainer.
