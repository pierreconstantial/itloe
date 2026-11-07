---
purpose: The birthday story Itloe tells, from the opening to the reunions, and how much of it the game implements.
audience: Pierre, Konstantin, and the agents building the story
maintainer: Pierre
kind: reference
---

# Itloe — Élodie's 50th birthday story

## Premise and tone

Itloe begins as an ordinary multiplayer block puzzle game. Four people join by QR code, play together, and return to the same room. The birthday adventure must not be visible or hinted at before this first match ends. A space portal then appears in the middle of the room. Élodie ("Elo") alone enters it; the other three players become wisps and accompany her.

The portal takes Elo to Élodie’s dream apartment in Vienna. The story follows her life through six memory worlds and an unknown future. Its emotional goal is to bring her loved ones together in the apartment. The tone is warm, personal and absurdly funny: a solemn mystical apparition suddenly shreds on a guitar.

## Required opening sequence

1. Four players join the existing room normally. Only the existing multiplayer block game is available.
2. They play the block game. Winning or losing does not affect story access.
3. Pierre ends the block game, and all four are back in the room. A space portal now stands in its centre.
4. Elo enters. Only her character crosses as a person; Pierre, Sol and Anna become wisps and accompany her.
5. Elo arrives in Élodie’s dream apartment with the three wisps. Silex and Taïga are NPC cats. No other player character appears there yet.
6. A mystical figure resembling Omraam Mikhaël Aïvanhov slowly materializes in a darker part of the room. Light grows around him. He floats above the floor at twice a normal character's size and says:

   > Fifty years… You turn fifty today, and you have travelled through space and time. But can you gather the keys of memory? Only they will open the path to your future.
   >
   > There are seven keys to find. It is up to you to seek them.

7. He pulls out a guitar and plays wild rock riffs, then disappears in smoke, leaving a key. Control returns to Elo. She picks up the key and approaches the only visible door, door #4, which leads to a second room.

The apparition is a story beat, never a reward for winning the block game. Its dialogue and reveal play once; reconnects and revisits do not duplicate the key.

## Wisps

When Elo enters the portal, Pierre, Sol and Anna remain connected as wisps. A player who selects a character outside the four opening players, or joins after the portal, starts as a wisp unless that character has already been introduced. A wisp is a very small floating light with a hint of its character's color, no name label, and a slight pulse while moving. Its only action is **Shine**, a brief increase in brightness, offered in reactions and beside nearby objects. Shine does not use the object or trigger a story event. A wisp cannot talk or use objects, NPCs, or puzzles. The server controls incarnation: when the story introduces a character, the matching player's wisp becomes that playable character. The player may return to Wisp Mode when that character is no longer active. The `wisp` status is persisted alongside any other statuses.

Pierre is always the game master for the birthday story, including while his character is a wisp. Pierre also starts and ends every minigame, sets it up and starts its rounds. There is no other host.

A minigame's place can name who plays it. A wisp it names plays as their character there, as Nico does in Pyramide before the story introduces him. During a minigame, every connected player it doesn't show (not among its players, not ready, or out of the round) floats over its screens as a wisp.

For example, Nico can select his predefined character and join an ongoing game as a wisp. When the story grants `person.nico.unlocked`, his phone vibrates and shows **3, 2, 1**. At the end of that server-timed countdown, his light becomes the playable Nico character with a randomly chosen character emote. Character actions are held during the countdown. Story authors can also use the server's internal status action to return a player to Wisp Mode. This lets a player join without changing the current story scene or round.

For incarnated players, objects have a default interaction unless their rule says otherwise. A rule may change or deny that action by player ID, character, status, or inventory. Wisp Mode always prevents object interaction regardless of the object's rule.

## Élodie’s dream apartment

- An elegant Viennese apartment with high ceilings, a sofa, plants, art posters, an oriental rug and warm, subdued lighting. Its [game background](public/assets/places/hub/elodie-dream-apartment-oriental-rug-v2.png) uses the approved pixel-art design at the game’s character scale.
- A large sunny terrace fills the right half of the scene, with a table for four. A beer and an ashtray sit on the table. Beyond it are open sky and what might be the sea.
- Silex and Taïga remain in the apartment as NPCs throughout the story.
- The single large interior door is the currently visible hub door and leads to Young Adult. The other three hub doors and their reveal sequence remain to be designed.
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

These are content anchors, not permission to invent events or dialogue. The Young Adult flow is specified below; scenes and entrances for the other worlds remain to be defined.

### Young Adult places

The Young Adult area starts at Tram 5, its entrance and hub. The first named places are:

| Place | Code name | Background assets |
| --- | --- | --- |
| Tram 5 (entrance and hub) | `young-adult/tram-5` | [Shelter closed](public/assets/places/young-adult/tram-5-shelter-closed-v5.png), [Shelter open at night](public/assets/places/young-adult/tram-5-night-shelter-open-v6.png) |
| Shelter | `young-adult/shelter` | [Interior](public/assets/places/young-adult/shelter-interior-playable-v3.png) |
| Appart Elo 1 | `young-adult/appart-elo-1` | [Lamp on](public/assets/places/young-adult/appart-elo-1-basement-v1.png), [lamp off](public/assets/places/young-adult/appart-elo-1-lamp-off-v2.png) |
| Marokkanergasse (Pierre’s apartment) | `young-adult/appart-pierre` | [Eureka living room](public/assets/places/young-adult/marokkanergasse-eureka-v1.png) |

