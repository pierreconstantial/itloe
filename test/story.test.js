import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, loadCampaign, reduceCampaign, validateContent, holding, gameMasterId, roomAt } from '../shared/campaign/index.js';
import { INTRO_KEY, MEMORY_WORLDS, OPENING_PLAYERS, STORY_CONTENT } from '../shared/campaign/story.js';
import { CHARACTERS } from '../shared/characters.js';

/** @param {import('../shared/campaign/types.js').Campaign} campaign
 * @param {import('../shared/campaign/types.js').CampaignAction} action */
const act = (campaign, action) => reduceCampaign(campaign, action, STORY_CONTENT);
/** @param {import('../shared/campaign/types.js').Campaign} campaign @param {...any} actions
 * @returns {import('../shared/campaign/types.js').Campaign} */
const inGame = (campaign, ...actions) => actions.reduce((c, action) => act(c, { t: 'activity', action }), campaign);

/** The four join; Pierre starts the block game, all four get ready, and he starts its round. */
function openingRound() {
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'join', id: character, character });
  c = act(c, { t: 'startMinigame', id: 'pierre', now: 1000 });
  return inGame(c, ...OPENING_PLAYERS.map((id) => ({ t: 'ready', id, on: true })), { t: 'start', id: 'pierre', now: 1000 });
}

test('Nico joins as a wisp, stays out of rounds, and incarnates when introduced', () => {
  let early = act(newCampaign(STORY_CONTENT, 4), { t: 'join', id: 'nico-first', character: 'nico' });
  early = act(early, { t: 'join', id: 'elo-first', character: 'elodie' });
  assert.equal(gameMasterId(early.party, STORY_CONTENT), null, 'nobody but Pierre is the game master');
  assert.equal(act(early, { t: 'startMinigame', id: 'elo-first', now: 1000 }), early, 'nobody can start before Pierre joins');
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'join', id: character, character });
  c = act(c, { t: 'join', id: 'nico-player', character: 'nico' });
  assert.deepEqual(c.party.players['nico-player'].statuses, ['wisp']);
  c = act(c, { t: 'startMinigame', id: 'pierre', now: 1000 });
  assert.equal(c.at.activity?.players.some((p) => p.id === 'nico-player'), false, 'not among the opening\'s players');
  c = inGame(c, ...OPENING_PLAYERS.map((id) => ({ t: 'ready', id, on: true })), { t: 'start', id: 'pierre', now: 1000 },
    { t: 'endGame', id: 'pierre' }, { t: 'lobby', id: 'pierre' });
  c = act(c, { t: 'endMinigame', id: 'pierre' });
  c = act(c, { t: 'portal', id: 'elodie' });
  assert.deepEqual(c.party.players.pierre.statuses, ['wisp']);
  assert.equal(gameMasterId(c.party, STORY_CONTENT), 'pierre', 'Pierre stays the game master as a wisp');
  assert.equal(act(c, { t: 'gm', id: 'elodie', op: { op: 'setFlag', flag: 'person.nico.unlocked', on: true } }), c,
    'Élodie cannot use the game-master controls');
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'person.nico.unlocked', on: true } });
  assert.deepEqual(c.party.players['nico-player'].statuses, ['wisp', 'incarnating']);
  c = act(c, { t: 'incarnate', id: 'nico-player' });
  assert.deepEqual(c.party.players['nico-player'].statuses, []);
  c = act(c, { t: 'status', id: 'nico-player', status: 'wisp', on: true });
  assert.deepEqual(c.party.players['nico-player'].statuses, ['wisp']);
});

test('Mathieu can join as the seventh character, resume his saved identity and incarnate when introduced', () => {
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of Object.keys(CHARACTERS)) {
    c = act(c, { t: 'join', id: character, character: /** @type {import('../shared/characters.js').CharacterId} */ (character) });
  }
  assert.equal(c.party.order.length, 7);
  assert.deepEqual(c.party.players.mathieu.statuses, ['wisp']);
  assert.equal(act(c, { t: 'join', id: 'another-mathieu', character: 'mathieu' }), c, 'one holder per character');
  const resumed = loadCampaign(JSON.parse(JSON.stringify(c)), STORY_CONTENT);
  assert.ok(resumed);
  c = resumed;
  assert.equal(c.party.players.mathieu.character, 'mathieu');
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'person.mathieu.unlocked', on: true } });
  assert.deepEqual(c.party.players.mathieu.statuses, ['wisp', 'incarnating']);
  c = act(c, { t: 'incarnate', id: 'mathieu' });
  assert.deepEqual(c.party.players.mathieu.statuses, []);
});

test('birthday content begins with only the block game, no key or memory-world access', () => {
  assert.deepEqual(validateContent(STORY_CONTENT), []);
  const c = newCampaign(STORY_CONTENT, 42);
  assert.equal(c.at.node, 'hub.false-start');
  assert.deepEqual([c.at.kind, c.at.activity], ['blocks', null], 'the room at the block tableau');
  assert.equal(c.facts.flags.includes('portal.ready'), false);
  assert.equal(c.facts.unlocked.includes('future'), false);
  assert.equal(c.facts.unlocked.includes('young-adult'), false);
});

