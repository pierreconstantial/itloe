// SAMPLE content with placeholder ids and copy: the engine's demo and test fixture. NO story here:
// the user writes the real content later, in its own files, with the same shape.
//   false start (blocks) → 3 block games → reward item + 'childhood' and 'teens' unlock AT ONCE
//   each world: a blocks tableau + a scene stub; both done → world done
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
      door: { x: 7, y: 5, w: 2, h: 1.5 },
    },

    childhood: {
      id: 'childhood', kind: 'world', parent: 'hub', title: 'World 1 (placeholder)',
      unlock: { done: 'hub.false-start' },
      complete: { all: [{ done: 'childhood.blocks' }, { done: 'childhood.scene' }] },
      door: { x: 1, y: 3, w: 2, h: 2 },
    },
    'childhood.blocks': {
      id: 'childhood.blocks', kind: 'tableau', parent: 'childhood', title: 'World 1 game (placeholder)',
      activity: { kind: 'blocks', settings: { size: 9 } }, replayable: true, unlock: { always: true },
      door: { x: 3, y: 5, w: 2, h: 2 },
    },
    'childhood.scene': {
      id: 'childhood.scene', kind: 'tableau', parent: 'childhood', title: 'World 1 scene (placeholder)',
      activity: { kind: 'scene', sceneId: 'childhood-1' }, unlock: { always: true },
      door: { x: 11, y: 5, w: 2, h: 2 },
    },

    teens: {
      id: 'teens', kind: 'world', parent: 'hub', title: 'World 2 (placeholder)',
      unlock: { done: 'hub.false-start' },
      complete: { all: [{ done: 'teens.blocks' }, { done: 'teens.scene' }] },
      door: { x: 13, y: 3, w: 2, h: 2 },
    },
    'teens.blocks': {
      id: 'teens.blocks', kind: 'tableau', parent: 'teens', title: 'World 2 game (placeholder)',
      activity: { kind: 'blocks', settings: { mode: 'timed', timedSeconds: 120 } }, replayable: true, unlock: { always: true },
      door: { x: 3, y: 5, w: 2, h: 2 },
    },
    'teens.scene': {
      id: 'teens.scene', kind: 'tableau', parent: 'teens', title: 'World 2 scene (placeholder)',
      activity: { kind: 'scene', sceneId: 'teens-1' }, unlock: { always: true },
      door: { x: 11, y: 5, w: 2, h: 2 },
    },

    adult: {
      id: 'adult', kind: 'world', parent: 'hub', title: 'World 3 (placeholder)',
      unlock: { all: [{ done: 'childhood' }, { done: 'teens' }] },
      door: { x: 7, y: 2, w: 2, h: 1.5 },
    },
    'adult.scene': {
      id: 'adult.scene', kind: 'tableau', parent: 'adult', title: 'World 3 scene (placeholder)',
      activity: { kind: 'scene', sceneId: 'adult-1' }, unlock: { always: true },
      door: { x: 7, y: 5, w: 2, h: 2 },
    },
  },
};
