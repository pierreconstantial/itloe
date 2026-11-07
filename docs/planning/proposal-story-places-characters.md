# Proposal: the story places a character where a scene needs them

Status: **Draft proposal**, to discuss with Konstantin. Not implemented; it defines no API until agreed.
Date: 2026-11-07. Author: Pierre (written with Claude).

## In one minute

- **What:** a machine state can say where a character stands when the state begins, e.g. Pierre next to the
  Shelter's table football when Élodie arrives. The server moves that avatar there, on the TV and on its phone.
- **Why:** today an avatar keeps the position it had in the previous room (or, if it never moved, its spawn point on
  the room's front row). Only Élodie can be placed (a zone's `arrive`). Scenes where someone waits somewhere (Pierre
  at the table football, later others) can't be set.
- **Cost:** small, and additive. One optional field on machine states, validation, and one server change hook that
  reuses what a zone's `arrive` already does (set the position, send `pos` to the screens and the player's phone).
  No change to the wire messages.
- **Risk:** low. A placed player who was walking jumps to the spot, as Élodie does after a portal. A state without
  the field behaves as today.
- **Decision asked:** OK to add `place` as described below? Konstantin builds it, or Claude with his OK.

## The field

```js
MachineState.place?: Record<CharacterId, { node: NodeId, x: number, y: number, dir?: 'up' | 'down' | 'left' | 'right' }>
// the Shelter: Pierre waits by the table football
'pierre-here': {
  enter: [{ incarnate: 'pierre' }],
  place: { pierre: { node: 'young-adult/shelter', x: 8.3, y: 6.3, dir: 'up' } },  // just in front of the table, facing it
  …
}
```

## Rules

- **When:** when the state begins, if the party is at `node` and that character is in the party. A state entered
  elsewhere places nobody (the party might be elsewhere when a timer moves a machine).
- **Who:** the character's player, whatever their status: a wisp's light is placed too, so it shows where the
  avatar will appear after an `incarnate` countdown.
- **What the server does:** what a zone's `arrive` does for the chooser (`walk` in `server/main.ts`): set the
  position, send `pos` to the screens and to the player's phone. Unlike `arrive`, it also reads again what they
  stand in (doors, zones, reach) as a fresh baseline, so being placed in a door is not stepping into it. `dir`
  defaults to `down`, facing the TV.
- **Validation:** known characters and nodes, numbers for `x` and `y`, a spot that is walkable in the node's room.

## Not part of it

- Moving a character along a path (walking NPC-like players): not needed by any scene yet.
- Placing several characters in formation: `place` already takes several characters.
