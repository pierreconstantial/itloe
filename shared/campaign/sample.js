// Doors stand along the party room's back wall (between the window and the double door, floor line
// y = 4.6): the rect is the rug in front of each doorway — walking onto it enters.
// SAMPLE content with placeholder ids and copy: the engine's demo and test fixture. NO story here:
// the user writes the real content later, in its own files, with the same shape.
//   false start (blocks) → 3 block games → reward item + 'childhood' and 'teens' unlock AT ONCE
//   each world: a blocks tableau + a scene stub; both done → world done
//   World 1 also has a quiz, opening once its block game is done
//   both worlds done → 'adult' unlocks

/** @typedef {import('./types.js').Content} Content */

/** @type {Content} */
export const SAMPLE_CONTENT = {
  start: 'hub.false-start',
  chooser: 'elodie',
  nodes: {
    hub: { id: 'hub', kind: 'hub', parent: null, title: 'Hub (placeholder)', unlock: { always: true } },
    'hub.false-start': {
      id: 'hub.false-start', kind: 'tableau', parent: 'hub', title: 'Block game (placeholder)',
      activity: { kind: 'blocks' }, replayable: true,
      unlock: { always: true },
      complete: { count: 'blocks.played', gte: 3 },
      rewards: [{ item: 'reward-1' }, { flag: 'false-start-over' }],
      door: { x: 5.4, y: 4.7, w: 2, h: 1.2 },
    },

    childhood: {
      id: 'childhood', kind: 'world', parent: 'hub', title: 'World 1 (placeholder)',
      unlock: { done: 'hub.false-start' },
      complete: { all: [{ done: 'childhood.blocks' }, { done: 'childhood.scene' }] },
      door: { x: 2.2, y: 4.7, w: 2, h: 1.2 },
    },
    'childhood.blocks': {
      id: 'childhood.blocks', kind: 'tableau', parent: 'childhood', title: 'World 1 game (placeholder)',
      activity: { kind: 'blocks', settings: { size: 9 } }, replayable: true, unlock: { always: true },
      door: { x: 4.2, y: 4.7, w: 2, h: 1.2 },
    },
    'childhood.scene': {
      id: 'childhood.scene', kind: 'tableau', parent: 'childhood', title: 'World 1 scene (placeholder)',
      activity: { kind: 'scene', sceneId: 'childhood-1' }, unlock: { always: true },
      door: { x: 9.8, y: 4.7, w: 2, h: 1.2 },
    },
    'childhood.quiz': {
      id: 'childhood.quiz', kind: 'tableau', parent: 'childhood', title: 'World 1 quiz (placeholder)',
      activity: { kind: 'quiz', settings: { count: 5, seconds: 20, mode: 'mixed' } }, replayable: true,
      unlock: { done: 'childhood.blocks' }, // opens after the world's block game (not in the 3-games moment)
      door: { x: 7, y: 4.7, w: 2, h: 1.2 },
    },

    teens: {
      id: 'teens', kind: 'world', parent: 'hub', title: 'World 2 (placeholder)',
      unlock: { done: 'hub.false-start' },
      complete: { all: [{ done: 'teens.blocks' }, { done: 'teens.scene' }] },
      door: { x: 11.8, y: 4.7, w: 2, h: 1.2 },
    },
    'teens.blocks': {
      id: 'teens.blocks', kind: 'tableau', parent: 'teens', title: 'World 2 game (placeholder)',
      activity: { kind: 'blocks', settings: { mode: 'timed', timedSeconds: 120 } }, replayable: true, unlock: { always: true },
      door: { x: 4.2, y: 4.7, w: 2, h: 1.2 },
    },
    'teens.scene': {
      id: 'teens.scene', kind: 'tableau', parent: 'teens', title: 'World 2 scene (placeholder)',
      activity: { kind: 'scene', sceneId: 'teens-1' }, unlock: { always: true },
      door: { x: 9.8, y: 4.7, w: 2, h: 1.2 },
    },

    adult: {
      id: 'adult', kind: 'world', parent: 'hub', title: 'World 3 (placeholder)',
      unlock: { all: [{ done: 'childhood' }, { done: 'teens' }] },
      door: { x: 8.6, y: 4.7, w: 2, h: 1.2 },
    },
    'adult.scene': {
      id: 'adult.scene', kind: 'tableau', parent: 'adult', title: 'World 3 scene (placeholder)',
      activity: { kind: 'scene', sceneId: 'adult-1' }, unlock: { always: true },
      door: { x: 7, y: 4.7, w: 2, h: 1.2 },
    },
  },
};
