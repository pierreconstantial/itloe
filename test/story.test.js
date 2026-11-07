import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newCampaign, loadCampaign, reduceCampaign, validateContent, holding, gameMasterId, roomAt, sceneAt, objectRules, offerAt,
  nextTimer, npcsAt, pickupsAt, choiceAt,
} from '../shared/campaign/index.js';
import { objectAction, nearbyObject } from '../shared/interactions.js';
import { isWalkable } from '../shared/scene.js';
import { INTRO_KEY, MEMORY_WORLDS, OPENING_PLAYERS, STORY_CONTENT } from '../shared/campaign/story/index.js';
import { CHARACTERS } from '../shared/characters.js';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @param {Campaign} campaign @param {import('../shared/campaign/types.js').CampaignStep} action */
const act = (campaign, action) => reduceCampaign(campaign, action, STORY_CONTENT);
/** @param {Campaign} campaign @param {...any} actions @returns {Campaign} */
const inGame = (campaign, ...actions) => actions.reduce((c, action) => act(c, { t: 'activity', action }), campaign);
/** @param {Campaign} c @param {string} machine */
const stateOf = (c, machine) => c.facts.machines[machine]?.state;

/** The four join; Pierre starts the block game, all four get ready, and he starts its round. */
function openingRound() {
  let c = newCampaign(STORY_CONTENT, 42);
  for (const character of OPENING_PLAYERS) c = act(c, { t: 'join', id: character, character });
  c = act(c, { t: 'startMinigame', id: 'pierre', now: 1000 });
  return inGame(c, ...OPENING_PLAYERS.map((id) => ({ t: 'ready', id, on: true })), { t: 'start', id: 'pierre', now: 1000 });
}

/** The opening played to the end: the block game, the portal, the apparition, the key. */
function afterOpening() {
  let c = act(inGame(openingRound(), { t: 'endGame', id: 'pierre' }, { t: 'lobby', id: 'pierre' }), { t: 'endMinigame', id: 'pierre' });
  c = act(c, { t: 'zone', id: 'elodie', zone: 'portal' });
  const cutscene = c.news.find((n) => n.t === 'cutscene');
  c = act(c, { t: 'ack', id: 'screen', upTo: cutscene?.seq ?? 0 });
  return act(c, { t: 'pickup', id: 'elodie', item: INTRO_KEY });
}

test('the birthday content is valid and begins with only the block game', () => {
  assert.deepEqual(validateContent(STORY_CONTENT), []);
  const c = newCampaign(STORY_CONTENT, 42);
  assert.equal(c.at.node, 'hub.false-start');
  assert.deepEqual([c.at.kind, c.at.activity], ['blocks', null], 'the room at the block tableau');
  assert.equal(stateOf(c, 'opening'), 'false-start');
  assert.equal(c.facts.unlocked.includes('future'), false);
  assert.equal(c.facts.unlocked.includes('young-adult'), false);
});

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
  c = act(c, { t: 'zone', id: 'elodie', zone: 'portal' });
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

