// Live birthday content. The sample campaign remains a fixture for engine tests.
// The unassigned memory-world entrances deliberately have no door coordinates.
/** @typedef {import('./types.js').Content} Content */

/** @type {readonly import('../characters.js').CharacterId[]} */
export const OPENING_PLAYERS = Object.freeze(['pierre', 'elodie', 'sol', 'anna']);

export const INTRO_KEY = 'memory-key-intro';
// mid-room, in the back half, behind the spawn row (shared/world.js)
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
  gameMaster: 'pierre',
  items: Object.fromEntries([
    [INTRO_KEY, { id: INTRO_KEY, name: 'First key of memory', icon: '🗝️', description: 'Left behind by the mysterious visitor.' }],
    ['shelter-ticket', { id: 'shelter-ticket', name: 'The Shelter concert ticket', icon: '🎟️',
      description: 'A ticket to a night at The Shelter.' }],
    ...MEMORY_WORLDS.map((world, i) => {
      const id = `memory-key-${i + 1}`;
      return [id, { id, name: `Memory key ${i + 1}`, icon: '🗝️', description: `A key from ${world.title.toLowerCase()}.` }];
    }),
  ]),
  nodes: {
    hub: { id: 'hub', kind: 'hub', parent: null, title: 'Élodie’s dream apartment', room: 'apartment-room', unlock: { always: true } },
    'hub.false-start': {
      id: 'hub.false-start', kind: 'tableau', parent: 'hub', title: 'Block game',
      // the four play it, and a round starts only with all four ready
      activity: { kind: 'blocks', eligible: [...OPENING_PLAYERS], allReady: true }, replayable: true, unlock: { always: true },
      complete: { count: 'node.hub.false-start.finished', gte: 1 },
      rewards: [{ flag: 'portal.ready' }],
    },
    'young-adult': {
      id: 'young-adult', kind: 'world', parent: 'hub', title: 'Young Adult', room: 'young-adult/tram-5',
      unlock: { has: INTRO_KEY, who: 'elodie' },
      door: { x: 7, y: 4.7, w: 2.3, h: 1.2 },
    },
    'young-adult/tram-5': {
      id: 'young-adult/tram-5', kind: 'world', parent: 'young-adult', title: 'Tram 5 — Wallensteinplatz',
      room: 'young-adult/tram-5', unlock: { unlocked: 'young-adult' },
      door: { x: 2.4, y: 5.75, w: 3.2, h: 1.05 },
    },
    'young-adult/tram-5/quiz': {
      id: 'young-adult/tram-5/quiz', kind: 'tableau', parent: 'young-adult/tram-5', title: 'Tram 5 quiz',
      activity: { kind: 'quiz', settings: { count: 5, seconds: 20, mode: 'mixed' } }, replayable: true,
      unlock: { unlocked: 'young-adult/tram-5' },
    },
    'young-adult/shelter': {
      id: 'young-adult/shelter', kind: 'world', parent: 'young-adult', title: 'The Shelter',
      room: 'young-adult/shelter', unlock: { all: [{ unlocked: 'young-adult' }, { flag: 'young-adult.shelter.open' }] },
      door: { x: 13.2, y: 5.75, w: 2.2, h: 1.05 },
    },
    'young-adult/appart-elo-1': {
      id: 'young-adult/appart-elo-1', kind: 'world', parent: 'young-adult/tram-5', title: 'Appart Elo 1',
      room: 'young-adult/appart-elo-1', unlock: { unlocked: 'young-adult/tram-5' },
    },
    'young-adult/appart-pierre': {
      id: 'young-adult/appart-pierre', kind: 'world', parent: 'young-adult/tram-5', title: 'Appart Pierre',
      room: 'young-adult/appart-pierre', unlock: { all: [{ unlocked: 'young-adult/tram-5' }, { flag: 'young-adult.appart-pierre.open' }] },
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
