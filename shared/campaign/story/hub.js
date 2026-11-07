// The hub: the false start (the opening block game), the portal, the apparition and the first key, Élodie's
// dream apartment, and the doors to the memory worlds. Story data only (docs/story-engine.md).
import { room, prop } from '../../scene.js';

/** @typedef {import('../types.js').Content} Content */

export const INTRO_KEY = 'memory-key-intro';

/** The four who play the opening block game as themselves. @type {readonly import('../../characters.js').CharacterId[]} */
export const OPENING_PLAYERS = Object.freeze(['pierre', 'elodie', 'sol', 'anna']);

/** Stable reunion flags: the flag that introduces each person. The mini-games that earn them come later. */
export const REUNIONS = Object.freeze([
  { id: 'pierre', name: 'Pierre', flag: 'person.pierre.unlocked' },
  { id: 'sol', name: 'Sol', flag: 'person.sol.unlocked' },
  { id: 'anna', name: 'Anna', flag: 'person.anna.unlocked' },
  { id: 'nico', name: 'Nico', flag: 'person.nico.unlocked' },
  { id: 'mathieu', name: 'Mathieu', flag: 'person.mathieu.unlocked' },
  { id: 'father', name: 'Father', flag: 'person.father.unlocked' },
  { id: 'mother', name: 'Mother', flag: 'person.mother.unlocked' },
]);

export const MEMORY_WORLDS = Object.freeze([
  { id: 'childhood', title: 'Childhood', memories: ['Ariège', 'Father teaching primary school', 'Classical ballet', 'Bonfin', 'Fraternité blanche'] },
  { id: 'adolescence', title: 'Adolescence', memories: ['First cigarette at 13', 'Moped', 'Christel', 'Bars', 'Thiéfaine'] },
  { id: 'adult', title: 'Becoming an adult', memories: ['Éric', 'Loran', 'Alone in Switzerland', 'Camping and survival', 'Canary Islands', 'Horse-riding instructor', 'Holiday activity leader', 'Austrian romantic interests'] },
  { id: 'vienna', title: 'Young adulthood in Vienna', memories: ['Shikababe', 'Mathieu', 'Nico', 'Johanna', 'French language assistant', 'Belote with Fred and Vince', 'Jägerstraße'] },
  { id: 'pierre', title: 'Pierre enters her life', memories: ['Pierre', 'Flight attendant', 'Backgammon', 'Marokkanergasse'] },
  { id: 'family', title: 'Family life', memories: ["Sol's birth", 'Rosenburg', 'Anna', 'Bookseller', 'Rosenburg renovation', 'Life today'] },
]);

/** Élodie's dream apartment: the party room's floor with its own furniture; the art is painted (roomArt). */
const APARTMENT_ROOM = room('apartment-room', { x: 0.5, y: 4.8, w: 15, h: 4 }, [
  prop('sofa', { x: 0.1, y: 4.2, w: 2.1, h: 1.7 }, { anchorY: 5.9, solid: { x: 0.5, y: 4.85, w: 1.7, h: 1.05 } }),
  prop('plant', { x: 1.55, y: 3, w: 1.05, h: 1.9 }, { anchorY: 4.9, solid: { x: 1.85, y: 4.75, w: 0.55, h: 0.4 } }),
], [
  { x: 2.35, y: 4.9, w: 0.95, h: 0.6 }, // armchair
  { x: 5.5, y: 4.85, w: 1.1, h: 0.55 }, // bookshelf
  { x: 12.35, y: 4.75, w: 2.8, h: 1.1 }, // terrace table and chairs
]);

/** @type {Pick<Content, 'items' | 'nodes' | 'rooms' | 'machines' | 'roomArt'>} */
export const HUB = {
  items: Object.fromEntries([
    [INTRO_KEY, { id: INTRO_KEY, name: 'First key of memory', icon: '🗝️', description: 'Left behind by the mysterious visitor.', keepsake: false }],
    ...MEMORY_WORLDS.map((world, i) => {
      const id = `memory-key-${i + 1}`;
      return [id, { id, name: `Memory key ${i + 1}`, icon: '🗝️', description: `A key from ${world.title.toLowerCase()}.`, keepsake: false }];
    }),
  ]),
  nodes: {
    hub: {
      id: 'hub', kind: 'hub', parent: null, title: 'Élodie’s dream apartment', room: 'apartment-room', unlock: { always: true },
      hints: [{ text: 'Élodie, enter the Young Adult room.' }],
    },
    'hub.false-start': {
      id: 'hub.false-start', kind: 'tableau', parent: 'hub', title: 'Block game',
      // the four play it, and a round starts only with all four ready
      activity: { kind: 'blocks', eligible: [...OPENING_PLAYERS], allReady: true }, replayable: true, unlock: { always: true },
      complete: { count: 'node.hub.false-start.finished', gte: 1 },
    },
    // the memory worlds' entrances deliberately have no door coordinates yet
    ...Object.fromEntries(MEMORY_WORLDS.map((world, i) => {
      const id = `memory.${world.id}`;
      return [id, {
        id, kind: 'world', parent: 'hub', title: world.title,
        intro: 'Its scenes and entrance are still to be defined.',
        unlock: { flag: `route.${world.id}` },
        complete: { has: `memory-key-${i + 1}`, who: 'elodie' },
      }];
    })),
    future: {
      id: 'future', kind: 'world', parent: 'hub', title: 'The future',
      intro: 'The future remains unknown.',
      unlock: { all: [INTRO_KEY, ...MEMORY_WORLDS.map((_, i) => `memory-key-${i + 1}`)].map((has) => ({ has, who: 'elodie' })) },
    },
  },
  rooms: { [APARTMENT_ROOM.id]: APARTMENT_ROOM },
  roomArt: { [APARTMENT_ROOM.id]: [{ src: '/assets/places/hub/elodie-dream-apartment-oriental-rug-v2.png' }] },
  machines: {
    // The opening: Pierre ends the block game → a portal → Élodie walks in, the others become wisps → the
    // apparition (Élodie held still) → the key on the floor → picked up.
    opening: {
      initial: 'false-start',
      states: {
        'false-start': { when: [{ if: { done: 'hub.false-start' }, to: 'portal-open' }] },
        'portal-open': {
          hints: { 'hub.false-start': 'A portal has appeared. Élodie, walk into it!' },
          // mid-room, in the back half, behind the spawn row (shared/world.js)
          zones: [{ id: 'portal', node: 'hub.false-start', x: 8, y: 5.4, radius: 0.9, look: 'portal', arrive: { x: 6.2, y: 7.3 } }],
          on: { 'zone:portal': 'apparition' },
        },
        // entering it (through the portal, or the game master replaying it) moves everyone and plays the visitor
        apparition: {
          enter: [{ wisp: 'others' }, { goto: 'hub' }, { cutscene: 'apparition' }],
          holdChooser: 'hub',
          hints: { hub: 'A visitor is appearing… watch the TV.', 'hub.false-start': 'Élodie went through the portal.' },
          on: { 'cutscene:apparition': 'key-on-floor' },
        },
        'key-on-floor': {
          hints: { hub: 'Élodie, pick up the glowing key.', 'hub.false-start': 'Élodie went through the portal.' },
          pickups: [{ item: INTRO_KEY, node: 'hub', x: 6.4, y: 6.6, radius: 0.8 }],
          on: { [`pickup:${INTRO_KEY}`]: 'done' },
        },
        done: { hints: { 'hub.false-start': 'Élodie went through the portal.' } },
      },
    },
  },
};