test('the opening\'s block game starts a round only with all four in the party and ready', () => {
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of ['pierre', 'elodie', 'sol']) c = act(c, { t: 'join', id: character, character: /** @type {any} */ (character) });
  c = act(c, { t: 'join', id: 'nico', character: 'nico' });
  c = act(c, { t: 'startMinigame', id: 'pierre', now: 1000 });
  c = inGame(c, ...['pierre', 'elodie', 'sol', 'nico'].map((id) => ({ t: 'ready', id, on: true })));
  assert.deepEqual(c.at.activity?.ready, ['pierre', 'elodie', 'sol'], 'Nico isn\'t one of the four');
  assert.equal(inGame(c, { t: 'start', id: 'pierre', now: 1000 }), c, 'three ready, Anna not in the party');
  c = act(c, { t: 'join', id: 'anna', character: 'anna' });
  assert.deepEqual(c.at.activity?.players.map((p) => p.id), ['pierre', 'elodie', 'sol', 'anna'], 'Anna joins the opening\'s players');
  assert.equal(inGame(c, { t: 'start', id: 'pierre', now: 1000 }), c, 'Anna not ready');
  c = inGame(c, { t: 'ready', id: 'anna', on: true }, { t: 'start', id: 'pierre', now: 1000 });
  assert.deepEqual(c.at.activity?.round?.order, ['pierre', 'elodie', 'sol', 'anna']);
});

test('opening match, portal, apparition, pickup and Young Adult are one-time and Elo-only', () => {
  let c = inGame(openingRound(), { t: 'endGame', id: 'pierre' });
  assert.equal(c.facts.flags.includes('portal.ready'), false, 'no portal on the podium');
  c = inGame(c, { t: 'lobby', id: 'pierre' });
  assert.equal(c.facts.flags.includes('portal.ready'), false, 'nor in the lobby');
  c = act(c, { t: 'endMinigame', id: 'pierre' });
  assert.equal(c.facts.flags.includes('portal.ready'), true, 'the portal, once Pierre ends the block game');
  assert.equal(holding(c.facts, 'elodie', INTRO_KEY), 0);
  assert.equal(c.at.activity, null, 'back in the room');
  const again = act(c, { t: 'startMinigame', id: 'pierre', now: 2000 });
  assert.equal(again.at.activity?.stage, 'lobby', 'nothing refuses a second block game once the portal is ready');
  assert.equal(act(again, { t: 'portal', id: 'elodie' }), again, 'no portal while the block game runs');
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
  assert.equal(c.facts.unlocked.includes('young-adult'), true);
  assert.equal(act(c, { t: 'collect', id: 'elodie', item: INTRO_KEY }), c);
  assert.equal(act(c, { t: 'enter', id: 'pierre', node: 'young-adult' }), c);
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult' });
  assert.equal(c.at.node, 'young-adult');
  assert.equal(roomAt(STORY_CONTENT, c.at.node).id, 'young-adult/tram-5');
  assert.equal(c.facts.unlocked.includes('young-adult/tram-5'), true);
  assert.equal(c.facts.unlocked.includes('young-adult/appart-elo-1'), true);
  assert.equal(c.facts.unlocked.includes('young-adult/shelter'), false);
  assert.equal(c.facts.unlocked.includes('young-adult/appart-pierre'), false);
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5' });
  assert.equal(c.at.node, 'young-adult/tram-5');
  assert.equal(act(c, { t: 'enter', id: 'elodie', node: 'young-adult/appart-pierre' }), c, 'Pierre’s flat is still locked');
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/appart-elo-1' });
  assert.equal(roomAt(STORY_CONTENT, c.at.node).id, 'young-adult/appart-elo-1');
  c = act(c, { t: 'back', id: 'elodie' });
  assert.equal(c.at.node, 'young-adult/tram-5');
  c = act(c, { t: 'back', id: 'elodie' });
  assert.equal(c.at.node, 'young-adult');
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'young-adult.shelter.open', on: true } });
  assert.equal(c.facts.unlocked.includes('young-adult/shelter'), true);
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/shelter' });
  assert.equal(roomAt(STORY_CONTENT, c.at.node).id, 'young-adult/shelter');
  c = act(c, { t: 'back', id: 'elodie' });
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5' });
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'young-adult.appart-pierre.open', on: true } });
  assert.equal(c.facts.unlocked.includes('young-adult/appart-pierre'), true);
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/appart-pierre' });
  assert.equal(roomAt(STORY_CONTENT, c.at.node).id, 'young-adult/appart-pierre');
  c = act(c, { t: 'back', id: 'elodie' });
  c = act(c, { t: 'back', id: 'elodie' });
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

test('a saved opening podium with nobody left resumes there; Pierre, rejoining, ends the block game and the portal appears', () => {
  let c = inGame(openingRound(), { t: 'endGame', id: 'pierre' });
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'leave', id: character });
  assert.equal(gameMasterId(c.party, STORY_CONTENT), null);
  const resumed = loadCampaign(JSON.parse(JSON.stringify(c)), STORY_CONTENT);
  assert.equal(resumed.at.activity?.stage, 'podium', 'still on the podium');
  assert.equal(resumed.at.results.length, 1, 'with the round\'s result');
  let back = act(resumed, { t: 'join', id: 'pierre-returned', character: 'pierre' });
  back = act(inGame(back, { t: 'lobby', id: 'pierre-returned' }), { t: 'endMinigame', id: 'pierre-returned' });
  assert.equal(back.facts.flags.includes('portal.ready'), true);
  assert.equal(back.facts.counters['blocks.played'], 1);
  const joined = act(back, { t: 'join', id: 'elo-returned', character: 'elodie' });
  assert.equal(act(joined, { t: 'portal', id: 'elo-returned' }).at.node, 'hub');
});