test('the opening: portal after the block game, apparition, the key, once and by Élodie only', () => {
  let c = inGame(openingRound(), { t: 'endGame', id: 'pierre' });
  assert.equal(stateOf(c, 'opening'), 'false-start', 'no portal on the podium');
  c = inGame(c, { t: 'lobby', id: 'pierre' });
  assert.equal(stateOf(c, 'opening'), 'false-start', 'nor in the lobby');
  c = act(c, { t: 'endMinigame', id: 'pierre' });
  assert.equal(stateOf(c, 'opening'), 'portal-open', 'the portal, once Pierre ends the block game');
  assert.equal(c.at.activity, null, 'back in the room');
  const again = act(c, { t: 'startMinigame', id: 'pierre', now: 2000 });
  assert.equal(again.at.activity?.stage, 'lobby', 'nothing refuses a second block game once the portal is open');
  assert.equal(act(again, { t: 'zone', id: 'elodie', zone: 'portal' }), again, 'no portal while the block game runs');
  assert.equal(act(c, { t: 'zone', id: 'pierre', zone: 'portal' }), c, 'only Élodie goes through');
  c = act(c, { t: 'zone', id: 'elodie', zone: 'portal' });
  assert.equal(c.at.node, 'hub');
  assert.deepEqual(OPENING_PLAYERS.filter((id) => c.party.players[id].statuses.includes('wisp')), ['pierre', 'sol', 'anna']);
  assert.equal(c.news.filter((n) => n.t === 'cutscene' && n.id === 'apparition').length, 1);
  assert.equal(act(c, { t: 'zone', id: 'elodie', zone: 'portal' }), c, 'the portal is gone');
  assert.equal(act(c, { t: 'pickup', id: 'elodie', item: INTRO_KEY }), c, 'no key during the apparition');
  assert.equal(act(c, { t: 'enter', id: 'pierre', node: 'young-adult' }), c, 'Élodie leads now');
  const cutscene = c.news.find((n) => n.t === 'cutscene');
  c = act(c, { t: 'ack', id: 'screen', upTo: cutscene?.seq ?? 0 });
  assert.equal(stateOf(c, 'opening'), 'key-on-floor');
  assert.equal(act(c, { t: 'pickup', id: 'pierre', item: INTRO_KEY }), c);
  c = act(c, { t: 'pickup', id: 'elodie', item: INTRO_KEY });
  assert.equal(holding(c.facts, 'elodie', INTRO_KEY), 1);
  assert.equal(c.facts.unlocked.includes('young-adult'), true);
  assert.equal(act(c, { t: 'pickup', id: 'elodie', item: INTRO_KEY }), c, 'one key');
});

test('the game master replays the apparition: everyone back to the hub, the visitor plays again', () => {
  let c = afterOpening();
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'goto', node: 'young-adult' } });
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'machine', machine: 'opening', state: 'apparition' } });
  assert.equal(c.at.node, 'hub');
  const cutscene = c.news.find((n) => n.t === 'cutscene' && n.id === 'apparition');
  assert.ok(cutscene, 'the cutscene plays again');
  c = act(c, { t: 'ack', id: 'screen', upTo: cutscene?.seq ?? 0 });
  assert.equal(stateOf(c, 'opening'), 'key-on-floor', 'and Élodie is free again');
});

test('Young Adult: Élodie walks the places, and the flags open the Shelter and Pierre\'s flat', () => {
  let c = afterOpening();
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult' });
  assert.equal(c.at.node, 'young-adult');
  assert.equal(roomAt(STORY_CONTENT, c.at.node).id, 'young-adult/tram-5');
  assert.equal(c.facts.unlocked.includes('young-adult/shelter'), false);
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5' });
  assert.equal(act(c, { t: 'enter', id: 'elodie', node: 'young-adult/appart-pierre' }), c, 'Pierre’s flat is still locked');
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/appart-elo-1' });
  assert.equal(roomAt(STORY_CONTENT, c.at.node).id, 'young-adult/appart-elo-1');
  c = act(c, { t: 'back', id: 'elodie' });
  assert.equal(c.at.node, 'young-adult/tram-5');
  assert.equal(act(c, { t: 'back', id: 'elodie' }), c, 'no way back from Tram 5 for Élodie');
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'young-adult.shelter.open', on: true } });
  assert.ok(c.facts.unlocked.includes('young-adult/shelter'));
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'goto', node: 'young-adult/shelter' } }); // the tram's way, in its test
  assert.equal(roomAt(STORY_CONTENT, c.at.node).id, 'young-adult/shelter');
  c = act(c, { t: 'back', id: 'elodie' });
  assert.equal(c.at.node, 'young-adult/tram-5', 'from the Shelter, back to the tram stop');
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'goto', node: 'young-adult' } });
  c = act(c, { t: 'back', id: 'elodie' });
  assert.equal(c.at.node, 'hub');
  assert.equal(holding(c.facts, 'elodie', INTRO_KEY), 1);
});