Tram 5 has three quiet passers-by near the stop and café: an older Viennese woman with a cane, a child eating ice cream, and a lazy man. A crow occasionally crosses the sky. At night (once The Shelter is open) the woman and the child are gone, the lazy man stays, having drunk too much during the day, and a small rat lurks by the cigarette machine. The Shelter has two dancers in the dark stage room, a beer drinker, a barman, and a hyped punk. They animate in place and are scenery, leaving the routes and interactive objects clear. Their pixel art is in [ambient-npcs.js](public/screen/ambient-npcs.js).

The Young Adult collectible art is in [public/assets/items/young-adult](public/assets/items/young-adult): beer, cigarettes, crowbar, Shelter ticket, and the Adult Age key. These items are in the catalogue and use the pixel icons in the bag; the pickup and puzzle actions remain part of the planned flow below.

### Young Adult game flow

1. **Tram 5 — Wallensteinplatz (`young-adult/tram-5`).** Élodie arrives alone. A dog barks at Tschick-Toni, a suspicious man trying to break into a *Zigarettenautomat* with a crowbar. When Élodie speaks to him, he asks, “Host a Tschick? I brauch dringend ane!” If she gives him a cigarette (she keeps the pack), he says, “Oida, geil!” with a joyful emote, and a few seconds later he disappears with his dog, leaving the crowbar on the floor for her to collect. Interacting with the tram starts a quiz; after completing it, she can travel to her flat.
2. **Tram travel.** Every journey requires a quiz. Élodie chooses one of three topics, then everyone who is not hidden may answer five questions. After each answer, the game shows the correct answer and an explanation in the style Élodie likes. When the quiz is complete, Élodie selects an available destination.
3. **Élodie’s flat (`young-adult/appart-elo-1`).** The room is dark at first; Élodie can turn on its floor lamp. The TV offers a Columbo episode on YouTube or TV5 Monde for one in-game hour. Reading a book advances time by two hours. The beer bottles are empty; examining them prompts, “Pierre said he'd bring beer.” A cracked floorboard hides a Shelter concert ticket, but Élodie needs a tool to lift it. Before she has one, she says, “There's a piece of paper stuck under the parquet floor. I can't pull it out.”
4. **Pierre’s arrival.** After three in-game hours, regardless of puzzle progress, Pierre arrives with beer. He says, “I brought beers and cigarettes! But first, let's play backgammon.” Élodie may choose “Yes” to start backgammon or “Dismiss”; talking to him asks again. All non-hidden players take part in backgammon. When the game ends, beers and a pack of cigarettes appear on the floor to collect, and Pierre returns to wisp mode.
5. **The Shelter ticket puzzle.** Élodie takes the cigarettes, returns to Tram 5, gives one to the man and collects his crowbar. She takes another tram quiz to return to her flat, uses the crowbar on the floorboard and retrieves the ticket. The Shelter then opens: at night its entrance on Wallensteinplatz lets her in.
6. **The Shelter (`young-adult/shelter`).** Wallensteinplatz switches to its night view when The Shelter opens. Élodie walks in through its entrance on Wallensteinplatz; the tram never goes there. Walking up its stair takes her back to Wallensteinplatz. Inside the bar she meets Pierre again; he proposes a multiplayer table-football (*baby-foot*) game. After the match, standing next to him, she can kiss him. Every invitation in the story is a “Yes” or “Dismiss” choice. The kiss unlocks Marokkanergasse as a tram destination and closes access to Élodie’s original flat. One final tram quiz takes her to Marokkanergasse.
7. **Marokkanergasse (`young-adult/appart-pierre`).** The apartment has no normal exit. Johanna, Nico and Mathieu stand in the room as NPCs; their players are still wisps. Interacting with any of them prompts, “Shikababy Shikaboom! Let's play a Pyramide game!” Élodie may choose “Yes” to start the multiplayer word game or “Dismiss” to close the dialogue. When the game opens, the three are introduced: their NPCs leave the room and their players' wisps become them for good, so connected players play, move and talk as Johanna, Nico and Mathieu.
8. **World completion.** After Pyramide, a special key appears on the floor. Élodie picks it up, unlocking the Adult Age door in the hub. A portal appears in the apartment; entering it returns everyone to the central hub and completes the Young Adult world.

