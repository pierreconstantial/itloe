# Itloe — Élodie's 50th birthday story

## Premise and tone

Itloe begins as an ordinary multiplayer block puzzle game. Four people join by QR code, play together, and return to the same lobby. The birthday adventure must not be visible or hinted at before this first match ends. A space portal then appears in the middle of the lobby. Élodie ("Elo") alone enters it; the other three players become wisps and accompany her.

The portal takes Elo to her personal paradise, a Viennese apartment. The story follows her life through six memory worlds and an unknown future. Its emotional goal is to bring her loved ones together in the apartment. The tone is warm, personal and absurdly funny: a solemn mystical apparition suddenly shreds on a guitar.

## Required opening sequence

1. Four players join the existing lobby normally. Only the existing multiplayer block game is available.
2. They play the block game. Winning or losing does not affect story access.
3. All four return to the same lobby. A space portal now stands in its centre.
4. Elo enters. Only her character crosses as a person; Pierre, Sol and Anna become wisps and accompany her.
5. Elo arrives in the Viennese apartment hub with the three wisps. Silex and Taïga are NPC cats. No other player character appears there yet.
6. A mystical figure resembling Omraam Mikhaël Aïvanhov slowly materializes in a darker part of the room. Light grows around him. He floats above the floor at twice a normal character's size and says:

   > Fifty years… You turn fifty today, and you have travelled through space and time. But can you gather the keys of memory? Only they will open the path to your future.
   >
   > There are seven keys to find. It is up to you to seek them.

7. He pulls out a guitar and plays wild rock riffs, then disappears in smoke, leaving a key. Control returns to Elo. She picks up the key and approaches the only visible door, door #4, which leads to a second room.

The apparition is a story beat, never a reward for winning the block game. Its dialogue and reveal play once; reconnects and revisits do not duplicate the key.

## Wisps

When Elo enters the portal, Pierre, Sol and Anna remain connected as wisps. A player who selects a character outside the four opening players, or joins after the portal, starts as a wisp unless that character has already been introduced. A wisp is a very small floating light with a hint of its character's color, no name label, and a slight pulse while moving. Its only action is **Shine**, a brief increase in brightness, offered in reactions and beside nearby objects. Shine does not use the object or trigger a story event. A wisp cannot talk or use objects, NPCs, or puzzles. The server controls incarnation: when the story introduces a character, the matching player's wisp becomes that playable character. The player may return to Wisp Mode when that character is no longer active. The `wisp` status is persisted alongside any other statuses.

Pierre is always the game master for the birthday story, including while his character is a wisp. Game-master controls are separate from the host's round and settings controls. After the portal, Élodie hosts rounds while Pierre can still direct the story from his game-master panel.

For example, Nico can select his predefined character and join an ongoing game as a wisp. When the story grants `person.nico.unlocked`, his phone vibrates and shows **3, 2, 1**. At the end of that server-timed countdown, his light becomes the playable Nico character with a randomly chosen character emote. Character actions are held during the countdown. Story authors can also use the server's internal status action to return a player to Wisp Mode. This lets a player join without changing the current story scene or round.

For incarnated players, objects have a default interaction unless their rule says otherwise. A rule may change or deny that action by player ID, character, status, or inventory. Wisp Mode always prevents object interaction regardless of the object's rule.

## Apartment hub

- An elegant Viennese apartment with high ceilings, a large sofa and warm, subdued lighting. The interior occupies about two-thirds of the scene.
- A sunny terrace occupies the right side. A small table holds an ashtray and a beer; the weather is beautiful.
- Silex and Taïga remain in the apartment as NPCs throughout the story.
- There are eventually four hub doors. Initially only #4 is visible. It is a large traditional Viennese apartment door, matching the existing door style, and stays the largest as more doors appear.
- Door #4 leads first to a second room. Its contents are **not yet defined**. The four doors are **not** assumed to correspond one-to-one with worlds.
- Unlocked loved ones stay in the hub on later visits. Collected objects decorate it, gradually turning the quiet apartment into a gathering place.

## Exploration and progression