test('the painted tram offers Élodie its quiz for 30 seconds; accepting opens the quiz lobby in one step', () => {
  let c = act(afterOpening(), { t: 'enter', id: 'elodie', node: 'young-adult', now: 0 });
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5', now: 0 });
  assert.equal(act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5/quiz' }), c, 'not without the offer');
  assert.equal(objectAction('tram-5-tram', c.party.players.pierre, objectRules(c.facts, STORY_CONTENT)), null, 'Pierre the wisp cannot');
  c = act(c, { t: 'use', id: 'elodie', object: 'tram-5-tram', action: 'ride', now: 1000 });
  assert.equal(offerAt(c.facts, STORY_CONTENT, c.at.node)?.node, 'young-adult/tram-5/quiz');
  assert.equal(nextTimer(c.facts, STORY_CONTENT), 31_000);
  const expired = act(c, { t: 'tick', now: 31_000 });
  assert.equal(offerAt(expired.facts, STORY_CONTENT, expired.at.node), null, 'the offer lapses');
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5/quiz', now: 2000 });
  assert.equal(c.at.node, 'young-adult/tram-5/quiz');
  assert.equal(c.at.activity?.stage, 'lobby', 'the quiz lobby is open');
  assert.equal(stateOf(c, 'tram'), 'riding', 'the offer is used');
});

test('after the tram quiz Élodie chooses a destination: her flat, the Shelter once open, Marokkanergasse after the kiss', () => {
  /** @param {import('../shared/campaign/types.js').Campaign} from */
  const ride = (from) => {
    let c = act(from, { t: 'use', id: 'elodie', object: 'tram-5-tram', action: 'ride', now: 1000 });
    c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5/quiz', now: 2000 });
    assert.equal(choiceAt(c, STORY_CONTENT), null, 'no choice before a round has finished');
    assert.equal(act(c, { t: 'choose', id: 'elodie', option: 'flat' }), c);
    // the game master ends the lobby: the quiz is over and the choice stands (with a finished round, it shows on the podium)
    c = act(c, { t: 'endMinigame', id: 'pierre', now: 3000 });
    return c;
  };
  let c = act(afterOpening(), { t: 'enter', id: 'elodie', node: 'young-adult' });
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5' });
  c = ride(c);
  const keys = (/** @type {typeof c} */ x) => choiceAt(x, STORY_CONTENT)?.options.map((o) => o.key);
  assert.deepEqual(keys(c), ['flat'], 'only her flat at first');
  assert.equal(act(c, { t: 'choose', id: 'elodie', option: 'shelter' }), c, 'the Shelter is not open yet');
  assert.equal(act(c, { t: 'choose', id: 'pierre', option: 'flat' }), c, 'Élodie alone chooses');
  c = act(c, { t: 'choose', id: 'elodie', option: 'flat', now: 4000 });
  assert.equal(c.at.node, 'young-adult/appart-elo-1');
  assert.equal(stateOf(c, 'tram'), 'waiting');
  assert.equal(choiceAt(c, STORY_CONTENT), null);

  // back at the stop on foot; with the ticket found, the Shelter is a destination too
  c = act(c, { t: 'back', id: 'elodie', now: 5000 });
  assert.equal(c.at.node, 'young-adult/tram-5');
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'young-adult.shelter.open', on: true } });
  c = ride(c);
  assert.deepEqual(keys(c), ['flat', 'shelter']);
  c = act(c, { t: 'choose', id: 'elodie', option: 'shelter', now: 6000 });
  assert.equal(c.at.node, 'young-adult/shelter');

  // after the kiss: Marokkanergasse, and no more flat; Marokkanergasse has no way back
  c = act(c, { t: 'back', id: 'elodie', now: 7000 });
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'young-adult.appart-pierre.open', on: true } });
  c = ride(c);
  assert.deepEqual(keys(c), ['shelter', 'marokkanergasse']);
  c = act(c, { t: 'choose', id: 'elodie', option: 'marokkanergasse', now: 8000 });
  assert.equal(c.at.node, 'young-adult/appart-pierre');
  assert.equal(act(c, { t: 'back', id: 'elodie' }), c, 'no normal exit');
});

