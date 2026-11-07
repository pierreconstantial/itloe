// The birthday story (GameStory.md) as content: one file per world, merged here. Story data only; the engine,
// the server and the clients read it generically (docs/story-engine.md).
import { HUB, INTRO_KEY, OPENING_PLAYERS, REUNIONS, MEMORY_WORLDS } from './hub.js';
import { YOUNG_ADULT } from './young-adult.js';

export { INTRO_KEY, OPENING_PLAYERS, REUNIONS, MEMORY_WORLDS };

/** @typedef {import('../types.js').Content} Content */

const PARTS = [HUB, YOUNG_ADULT];

/** @type {Content} */
export const STORY_CONTENT = {
  start: 'hub.false-start',
  chooser: 'elodie',
  gameMaster: 'pierre',
  cast: {
    opening: [...OPENING_PLAYERS],
    introducedBy: Object.fromEntries(REUNIONS.map((r) => [r.id, r.flag])),
  },
  // once Élodie went through the portal, she alone moves the party
  leadAfter: { not: { machine: 'opening', in: ['false-start', 'portal-open'] } },
  // where the game master can take the party from his panel, to stand in for what isn't built yet
  gmPlaces: ['hub.false-start', 'hub', 'young-adult', 'young-adult/tram-5', 'young-adult/appart-elo-1',
    'young-adult/shelter', 'young-adult/appart-pierre'],
  items: Object.assign({}, ...PARTS.map((p) => p.items)),
  nodes: Object.assign({}, ...PARTS.map((p) => p.nodes)),
  rooms: Object.assign({}, ...PARTS.map((p) => p.rooms)),
  roomArt: Object.assign({}, ...PARTS.map((p) => p.roomArt)),
  machines: Object.assign({}, ...PARTS.map((p) => p.machines)),
};
