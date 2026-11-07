# Proposal: interactions between characters

Status: **Agreed with Konstantin** (his review, 2026-11-07). Story actions are implemented (branch
`character-interactions`: `PROTOCOL.md`, `docs/story-engine.md`); generic actions are next.
Date: 2026-11-07. Author: Pierre (written with Claude).

## Decisions after Konstantin's review

- **Phones learn who is in reach from the server** (his option A): `{ "t": "reach", "characters": [...] }`, sent
  only when the list changes. Phones never get the others' positions.
- **Story actions have full priority:** whenever a story action is available to a player, their generic actions
  are hidden. A story action replaces generic ones only for the players it's offered to.
- **Generic actions act on everyone in reach** (Pierre): one tap makes a group hug, a group cheers.
- **Smaller points, all taken:** a prop id can't be a character id (validation), a target who hasn't moved stands
  at their spawn point, and character actions share `interact`'s 700 ms limit.
- **No version for wisps:** a wisp moves and Shines, nothing else.

The sections below are the original proposal; where they differ, the decisions above win.

## In one minute

- **What:** players can act on each other's characters, as they act on room objects today. Two kinds:
  - **story actions**, defined in the story data ("💬 Talk to Pierre", "💋 Kiss Pierre"), which move the story on;
  - **a few generic ones** anyone can do with anyone (🤗 hug, ✋ high five, 🍻 cheers), which only play an effect.
- **Why:** interaction between players is key to the evening, and two story moments are waiting for it:
  - bringing Pierre's backgammon offer back by talking to him;
  - the kiss at the Shelter.
- **Cost:** it reuses the object-action machinery (same rules, reach, wire message and event naming), extended to
  characters. It's additive: nothing existing changes. Roughly the size of the prop interactions themselves.
- **Risk:** low. The workarounds already in the story (a timer, a Yes/Dismiss question) keep working until it
  lands.
- **Decision asked:** OK to build it as described below? The open questions at the end can be settled while
  building.

## Why

Players can only interact with room objects (props) today. Interaction between players is key to the evening:
the story needs actions on a character (talking to Pierre, kissing Pierre), and everyone should be able to do
a few friendly things with each other anywhere.

Story uses waiting for this:

- **Élodie's flat:** after Élodie dismisses Pierre's backgammon offer, talking to Pierre brings it back. Today the
  offer comes back by itself after a few seconds.
- **The Shelter:** after the table football match, Élodie kisses Pierre as an action on him. Today it's a Yes/Dismiss
  question on her phone.
- Later: giving an item to someone, a character reacting to who talks to them.

## Two kinds of character action

1. **Story actions:** defined by a machine state, like `objects`. They fire story events.
2. **Generic actions:** defined once in shared code, like the furniture's `OBJECT_ACTIONS`, offered between any two
   characters. They play an effect and save nothing.

A story action on a character replaces the generic ones on that character while its state is current, as a
state's `objects` replace the furniture's action for the same prop. At the Shelter, "💋 Kiss Pierre" wins over
the hug.

## When an action on a character is offered

- The target character is in the party and shown as themselves: not a wisp, not mid-incarnation.
- The acting player is not a wisp (as with objects) and is not the target.
- The acting player's feet are within reach of the target's feet: the same 0.8 reach as props.
- No minigame runs (as for object actions).
- The phone's action button offers the closest thing in reach, prop or character, with its label.

## Story actions

Story data (`docs/story-engine.md`, Machines), next to `objects`:

```js
MachineState.characters?: Record<CharacterId, { actions: ObjectAction[] }>
```

- `ObjectAction` as for props: `key`, `text`, `say?`, `by?` (default the chooser), `if?`. Per acting player,
  the first action they may use whose `if` holds is offered.
- Using one fires the event `<key>:<characterId>`, e.g. `kiss:pierre`, and machines react as usual.
- `say` shows over the acting player; with `speaker: 'target'`, over the target (the target answers).
- When two machines give actions on the same character: the last one in content order wins, as for `objects`.

Examples:

```js
// Pierre in the flat, after a dismissed backgammon offer
characters: { pierre: { actions: [{ key: 'talk', text: '💬 Talk to Pierre' }] } },
on: { 'talk:pierre': 'invites' },

// the Shelter, after the match
characters: { pierre: { actions: [{ key: 'kiss', text: '💋 Kiss Pierre', by: 'elodie' }] } },
on: { 'kiss:pierre': { to: 'kissed', do: [{ flag: 'young-adult.appart-pierre.open' }] } },
```

Validation (`validateContent`): `characters` keys are roster ids, and `<key>:<characterId>` events count as
events that can happen.

## Generic actions

Defined in `shared/interactions.js` as `CHARACTER_ACTIONS`. Proposed set:

| Action | Button | Effect on the TV |
|---|---|---|
| Hug | 🤗 Hug | A ❤️ emote over both avatars |
| High five | ✋ High five | A clap and a small hop on both avatars |
| Cheers | 🍻 Cheers | A clink bubble between them |

- No story event and nothing saved: relayed like `emote`, with the same rate limit (one per 650 ms per socket).
- To decide: one button that cycles through them, or a small menu when standing next to someone.

## Wire

Phone → server:

```jsonc
{ "t": "interact", "character": "pierre", "action": "hug" }   // action: optional, for a generic one chosen from a menu
```

- The server checks both latest positions, both statuses and the rules above.
- It relays `{ "t": "interact", "playerId", "character", "action", "feedback", "at" }` to the screens.
- A story action is applied to the campaign as `use { id, character, action }`, so a machine may move on.
- A generic action is only relayed.
- Clients ignore what they don't know, as usual.

## Open questions

1. Generic actions: one cycling button, or a menu?
2. Should a generic action also show a small reaction on the target's phone (e.g. "Élodie hugged you 🤗")?
3. Should wisps get their own gentle version (Shine at someone)?
