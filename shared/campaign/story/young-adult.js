// Young Adult (GameStory.md, "Young Adult game flow"): Tram 5 at Wallensteinplatz, the tram's quiz, Tschick-Toni,
// the Shelter and the two flats. Story data only (docs/story-engine.md).
import { room, prop } from '../../scene.js';
import { INTRO_KEY } from './hub.js';

/** @typedef {import('../types.js').Content} Content */

const ART = '/assets/places/young-adult/';
const ITEM_ART = '/assets/items/young-adult/';
const TRAM_5 = 'young-adult/tram-5';
const TRAM_QUIZ = 'young-adult/tram-5/quiz';
const FLAT = 'young-adult/appart-elo-1';
/** In-game time in Élodie's flat: hours that only her actions move (docs/story-engine.md, "In-game time"). */
const CLOCK = 'young-adult.clock.hours';

/** The man and his dog stand by the cigarette machine in front of the Tram 5 stop. */
const TRAM_5_ROOM = room(TRAM_5, { x: 0.5, y: 5.6, w: 15, h: 3.2 }, [
  // The tram is painted into the background; this is its interaction area, without duplicate art.
  prop('tram-5-tram', { x: 5.2, y: 4.65, w: 4.9, h: 1.55 }, { layer: 'back' }),
  prop('tram-5-dog', { x: 9.5, y: 7.05, w: 1.2, h: 0.9 },
    { solid: { x: 9.75, y: 7.7, w: 0.7, h: 0.25 } }),
  prop('tram-5-weird-man', { x: 10.55, y: 6.45, w: 1.2, h: 1.2 },
    { solid: { x: 10.85, y: 7.3, w: 0.6, h: 0.35 } }),
  prop('tram-5-cigarette-automat', { x: 11.85, y: 5.7, w: 1.05, h: 1.8 },
    { solid: { x: 11.95, y: 7.15, w: 0.85, h: 0.35 } }),
  // ambient people (public/screen/ambient-npcs.js): drawn, no interaction
  prop('tram-5-old-woman', { x: 2.45, y: 4.85, w: 0.8, h: 1.2 }, { layer: 'back' }),
  prop('tram-5-ice-kid', { x: 4.25, y: 5.05, w: 0.7, h: 1.0 }, { layer: 'back' }),
  prop('tram-5-lazy-guy', { x: 0.85, y: 5.55, w: 1.05, h: 1.15 }, { layer: 'back' }),
]);
/** The other Young Adult backgrounds use their visible furniture as movement obstacles. */
const SHELTER_ROOM = room('young-adult/shelter', { x: 0.5, y: 4.4, w: 15, h: 4.4 }, [
  prop('shelter-dancing-girl', { x: 1.55, y: 4.35, w: 0.8, h: 1.05 }, { layer: 'back' }),
  prop('shelter-dancing-man', { x: 2.65, y: 4.35, w: 0.8, h: 1.05 }, { layer: 'back' }),
  prop('shelter-barman', { x: 12.9, y: 3.25, w: 0.8, h: 1.05 }, { layer: 'back' }),
  prop('shelter-beer-guy', { x: 13.7, y: 5.1, w: 0.8, h: 1.15 }, { layer: 'back' }),
  prop('shelter-hyped-punk', { x: 3.4, y: 5.25, w: 0.9, h: 1.1 }, { layer: 'back' }),
], [
  { x: 7.1, y: 4.5, w: 2.5, h: 1.2 }, // foosball
  { x: 10.5, y: 4.1, w: 4.8, h: 1.2 }, // bar and pinball machine
  { x: 3.1, y: 6, w: 1.2, h: 0.65 },
  { x: 9, y: 6.1, w: 1.3, h: 0.65 }, // the two central tables
]);
/** The flat's objects are painted (appart-elo-1-*.png); these props are their interaction areas, without art. */
const APPART_ELO_1_ROOM = room(FLAT, { x: 0.5, y: 5.3, w: 15, h: 3.5 }, [
  prop('appart-elo-1-lamp', { x: 4.0, y: 4.6, w: 1.2, h: 1.4 }, { layer: 'back' }),
  prop('appart-elo-1-beer', { x: 6.1, y: 5.5, w: 0.7, h: 1.0 }, { layer: 'back' }),
  prop('appart-elo-1-tv', { x: 9.95, y: 4.5, w: 2.05, h: 1.5 }, { layer: 'back' }),
  prop('appart-elo-1-books', { x: 12.9, y: 4.7, w: 1.8, h: 1.2 }, { layer: 'back' }),
  // not painted: a cracked board in the open floor, left of the rug
  prop('appart-elo-1-floorboard', { x: 3.6, y: 7.3, w: 1.2, h: 0.5 }, { layer: 'back' }),
], [
  { x: 5.25, y: 5.15, w: 4.6, h: 1.05 }, // mattress
  { x: 9.9, y: 5.1, w: 1.55, h: 0.9 }, // television
]);
/** Marokkanergasse (marokkanergasse-eureka-v1.png): Johanna stands by the window. */
const APPART_PIERRE_ROOM = room('young-adult/appart-pierre', { x: 0.5, y: 5.45, w: 15, h: 3.35 }, [
  prop('marokkanergasse-johanna', { x: 13.25, y: 6.0, w: 0.9, h: 1.2 }),
], [
  { x: 1.3, y: 5.45, w: 0.8, h: 0.3 }, // bookshelf base
  { x: 2.0, y: 5.8, w: 1.95, h: 0.6 }, // navy armchair
  { x: 4.0, y: 5.3, w: 0.55, h: 0.45 }, // plant pot
  { x: 4.55, y: 5.55, w: 0.65, h: 0.25 }, // floor lamp base
  { x: 5.2, y: 5.15, w: 4.1, h: 0.6 }, // patterned brown sofa
  { x: 5.65, y: 5.55, w: 3.65, h: 0.75 }, // coffee table; the foreground stays open
  { x: 9.3, y: 5.35, w: 3.6, h: 0.95 }, // cream-covered sofa
]);

