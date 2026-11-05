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
| [Phone lock on real phones](#phone-lock-on-real-phones) | Locking and unlocking a phone is never tested | P1 | Open | Low |
| [Story rules in shared code](#story-rules-in-shared-code) | The opening's rules are spread through shared code | P2 | Needs decision | High |
| [Ids in client code](#ids-in-client-code) | Node, character and item ids written into the clients | P2 | Open | Low |
| [Unknown content setting](#unknown-content-setting) | An unknown `ITLOE_CONTENT` silently starts the story | P3 | Open | Trivial |
| [Four-player check written twice](#four-player-check-written-twice) | The phone and the server each count the opening's players | P3 | Open | Trivial |
| [Pickup handles one item](#pickup-handles-one-item) | `collect` only knows the first key | P3 | Open | Low |
| [TV lobby band parameters](#tv-lobby-band-parameters) | `renderLobby` takes two option objects side by side | P3 | Open | Trivial |
| [Protocol differences](#protocol-differences) | `PROTOCOL.md` disagrees with the code in three places | P3 | Open | Trivial |
| [GameStory.md frontmatter](#gamestorymd-frontmatter) | The story document lacks the standard frontmatter | P3 | Open | Trivial |

## Items

### Phone lock on real phones

On the evening, phones lock and unlock all the time. The phone suite's "phone locked … → unlock resumes" check is skipped (`e2e-phone` part 1 prints a SKIP): headless Chrome doesn't freeze a page with `Page.setWebLifecycleState('frozen')`, so the unlock path, the `resume` probe on a stale socket, never runs. The other reconnect checks pass.

**Recommendation:** test it by hand on real phones, an iPhone and an Android, during the next manual test: lock mid-game for a few minutes, with and without the server restarting meanwhile, then unlock. Automate it only if a way to freeze a page in headless Chrome turns up.

### Story rules in shared code

The opening's rules are branches on `STORY_MODE` / `storyId === 'elo-50'` spread through shared code:
- `server/main.ts`: `walk`, `pos`, `interact`, `join`, `back`, `start`, `again`;
- the campaign reducer, `shared/campaign/index.js`: who may `enter` and `back`, `portal`, `collect`, the `portal.ready` given to older saves in `loadCampaign`, and `ack` setting `apparition.seen`;
- `public/play/main.js` (about ten places), `public/screen/main.js`, and the hints in `public/screen/doors.js`.

Each new story step adds more branches in all three layers.

**Recommendation:** decide with Pierre where story rules live before the story grows. Two options:
- story steps as content data, read by generic engine code;
- one story module per layer that shared code calls at a few named points.

[Ids in client code](#ids-in-client-code) and [Four-player check written twice](#four-player-check-written-twice) would fold into it.

### Ids in client code

The clients write content ids into code: node ids (`'hub.false-start'`, `'hub.door4'`), the character `'elodie'` where `content.chooser` exists, and the item `'memory-key-intro'`. Renaming a node or item in the content breaks the clients silently.

**Recommendation:** read them from the content (`content.start`, `content.chooser`, item ids from the node that offers them). Do it together with [Story rules in shared code](#story-rules-in-shared-code) if that goes ahead.

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

### GameStory.md frontmatter

`GameStory.md` has no frontmatter, unlike the other documents.

**Recommendation:** add the four fields (purpose, audience, maintainer, kind), with Pierre as maintainer.
