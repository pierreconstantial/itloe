---
purpose: The curated list of known follow-up work for Itloe that nobody has started yet, for Konstantin and Pierre to pick from.
audience: Konstantin, Pierre, and the agents working for them
maintainer: Konstantin and Pierre
kind: brief
---

# Backlog

Work someone noticed but nobody has started. Each item says what's wrong and where. Pick an item, then delete it in the same change that does it. Work in progress belongs in its own brief, not here.

## Story code

- **The opening's rules are spread through shared code.** `STORY_MODE` / `storyId === 'elo-50'` branches sit in:
  - `server/main.ts`: `walk`, `pos`, `interact`, `join`, `back`, `start`, `again`;
  - the campaign reducer (`shared/campaign/index.js`): who may `enter` and `back`, `portal`, `collect`, `portal.ready` given to older saves in `loadCampaign`, and `ack` setting `apparition.seen`;
  - `public/play/main.js` (about ten places), `public/screen/main.js`, and the hints in `public/screen/doors.js`.

  Much of it could be content data, or one story module.
- **Ids written into client code:** node ids (`'hub.false-start'`, `'hub.door4'`), `'elodie'` where `content.chooser` exists, and the item `'memory-key-intro'`.
- **The opening's four-player check is written twice,** in the phone and in the server.
- **`collect` handles one item only.** It could become a content-driven pickup.
- **The TV's `renderLobby` takes `band` and `options` side by side,** and a caller passes `undefined` for the band. Folding `required` into the band would be tidier.
- **`GameStory.md` has no frontmatter,** unlike the other documents.

## Tests

- **The "phone locked" path is untested.** Headless Chrome doesn't freeze pages with `Page.setWebLifecycleState('frozen')`, so `e2e-phone` part 1 prints a SKIP for "phone locked … → unlock resumes". Testing it needs another way to freeze a page, or a check on a real phone.

## Protocol

`PROTOCOL.md` and the code disagree here; the end-to-end tests follow the code:
- `chatHistory` goes to every `hello`, screens and new devices included, not only to reconnecting phones;
- `interact` from a sender with no known position counts as standing at their spawn point;
- `interact` also works at a scene tableau, which `PROTOCOL.md` doesn't list.