test('a ride the game master cancels (back to the stop) leaves the tram ready again', () => {
  let c = act(afterOpening(), { t: 'enter', id: 'elodie', node: 'young-adult' });
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5' });
  c = act(c, { t: 'use', id: 'elodie', object: 'tram-5-tram', action: 'ride', now: 1000 });
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5/quiz', now: 2000 });
  c = act(c, { t: 'back', id: 'pierre', now: 3000 });
  assert.equal(c.at.node, 'young-adult/tram-5');
  assert.equal(stateOf(c, 'tram'), 'waiting');
  assert.ok(objectAction('tram-5-tram', c.party.players.elodie, objectRules(c.facts, STORY_CONTENT)), 'she can ride again');
});

test('Tschick-Toni: a cigarette from the pack, "Oida, geil!", he leaves with his dog, the crowbar stays', () => {
  let c = act(afterOpening(), { t: 'enter', id: 'elodie', node: 'young-adult' });
  c = act(c, { t: 'enter', id: 'elodie', node: 'young-adult/tram-5' });
  const elodie = c.party.players.elodie;
  /** @param {Campaign} x */
  const toni = (x) => objectAction('tram-5-weird-man', x.party.players.elodie, objectRules(x.facts, STORY_CONTENT));
  assert.equal(toni(c)?.key, 'talk', 'without cigarettes she can only talk');
  assert.equal(act(c, { t: 'use', id: 'elodie', object: 'tram-5-weird-man', action: 'give' }), c);
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'give', item: 'cigarette-pack', to: 'elodie' } });
  assert.equal(toni(c)?.key, 'give');
  c = act(c, { t: 'use', id: elodie.id, object: 'tram-5-weird-man', action: 'give', now: 5000 });
  assert.equal(stateOf(c, 'toni'), 'thanked');
  assert.deepEqual(npcsAt(c.facts, STORY_CONTENT)['tram-5-weird-man'], { say: 'Oida, geil!', emote: 'joy' });
  assert.equal(holding(c.facts, 'elodie', 'cigarette-pack'), 1, 'the pack stays');
  assert.equal(act(c, { t: 'tick', now: 7999 }), c, 'he stays three seconds');
  c = act(c, { t: 'tick', now: 8000 });
  assert.equal(stateOf(c, 'toni'), 'gone');
  const props = sceneAt(STORY_CONTENT, c.facts, c.at.node).props.map((p) => p.id);
  assert.ok(!props.includes('tram-5-weird-man') && !props.includes('tram-5-dog'), 'Toni and his dog are gone');
  assert.ok(props.includes('tram-5-cigarette-automat'), 'the automat stays');
  assert.deepEqual(pickupsAt(c.facts, STORY_CONTENT, c.at.node).map((p) => p.item), ['crowbar']);
  c = act(c, { t: 'pickup', id: 'elodie', item: 'crowbar' });
  assert.equal(holding(c.facts, 'elodie', 'crowbar'), 1);
  assert.deepEqual(pickupsAt(c.facts, STORY_CONTENT, c.at.node), []);
});

test('Toni leaves even after a restart in his three seconds', () => {
  let c = act(afterOpening(), { t: 'gm', id: 'pierre', op: { op: 'machine', machine: 'toni', state: 'thanked' }, now: 5000 });
  const resumed = loadCampaign(JSON.parse(JSON.stringify(c)), STORY_CONTENT);
  assert.equal(nextTimer(resumed.facts, STORY_CONTENT), 8000, 'the timer comes back with the save');
  assert.equal(stateOf(act(resumed, { t: 'tick', now: 60_000 }), 'toni'), 'gone');
});