The main loop is: explore a world → collect objects and meet someone → play a short, accessible shared mini-game → return to the hub. Elo may revisit worlds and choose freely among those currently available. Losing a mini-game must not block the story.

The proposed seven keys are the introductory key from the apparition plus one from each of the six memory worlds. All seven unlock the future world. Track keys, collected objects, unlocked people, available doors and completed mini-games persistently across transitions. Rewards happen once even when an encounter is replayed. Keep navigation and interactions simple; avoid difficult puzzles and complex inventory management.

### Worlds

| World | Period | Memories to include |
| --- | --- | --- |
| 1 | Childhood | Ariège; primary school with her father as teacher; classical ballet; Bonfin; the White Brotherhood (Fraternité blanche). |
| 2 | Adolescence | First cigarette at 13; moped; Christel; bars; Thiéfaine. |
| 3 | Becoming an adult | Éric; Loran; alone in Switzerland; camping and survival; Canary Islands as a horse-riding instructor and holiday activity leader; Austrian romantic interests. |
| 4 | Young adulthood in Vienna | Shikababe; Mathieu, Nico and Johanna; French language assistant; belote with Fred and Vince; Jägerstraße. |
| 5 | Pierre enters her life | Pierre; flight attendant work; backgammon; Marokkanergasse. |
| 6 | Family life to the present | Sol's birth; Rosenburg; Anna; bookseller work; renovation work at Rosenburg; life today. |
| 7 | Future | Unknown. Its contents and final reveal remain undefined. |

These are content anchors, not permission to invent events or dialogue. Individual scenes, object puzzles, world entrances and the second room are still to be specified. Keep their data configurable.

### Reunions

| Intended milestone | Shared mini-game | Participation |
| --- | --- | --- |
| Pierre | Backgammon | In the room, playing with Elo. |
| Sol and Anna | Multiplayer Tetris-style block game | Both in the room, playing with Elo. |
| Nico | Word-clue game inspired by *Pyramide* | Remote from Sweden, playing live with Elo through the phone/QR system. An NPC-only substitute is insufficient. |
| Father | Dice game (exact rules undefined) | Local or remote participation undefined. |
| Mother | Yahtzee | Local or remote participation undefined. |

The intended reunion order is Pierre → Sol and Anna → Nico → father → mother. Exploration among available worlds stays free around these milestones. Each unlocked person appears in the hub permanently, alongside earlier arrivals, memories and the cats.

## Implementation boundaries

Use the existing campaign engine, multiplayer block game, QR joining, phone controls and persisted facts. A future campaign engine should include a dialog engine for story conversations and scenes. Represent new story facts by stable IDs and keep them across save/load. Avoid treating the existing placeholder sample campaign as the birthday story. Add real mini-games only when their interaction rules and content are defined; keep unknown scenes and door-to-world mapping configurable instead of guessing.

## Current implementation

The live campaign starts with the existing four-player block game. Its first completed match reveals the portal. Elo alone can trigger the transition, the apparition and first-key pickup, then enter and return from door #4. The apartment scene, cats, terrace, guitar moment and seven-key item catalogue are in place. The engine persists these facts, and the future node requires all seven keys.

Wisp status, light rendering, server-controlled incarnation, Shine, and status and inventory based object interactions are implemented. Nico has a fifth character slot and provisional character art, so he can join during or after the opening match without entering its round. Further late-joining named characters require roster entries and art.

The second room, individual memory-world scenes and their entrances, object rewards, reunion mini-games and future reveal remain to be specified and implemented. The six memory-world records have no assigned doors, so they cannot be entered in normal play yet. Nico's live remote mini-game is a required future feature; the existing QR/phone connection provides its multiplayer foundation.

Reunion flags use stable IDs (`person.pierre.unlocked`, `person.sol.unlocked`, `person.anna.unlocked`, `person.nico.unlocked`, `person.father.unlocked`, `person.mother.unlocked`). When the corresponding mini-game is completed, its node should award the flag once through the campaign's `rewards` mechanism. The hub already renders unlocked loved ones and catalogue objects that Elo collects; keys stay in her bag. These flags do not yet have gameplay triggers.
