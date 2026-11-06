import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, loadCampaign, reduceCampaign, validateContent, holding } from '../shared/campaign/index.js';
import { INTRO_KEY, MEMORY_WORLDS, OPENING_PLAYERS, STORY_CONTENT } from '../shared/campaign/story.js';

/** @param {import('../shared/campaign/types.js').Campaign} campaign
 * @param {import('../shared/campaign/types.js').CampaignAction} action */
const act = (campaign, action) => reduceCampaign(campaign, action, STORY_CONTENT);

test('Nico joins as a wisp, stays out of rounds, and incarnates when introduced', () => {
  let early = act(newCampaign(STORY_CONTENT, 4), { t: 'join', id: 'nico-first', character: 'nico' });
  assert.equal(early.party.hostId, null, 'a wisp cannot host the opening round');
  early = act(early, { t: 'join', id: 'elo-first', character: 'elodie' });
  assert.equal(early.party.hostId, 'elo-first');
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'join', id: character, character });
  c = act(c, { t: 'join', id: 'nico-player', character: 'nico' });
  assert.deepEqual(c.party.players['nico-player'].statuses, ['wisp']);
  c = act(c, { t: 'start', id: 'pierre', now: 1000 });
  assert.equal(c.at.activity?.players['nico-player'], undefined);
  c = act(c, { t: 'activity', action: { t: 'endGame', id: 'pierre' } });
  c = act(c, { t: 'newGame', id: 'pierre' });
  c = act(c, { t: 'portal', id: 'elodie' });
  assert.deepEqual(c.party.players.pierre.statuses, ['wisp']);
  assert.equal(c.party.hostId, 'elodie');
  assert.equal(act(c, { t: 'gm', id: 'elodie', op: { op: 'setFlag', flag: 'person.nico.unlocked', on: true } }), c,
    'the host cannot use Pierre’s game-master controls');
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'person.nico.unlocked', on: true } });
  assert.deepEqual(c.party.players['nico-player'].statuses, ['wisp', 'incarnating']);
  c = act(c, { t: 'incarnate', id: 'nico-player' });
  assert.deepEqual(c.party.players['nico-player'].statuses, []);
  c = act(c, { t: 'status', id: 'nico-player', status: 'wisp', on: true });
  assert.deepEqual(c.party.players['nico-player'].statuses, ['wisp']);
});

test('birthday content begins with only the block game, no key or memory-world access', () => {
  assert.deepEqual(validateContent(STORY_CONTENT), []);
  const c = newCampaign(STORY_CONTENT, 42);
  assert.equal(c.at.node, 'hub.false-start');
  assert.deepEqual([c.at.kind, c.at.activity], ['blocks', null], 'the room at the block tableau');
  assert.equal(c.facts.flags.includes('portal.ready'), false);
  assert.equal(c.facts.unlocked.includes('future'), false);
  assert.equal(c.facts.unlocked.includes('hub.door4'), false);
});

test('opening match, portal, apparition, pickup and door #4 are one-time and Elo-only', () => {
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'join', id: character, character });
  c = act(c, { t: 'start', id: 'pierre', now: 1000 });
  c = act(c, { t: 'activity', action: { t: 'endGame', id: 'pierre' } });
  assert.equal(c.facts.flags.includes('portal.ready'), true);
  assert.equal(holding(c.facts, 'elodie', INTRO_KEY), 0);
  c = act(c, { t: 'newGame', id: 'pierre' });
  assert.equal(c.at.activity, null, 'back in the room');
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
  c = act(c, { t: 'join', id: 'pierre', character: 'pierre' });
  assert.ok(MEMORY_WORLDS.every((w) => !STORY_CONTENT.nodes[`memory.${w.id}`].door));
  for (let i = 1; i <= 6; i++) {
    c = act(c, { t: 'gm', id: 'pierre', op: { op: 'give', item: `memory-key-${i}`, to: 'elodie' } });
  }
  assert.equal(c.facts.unlocked.includes('future'), false);
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'give', item: INTRO_KEY, to: 'elodie' } });
  assert.equal(c.facts.unlocked.includes('future'), true);
});

test('a saved opening podium with no remaining host resumes in the portal room', () => {
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'join', id: character, character });
  c = act(c, { t: 'start', id: 'pierre', now: 1000 });
  c = act(c, { t: 'activity', action: { t: 'endGame', id: 'pierre' } });
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'leave', id: character });
  assert.equal(c.party.hostId, null);
  assert.equal(c.at.activity !== null, true);
  const resumed = loadCampaign(c, STORY_CONTENT);
  assert.equal(resumed.at.activity, null);
  assert.equal(resumed.facts.flags.includes('portal.ready'), true);
  assert.equal(resumed.facts.counters['blocks.played'], 1);
  const joined = act(resumed, { t: 'join', id: 'elo-returned', character: 'elodie' });
  assert.equal(joined.party.hostId, 'elo-returned');
  assert.equal(act(joined, { t: 'portal', id: 'elo-returned' }).at.node, 'hub');
});