test('Élodie\'s flat: the lamp, time passing by Columbo and books, Pierre after three hours, the floorboard', () => {
  const FLAT = 'young-adult/appart-elo-1';
  let c = act(afterOpening(), { t: 'gm', id: 'pierre', op: { op: 'goto', node: FLAT } });
  /** @param {string} prop @param {Campaign} [x] */
  const actionOn = (prop, x = c) => objectAction(prop, x.party.players.elodie, objectRules(x.facts, STORY_CONTENT));
  /** @param {string} prop @param {string} action */
  const use = (prop, action) => { c = act(c, { t: 'use', id: 'elodie', object: prop, action }); };
  // each painted object is within reach from walkable floor
  const scene = sceneAt(STORY_CONTENT, c.facts, FLAT);
  for (const [prop, at] of /** @type {[string, { x: number, y: number }][]} */ ([
    ['appart-elo-1-lamp', { x: 4.6, y: 6.4 }], ['appart-elo-1-beer', { x: 6.45, y: 6.9 }], ['appart-elo-1-tv', { x: 11, y: 6.4 }],
    ['appart-elo-1-books', { x: 13.8, y: 6.3 }], ['appart-elo-1-floorboard', { x: 4.2, y: 8.1 }],
  ])) {
    assert.ok(isWalkable(scene, at.x, at.y), `${prop}: ${at.x},${at.y} is walkable`);
    assert.equal(nearbyObject(scene, at, c.party.players.elodie, objectRules(c.facts, STORY_CONTENT))?.id, prop);
  }
  assert.equal(stateOf(c, 'flat-lamp'), 'off', 'dark at first');
  use('appart-elo-1-lamp', 'switch');
  assert.equal(stateOf(c, 'flat-lamp'), 'on');
  assert.equal(actionOn('appart-elo-1-beer')?.feedback, 'Pierre said he’d bring beer.');
  use('appart-elo-1-tv', 'columbo');
  assert.equal(stateOf(c, 'pierre-visit'), 'not-yet', 'one hour');
  use('appart-elo-1-books', 'read');
  assert.equal(stateOf(c, 'pierre-visit'), 'arrived', 'three hours: Pierre arrives');
  assert.deepEqual(c.party.players.pierre.statuses, ['wisp', 'incarnating'], 'from wisp to his avatar (the countdown)');
  c = act(c, { t: 'incarnate', id: 'pierre' });
  assert.deepEqual(c.party.players.pierre.statuses, []);
  assert.equal(c.facts.counters['young-adult.clock.hours'], 3);
  assert.equal(actionOn('appart-elo-1-floorboard')?.key, 'look', 'no tool yet');
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'machine', machine: 'pierre-visit', state: 'after-backgammon' } });
  assert.deepEqual(c.party.players.pierre.statuses, ['wisp'], 'a wisp again after backgammon');
  assert.deepEqual(pickupsAt(c.facts, STORY_CONTENT, FLAT).map((p) => p.item), ['beers', 'cigarette-pack']);
  c = act(c, { t: 'pickup', id: 'elodie', item: 'cigarette-pack' });
  assert.deepEqual(pickupsAt(c.facts, STORY_CONTENT, FLAT).map((p) => p.item), ['beers'], 'the beers stay on the floor');
  c = act(c, { t: 'pickup', id: 'elodie', item: 'beers' });
  assert.deepEqual([stateOf(c, 'pierre-visit'), holding(c.facts, 'elodie', 'beers'), holding(c.facts, 'elodie', 'cigarette-pack')], ['done', 1, 1]);
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'give', item: 'crowbar', to: 'elodie' } });
  assert.equal(actionOn('appart-elo-1-floorboard')?.key, 'lift');
  use('appart-elo-1-floorboard', 'lift');
  assert.equal(holding(c.facts, 'elodie', 'shelter-ticket'), 1);
  assert.equal(c.facts.unlocked.includes('young-adult/shelter'), true, 'the Shelter opens');
  assert.equal(actionOn('appart-elo-1-floorboard'), null, 'once');
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
  assert.equal(stateOf(back, 'opening'), 'portal-open');
  assert.equal(back.facts.counters['blocks.played'], 1);
  const joined = act(back, { t: 'join', id: 'elo-returned', character: 'elodie' });
  assert.equal(act(joined, { t: 'zone', id: 'elo-returned', zone: 'portal' }).at.node, 'hub');
});
