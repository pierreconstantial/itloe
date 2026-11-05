import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, reduceCampaign, validateContent, holding, roomAt, SAMPLE_CONTENT } from '../shared/campaign/index.js';
import { INTRO_KEY, MEMORY_WORLDS, OPENING_PLAYERS, PORTAL, STORY_CONTENT } from '../shared/campaign/story.js';
import { APARTMENT_ROOM, DOOR_FOUR_ROOM, PARTY_ROOM, spawnAt } from '../shared/scene.js';
import { CHARACTERS } from '../shared/characters.js';

/** @param {import('../shared/campaign/types.js').Campaign} campaign
 * @param {import('../shared/campaign/types.js').CampaignAction} action */
const act = (campaign, action) => reduceCampaign(campaign, action, STORY_CONTENT);

test('birthday content begins with only the block game, no key or memory-world access', () => {
  assert.deepEqual(validateContent(STORY_CONTENT), []);
  const c = newCampaign(STORY_CONTENT, 42);
  assert.equal(c.at.node, 'hub.false-start');
  assert.equal(c.at.activity?.phase, 'lobby');
  assert.equal(c.facts.flags.includes('portal.ready'), false);
  assert.equal(c.facts.unlocked.includes('future'), false);
  assert.equal(c.facts.unlocked.includes('hub.door4'), false);
  assert.equal(MEMORY_WORLDS.length, 6);
});

test('opening match, portal, apparition, pickup and door #4 are one-time and Elo-only', () => {
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'join', id: character, character });
  c = act(c, { t: 'activity', action: { t: 'start', id: 'pierre', now: 1000 } });
  c = act(c, { t: 'activity', action: { t: 'endGame', id: 'pierre' } });
  assert.equal(c.facts.flags.includes('portal.ready'), true);
  assert.equal(holding(c.facts, 'elodie', INTRO_KEY), 0);
  c = act(c, { t: 'activity', action: { t: 'newGame', id: 'pierre' } });
  assert.equal(c.at.activity?.phase, 'lobby');
  assert.equal(act(c, { t: 'portal', id: 'pierre' }), c);
  c = act(c, { t: 'portal', id: 'elodie' });
  assert.equal(c.at.node, 'hub');
  assert.equal(c.party.order.length, 4);
  assert.equal(c.news.filter((n) => n.t === 'apparition').length, 1);
  assert.equal(act(c, { t: 'portal', id: 'elodie' }), c);
  assert.equal(act(c, { t: 'collect', id: 'elodie', item: INTRO_KEY }), c);
  const apparition = c.news.find((n) => n.t === 'apparition');
  assert.ok(apparition);
  c = act(c, { t: 'ack', id: 'screen', upTo: apparition.seq });
  assert.equal(c.facts.flags.includes('apparition.seen'), true);
  assert.equal(act(c, { t: 'collect', id: 'pierre', item: INTRO_KEY }), c);
  c = act(c, { t: 'collect', id: 'elodie', item: INTRO_KEY });
  assert.equal(holding(c.facts, 'elodie', INTRO_KEY), 1);
  assert.equal(c.facts.unlocked.includes('hub.door4'), true);
  assert.equal(act(c, { t: 'collect', id: 'elodie', item: INTRO_KEY }), c);
  assert.equal(act(c, { t: 'enter', id: 'pierre', node: 'hub.door4' }), c);
  c = act(c, { t: 'enter', id: 'elodie', node: 'hub.door4' });
  assert.equal(c.at.node, 'hub.door4');
  c = act(c, { t: 'back', id: 'elodie' });
  assert.equal(c.at.node, 'hub');
  assert.equal(holding(c.facts, 'elodie', INTRO_KEY), 1);
  assert.equal(c.news.filter((n) => n.t === 'apparition').length, 0);
});

test('future needs all seven keys, while world entrances remain unassigned', () => {
  let c = newCampaign(STORY_CONTENT, 42);
  c = act(c, { t: 'join', id: 'elodie', character: 'elodie' });
  assert.ok(MEMORY_WORLDS.every((w) => !STORY_CONTENT.nodes[`memory.${w.id}`].door));
  for (let i = 1; i <= 6; i++) {
    c = act(c, { t: 'gm', id: 'elodie', op: { op: 'give', item: `memory-key-${i}`, to: 'elodie' } });
  }
  assert.equal(c.facts.unlocked.includes('future'), false);
  c = act(c, { t: 'gm', id: 'elodie', op: { op: 'give', item: INTRO_KEY, to: 'elodie' } });
  assert.equal(c.facts.unlocked.includes('future'), true);
});

test('the portal stands clear of every avatar on the party room\'s spawn row', () => {
  // an avatar is drawn 1.2 units tall above its feet (AVATAR_UNITS in public/screen/party-room.js)
  for (const character of /** @type {import('../shared/characters.js').CharacterId[]} */ (Object.keys(CHARACTERS))) {
    const at = spawnAt(PARTY_ROOM, character);
    assert.ok(at.y - 1.2 > PORTAL.y + PORTAL.radius || Math.abs(at.x - PORTAL.x) > PORTAL.radius,
      `${character} starts at ${at.x}, ${at.y}, in front of the portal`);
  }
});

test('the story names its rooms by node: the hub is the apartment, door #4 its own room, the rest the party room', () => {
  assert.equal(roomAt(STORY_CONTENT, 'hub'), APARTMENT_ROOM);
  assert.equal(roomAt(STORY_CONTENT, 'hub.door4'), DOOR_FOUR_ROOM);
  for (const node of ['hub.false-start', 'memory.childhood', 'future']) assert.equal(roomAt(STORY_CONTENT, node), PARTY_ROOM);
  assert.equal(roomAt(SAMPLE_CONTENT, 'hub'), PARTY_ROOM);
  assert.equal(roomAt(STORY_CONTENT, undefined), PARTY_ROOM);
});