/** Toni's prop, and the dog that leaves with him. */
const TONI = 'tram-5-weird-man';
const DOG = 'tram-5-dog';

/** @type {Pick<Content, 'items' | 'nodes' | 'rooms' | 'machines' | 'roomArt'>} */
export const YOUNG_ADULT = {
  items: {
    'shelter-ticket': { id: 'shelter-ticket', name: 'The Shelter concert ticket', icon: '🎟️', description: 'A ticket to a night at The Shelter.', art: `${ITEM_ART}shelter-ticket.svg` },
    'cigarette-pack': { id: 'cigarette-pack', name: 'Pack of cigarettes', icon: '🚬', description: 'Pierre brought them, with the beers.', keepsake: false, art: `${ITEM_ART}cigarettes.svg` },
    crowbar: { id: 'crowbar', name: 'Crowbar', icon: '🔧', description: 'Tschick-Toni left it behind. Good for a stuck floorboard.', keepsake: false, art: `${ITEM_ART}crowbar.svg` },
    beers: { id: 'beers', name: 'Beers', icon: '🍺', description: 'Pierre brought them, as promised.', keepsake: false, art: `${ITEM_ART}beer.svg` },
    // found after the Pyramide game at Marokkanergasse (not given yet)
    'young-adult-adult-key': { id: 'young-adult-adult-key', name: 'Adult Age key', icon: '🗝️', description: 'The key found after the Pyramide game.', art: `${ITEM_ART}adult-key.svg` },
  },
  nodes: {
    'young-adult': {
      id: 'young-adult', kind: 'world', parent: 'hub', title: 'Young Adult', room: TRAM_5,
      unlock: { has: INTRO_KEY, who: 'elodie' },
      door: { x: 7, y: 4.7, w: 2.3, h: 1.2 },
      back: '← Back to Élodie’s dream apartment',
      hints: [
        { when: { unlocked: 'young-adult/shelter' }, text: 'Élodie, walk to Tram 5 or enter the Shelter.' },
        { text: 'Élodie, walk to Tram 5. The Shelter opens later.' },
      ],
    },
    [TRAM_5]: {
      id: TRAM_5, kind: 'world', parent: 'young-adult', title: 'Tram 5 — Wallensteinplatz',
      room: TRAM_5, unlock: { unlocked: 'young-adult' },
      door: { x: 2.4, y: 5.75, w: 3.2, h: 1.05 },
      back: false, compact: true,
      hints: [{ text: 'The tram waits at Wallensteinplatz.' }],
    },
    [TRAM_QUIZ]: {
      id: TRAM_QUIZ, kind: 'tableau', parent: TRAM_5, title: 'Tram 5 quiz',
      activity: { kind: 'quiz', settings: { count: 5, seconds: 20, mode: 'mixed' } }, replayable: true,
      unlock: { unlocked: TRAM_5 },
      // only through the tram's offer, and its lobby opens at once
      enterWhen: { machine: 'tram', in: ['offered'] }, startsOnEnter: true,
    },
    'young-adult/shelter': {
      id: 'young-adult/shelter', kind: 'world', parent: 'young-adult', title: 'The Shelter',
      room: 'young-adult/shelter', unlock: { all: [{ unlocked: 'young-adult' }, { flag: 'young-adult.shelter.open' }] },
      door: { x: 13.2, y: 5.75, w: 2.2, h: 1.05 },
      back: '← Stay at Wallensteinplatz',
      hints: [{ text: 'Élodie can return to Wallensteinplatz.' }],
    },
    'young-adult/appart-elo-1': {
      id: 'young-adult/appart-elo-1', kind: 'world', parent: TRAM_5, title: 'Appart Elo 1',
      room: 'young-adult/appart-elo-1', unlock: { unlocked: TRAM_5 },
      hints: [{ text: 'Élodie can return to Tram 5.' }],
    },
    'young-adult/appart-pierre': {
      id: 'young-adult/appart-pierre', kind: 'world', parent: TRAM_5, title: 'Marokkanergasse',
      room: 'young-adult/appart-pierre', unlock: { all: [{ unlocked: TRAM_5 }, { flag: 'young-adult.appart-pierre.open' }] },
      hints: [{ text: 'Élodie can return to Tram 5.' }],
    },
  },
  rooms: Object.fromEntries([TRAM_5_ROOM, SHELTER_ROOM, APPART_ELO_1_ROOM, APPART_PIERRE_ROOM].map((r) => [r.id, r])),
  roomArt: {
    [TRAM_5]: [
      { when: { flag: 'young-adult.shelter.open' }, src: `${ART}tram-5-night-shelter-open-v6.png` },
      { src: `${ART}tram-5-shelter-closed-v5.png` },
    ],
    'young-adult/shelter': [{ src: `${ART}shelter-interior-playable-v3.png` }],
    'young-adult/appart-elo-1': [
      { when: { machine: 'flat-lamp', in: ['off'] }, src: `${ART}appart-elo-1-lamp-off-v2.png` },
      { src: `${ART}appart-elo-1-basement-v1.png` },
    ],
    'young-adult/appart-pierre': [{ src: `${ART}marokkanergasse-eureka-v1.png` }],
  },
  machines: {
    // The painted tram: talking to it offers Élodie a quiz for 30 seconds; accepting enters its tableau.
    tram: {
      initial: 'waiting',
      states: {
        waiting: {
          objects: { 'tram-5-tram': { actions: [{ key: 'ride', text: '🚋 Tram 5' }] } },
          on: { 'ride:tram-5-tram': 'offered' },
        },
        offered: {
          objects: { 'tram-5-tram': { actions: [{ key: 'ride', text: '🚋 Tram 5' }] } },
          offer: { node: TRAM_QUIZ, text: 'A ticket for a quiz!', accept: 'Accept' },
          after: { ms: 30_000, to: 'waiting' },
          on: { [`entered:${TRAM_QUIZ}`]: 'waiting', 'ride:tram-5-tram': 'offered' },
        },
      },
    },
    // Tschick-Toni wants a cigarette. Given one from Pierre's pack (the pack stays), he says "Oida, geil!", then
    // leaves with his dog, and his crowbar stays on the floor.
    toni: {
      initial: 'wants-tschick',
      states: {
        'wants-tschick': {
          hints: { [TRAM_5]: 'A dog barks beside the Zigarettenautomat.' },
          npcs: { [DOG]: { say: 'Wuff!', blink: true } },
          objects: {
            [TONI]: {
              actions: [
                { key: 'give', text: '🚬 Give a cigarette', if: { has: 'cigarette-pack', who: 'elodie' } },
                { key: 'talk', text: '💬 Talk to Tschick-Toni', say: 'Tschick-Toni:\nHost a Tschick?\nI brauch dringend ane!', speaker: 'object' },
              ],
            },
          },
          on: { [`give:${TONI}`]: 'thanked' },
        },
        thanked: {
          npcs: { [TONI]: { say: 'Oida, geil!', emote: 'joy' } },
          after: { ms: 3000, to: 'gone' },
        },
        gone: {
          hide: [TONI, DOG],
          pickups: [{ item: 'crowbar', node: TRAM_5, x: 11.15, y: 7.5, radius: 0.9 }],
          on: { 'pickup:crowbar': 'crowbar-taken' },
        },
        'crowbar-taken': { hide: [TONI, DOG] },
      },
    },
    // Pierre arrives after three in-game hours, whatever Élodie did: from wisp to avatar, with his line. After
    // backgammon he is a wisp again, and the beers and the cigarettes lie on the floor. Backgammon doesn't exist
    // yet: the game master moves this machine to `after-backgammon`.
    'pierre-visit': {
      initial: 'not-yet',
      states: {
        'not-yet': { when: [{ if: { count: CLOCK, gte: 3 }, to: 'arrived' }] },
        // Pierre's wisp becomes his avatar (the 3-2-1 countdown), then he says his line over it
        arrived: {
          enter: [{ incarnate: 'pierre' }],
          speech: { pierre: 'I brought beers and cigarettes! But first, let’s play backgammon.' },
          hints: { [FLAT]: 'Pierre: “I brought beers and cigarettes! But first, let’s play backgammon.”' },
        },
        // back to his wisp after the game
        'after-backgammon': {
          enter: [{ wisp: 'pierre' }],
          pickups: [{ item: 'beers', node: FLAT, x: 7.6, y: 7.4, radius: 0.7 }, { item: 'cigarette-pack', node: FLAT, x: 8.6, y: 7.4, radius: 0.7 }],
          on: { 'pickup:beers': 'cigarettes-left', 'pickup:cigarette-pack': 'beers-left' },
        },
        'cigarettes-left': {
          pickups: [{ item: 'cigarette-pack', node: FLAT, x: 8.6, y: 7.4, radius: 0.7 }],
          on: { 'pickup:cigarette-pack': 'done' },
        },
        'beers-left': {
          pickups: [{ item: 'beers', node: FLAT, x: 7.6, y: 7.4, radius: 0.7 }],
          on: { 'pickup:beers': 'done' },
        },
        done: {},
      },
    },
    // The flat is dark at first; Élodie switches the floor lamp on and off (the painted background follows).
    'flat-lamp': {
      initial: 'off',
      states: {
        off: {
          hints: { [FLAT]: 'It’s dark in here. The lamp is by the bed.' },
          objects: { 'appart-elo-1-lamp': { actions: [{ key: 'switch', text: '💡 Turn on the lamp' }] } },
          on: { 'switch:appart-elo-1-lamp': 'on' },
        },
        on: {
          objects: { 'appart-elo-1-lamp': { actions: [{ key: 'switch', text: '💡 Turn off the lamp' }] } },
          on: { 'switch:appart-elo-1-lamp': 'off' },
        },
      },
    },
    // Passing the time in the flat: Columbo is one in-game hour, a book two; the empty beer bottles say who's late.
    flat: {
      initial: 'evening',
      states: {
        evening: {
          objects: {
            'appart-elo-1-tv': { actions: [{ key: 'columbo', text: '📺 Watch Columbo', say: 'One Columbo episode later… an hour has passed.' }] },
            'appart-elo-1-books': { actions: [{ key: 'read', text: '📖 Read a book', say: 'Two hours fly by in a good book.' }] },
            'appart-elo-1-beer': { actions: [{ key: 'examine', text: '🍾 Look at the bottles', say: 'Pierre said he’d bring beer.' }] },
          },
          on: {
            'columbo:appart-elo-1-tv': { to: 'evening', do: [{ count: CLOCK, by: 1 }] },
            'read:appart-elo-1-books': { to: 'evening', do: [{ count: CLOCK, by: 2 }] },
          },
        },
      },
    },
    // The Shelter ticket under a cracked floorboard: the crowbar lifts it, and the Shelter opens for the night.
    floorboard: {
      initial: 'stuck',
      states: {
        stuck: {
          objects: {
            'appart-elo-1-floorboard': {
              actions: [
                { key: 'lift', text: '🔧 Lift the floorboard', if: { has: 'crowbar', who: 'elodie' } },
                { key: 'look', text: '👀 Look at the floorboard', say: 'There’s a piece of paper stuck under the parquet floor. I can’t pull it out.' },
              ],
            },
          },
          on: { 'lift:appart-elo-1-floorboard': { to: 'lifted', do: [{ item: 'shelter-ticket' }, { flag: 'young-adult.shelter.open' }] } },
        },
        lifted: {},
      },
    },
  },
};
