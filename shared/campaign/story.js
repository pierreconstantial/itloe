// Live birthday content. The sample campaign remains a fixture for engine tests.
// The unassigned memory-world entrances deliberately have no door coordinates.
/** @typedef {import('./types.js').Content} Content */

/** @type {readonly import('../characters.js').CharacterId[]} */
export const OPENING_PLAYERS = Object.freeze(['pierre', 'elodie', 'sol', 'anna']);
export const INTRO_KEY = 'memory-key-intro';
// mid-room, in the back half: the spawn row (shared/world.js) puts Sol right below it
export const PORTAL = Object.freeze({ x: 8, y: 5.4, radius: 0.9 });
export const INTRO_KEY_SPOT = Object.freeze({ x: 6.4, y: 6.6, radius: 0.8 });

/** Stable reunion flags; the mini-games that earn them can be connected as their rules are built. */
export const REUNIONS = Object.freeze([
  { id: 'pierre', name: 'Pierre', flag: 'person.pierre.unlocked', game: 'backgammon' },
  { id: 'sol', name: 'Sol', flag: 'person.sol.unlocked', game: 'blocks' },
  { id: 'anna', name: 'Anna', flag: 'person.anna.unlocked', game: 'blocks' },
  { id: 'nico', name: 'Nico', flag: 'person.nico.unlocked', game: 'word-clue' },
  { id: 'father', name: 'Father', flag: 'person.father.unlocked', game: 'dice' },
  { id: 'mother', name: 'Mother', flag: 'person.mother.unlocked', game: 'yahtzee' },
]);

export const MEMORY_WORLDS = Object.freeze([
  { id: 'childhood', title: 'Childhood', memories: ['Ariège', 'Father teaching primary school', 'Classical ballet', 'Bonfin', 'Fraternité blanche'] },
  { id: 'adolescence', title: 'Adolescence', memories: ['First cigarette at 13', 'Moped', 'Christel', 'Bars', 'Thiéfaine'] },
  { id: 'adult', title: 'Becoming an adult', memories: ['Éric', 'Loran', 'Alone in Switzerland', 'Camping and survival', 'Canary Islands', 'Horse-riding instructor', 'Holiday activity leader', 'Austrian romantic interests'] },
  { id: 'vienna', title: 'Young adulthood in Vienna', memories: ['Shikababe', 'Mathieu', 'Nico', 'Johanna', 'French language assistant', 'Belote with Fred and Vince', 'Jägerstraße'] },
  { id: 'pierre', title: 'Pierre enters her life', memories: ['Pierre', 'Flight attendant', 'Backgammon', 'Marokkanergasse'] },
  { id: 'family', title: 'Family life', memories: ["Sol's birth", 'Rosenburg', 'Anna', 'Bookseller', 'Rosenburg renovation', 'Life today'] },
]);

/** One key from the apparition, one from each memory world. @type {Content} */
export const STORY_CONTENT = {
  storyId: 'elo-50',
  start: 'hub.false-start',
  chooser: 'elodie',
  items: Object.fromEntries([
    [INTRO_KEY, { id: INTRO_KEY, name: 'First key of memory', icon: '🗝️', description: 'Left behind by the mysterious visitor.' }],
    ...MEMORY_WORLDS.map((world, i) => {
      const id = `memory-key-${i + 1}`;
      return [id, { id, name: `Memory key ${i + 1}`, icon: '🗝️', description: `A key from ${world.title.toLowerCase()}.` }];
    }),
  ]),
  nodes: {
    hub: { id: 'hub', kind: 'hub', parent: null, title: "Elo's Vienna apartment", room: 'apartment-room', unlock: { always: true } },
    'hub.false-start': {
      id: 'hub.false-start', kind: 'tableau', parent: 'hub', title: 'Block game',
      activity: { kind: 'blocks' }, replayable: true, unlock: { always: true },
      complete: { count: 'node.hub.false-start.finished', gte: 1 },
      rewards: [{ flag: 'portal.ready' }],
    },
    'hub.door4': {
      id: 'hub.door4', kind: 'world', parent: 'hub', title: 'Door #4', room: 'door-four-room',
      unlock: { has: INTRO_KEY, who: 'elodie' },
      door: { x: 7.6, y: 4.7, w: 2.7, h: 1.2 },
    },
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
};