Implemented now: the rooms and art variants, the tram's quiz offer and lobby, and after the quiz the destination Élodie chooses (her flat until the kiss, Marokkanergasse after the kiss; never the Shelter, whose entrance on Wallensteinplatz lets her in at night; walking out of her flat's front door or up the Shelter's stair, or Back, returns to Tram 5), Tschick-Toni's passage (the cigarette, his and the dog's departure, the crowbar), Élodie's flat (the lamp, Columbo and the books moving in-game time, the empty bottles, Pierre arriving after three in-game hours (his wisp becomes his avatar and he says his line), his backgammon invitation (Yes or Dismiss; talking to him offers it again) opening its lobby, back to a wisp in the flat after a finished game, the beers and cigarettes on the floor, the floorboard and the ticket, which opens the Shelter), the Shelter (Pierre there again as himself, offering table football (Yes or Dismiss; the table offers it again), everyone playing, wisps too, then back in the bar Élodie's kiss, an action on Pierre, which opens Marokkanergasse), and Marokkanergasse (Johanna, Nico and Mathieu as NPCs, their Pyramide offer, the three introduced as it opens, then the Adult Age key on the floor, which opens the Adult Age door (`memory.adult`), and the portal back to the hub, which completes Young Adult). People answer when talked to: Tram 5's passers-by and the dog (“Wuff!”), the Shelter's barman (at the bar), punk, drinker and dancers, and each of Johanna, Nico and Mathieu with their own line before Pyramide. At the Shelter, holding the beers, Élodie can give Pierre one (“Prost!”), and talking to him offers table football again. Once Johanna, Nico and Mathieu are themselves, anyone next to one of them can “🎶 Shikaboom!”. Planned, not implemented: the tram quiz's topics. The story's data is in `shared/campaign/story/` (docs/story-engine.md).

Inside, a steep stair behind the entrance door descends into a brick-vaulted rock and punk bar. Two small tables stand in the middle, with walkable space around them. Foosball is farther back; the bar and pinball machine are on the right. The music stage is visible through the left arch, at the back of a small, roughly square second room that is much darker than the bar. Gig posters cover the walls. The visual reference is “WhatsApp Image 2026-11-06 at 4.45.29 PM” in Downloads.

Appart Elo 1 is one small room in Élodie's flat, partly underground. A few steps descend from the door. Its windows are narrow and high on the wall. A mattress lies on the floor, with a cathode-ray TV beside it showing TV5MONDE. There are many books, a lamp on the floor, and a beer and ashtray on the floor near the bed. The visual reference is “Cozy Nick Cave Basement Retreat” in Downloads.

Marokkanergasse is a dim, intimate Vienna living room lit by a warm floor lamp. A large red-lettered EUREKA film poster hangs above a patterned brown sofa with a blue cushion. A cream-covered sofa with a burnt orange cushion faces a navy wooden armchair. Books, trailing plants, a small giraffe and a speaker fill the shelves on the left. A low wooden coffee table holds a bottle, glasses, cigarettes and an ashtray. The parquet foreground stays clear for the characters to gather and move around the seating group. The story has no normal exit from this apartment. The approved art adapts “Cinematic Eureka Poster Living Room” in Downloads to the game’s pixel style and character scale.

Nico and Johanna’s sprites use “WhatsApp Image 2026-11-06 at 11.16.23 PM” in Downloads as their reference (Nico left, Johanna right). Nico has short dark hair, a goatee, a dark zip sweater with grey shoulder panels and pale jeans. Johanna has long dark-blonde hair, a white coat over black clothes and black boots; she stands beside the right sofa as an NPC until Pyramide opens. She is selectable on a phone (colour slot 8) and incarnates when `person.johanna.unlocked` is set.

Mathieu’s sprite uses the bottom-left portrait of “WhatsApp Image 2026-11-06 at 11.20.29 PM” in Downloads: close-cut dark hair, light stubble, a white short-sleeved polo and dark jeans. His sheet includes all four directions and the same walking cycle as Nico. He is selectable on a phone (colour slot 7), joins as a wisp and incarnates when `person.mathieu.unlocked` is set, like Nico.

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

The live campaign starts with the existing four-player block game. The portal appears once Pierre ends the block game, after at least one finished match. Elo alone can trigger the transition, the apparition and first-key pickup, then enter and return from door #4. The apartment scene, cats, terrace, guitar moment and seven-key item catalogue are in place. The engine persists these facts, and the future node requires all seven keys.

Wisp status, light rendering, server-controlled incarnation, Shine, and status and inventory based object interactions are implemented. Nico has a fifth character slot and provisional character art, so he can join during or after the opening match without entering its round. Further late-joining named characters require roster entries and art.

The second room, individual memory-world scenes and their entrances, object rewards, reunion mini-games and future reveal remain to be specified and implemented. The six memory-world records have no assigned doors, so they cannot be entered in normal play yet. Nico's live remote mini-game is a required future feature; the existing QR/phone connection provides its multiplayer foundation.

Reunion flags use stable IDs (`person.pierre.unlocked`, `person.sol.unlocked`, `person.anna.unlocked`, `person.nico.unlocked`, `person.father.unlocked`, `person.mother.unlocked`). When the corresponding mini-game is completed, its node should award the flag once through the campaign's `rewards` mechanism. The hub already renders unlocked loved ones and catalogue objects that Elo collects; keys stay in her bag. These flags do not yet have gameplay triggers.
