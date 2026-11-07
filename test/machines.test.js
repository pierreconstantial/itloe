// Story machines (docs/story-engine.md) on a small fixture that is not the birthday story: the engine's
// generic mechanics, each used the way story content uses them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newCampaign, loadCampaign, reduceCampaign, validateContent, holding, leads, hintAt, chooserHeld, sceneAt, objectRules,
  zonesAt, offerAt, nextTimer, speechAt, SAMPLE_CONTENT,
} from '../shared/campaign/index.js';
import { objectAction } from '../shared/interactions.js';
import { room, prop } from '../shared/scene.js';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../shared/campaign/types.js').Content} Content */

const ROOM = room('yard', { x: 0.5, y: 5, w: 15, h: 3.5 }, [
  prop('well', { x: 3, y: 5.5, w: 1, h: 1 }), prop('cat', { x: 8, y: 6, w: 1, h: 1 }),
]);

/** The sample content plus a yard with a cat (a quest), a gate zone and a shop offer. @type {Content} */
const CONTENT = {
  ...SAMPLE_CONTENT,
  items: { ...SAMPLE_CONTENT.items, fish: { id: 'fish', name: 'Fish', icon: '🐟', description: 'For the cat.' },
    bell: { id: 'bell', name: 'Bell', icon: '🔔', description: 'Left by the cat.' } },
  rooms: { yard: ROOM },
  nodes: {
    ...SAMPLE_CONTENT.nodes,
    'childhood.blocks': { ...SAMPLE_CONTENT.nodes['childhood.blocks'], enterWhen: { machine: 'shop', in: ['open'] }, startsOnEnter: true },
    childhood: { ...SAMPLE_CONTENT.nodes.childhood, room: 'yard', hints: [{ text: 'A quiet yard.' }] },
  },
  leadAfter: { machine: 'gate', in: ['through'] },
  cast: { opening: ['elodie', 'pierre'], introducedBy: { sol: 'person.sol' } },
  machines: {
    cat: {
      initial: 'hungry',
      states: {
        hungry: {
          hints: { childhood: 'The cat looks hungry.' },
          objects: { cat: { actions: [
            { key: 'feed', text: 'Feed', if: { has: 'fish', who: 'elodie' } },
            { key: 'pet', text: 'Pet', say: 'Purr.', speaker: 'object', by: 'anyone' },
          ] } },
          on: { 'feed:cat': { to: 'fed', do: [{ flag: 'cat.fed' }, { count: 'clock.hours', by: 2 }] } },
        },
        fed: { npcs: { cat: { emote: 'joy' } }, after: { ms: 2000, to: 'gone' } },
        gone: { hide: ['cat'], pickups: [{ item: 'bell', node: 'childhood', x: 8.5, y: 7, radius: 1 }], on: { 'pickup:bell': 'done' } },
        done: { hide: ['cat'] },
      },
    },
    gate: {
      initial: 'closed',
      states: {
        closed: { when: [{ if: { done: 'hub.false-start' }, to: 'open' }] },
        open: {
          zones: [{ id: 'gate', node: 'hub.false-start', x: 8, y: 6, radius: 1 }],
          on: { 'zone:gate': { to: 'through', do: [{ wisp: 'others' }, { goto: 'hub' }, { cutscene: 'gate' }] } },
        },
        through: { holdChooser: 'hub', on: { 'cutscene:gate': 'done' } },
        done: {},
      },
    },
    visitor: {
      initial: 'away',
      states: {
        away: {},
        here: { enter: [{ incarnate: 'pierre' }], speech: { pierre: 'Hello!' } },
        friend: { enter: [{ flag: 'person.sol' }] },
        gone: { enter: [{ wisp: 'pierre' }] },
      },
    },
    shop: {
      initial: 'shut',
      states: {
        shut: { objects: { well: { actions: [{ key: 'ring', text: 'Ring' }] } }, on: { 'ring:well': 'open' } },
        open: {
          offer: { node: 'childhood.blocks', text: 'A game?', accept: 'Play' }, after: { ms: 1000, to: 'shut' },
          on: { 'entered:childhood.blocks': 'shut' },
        },
      },
    },
  },
};

/** @param {Campaign} c @param {import('../shared/campaign/types.js').CampaignStep} a */
const act = (c, a) => reduceCampaign(c, a, CONTENT);
/** @param {Campaign} c @param {string} m */
const stateOf = (c, m) => c.facts.machines[m].state;

/** Élodie and Pierre in, the false start done (3 block games counted by the game master). */
function started() {
  let c = newCampaign(CONTENT, 1);
  c = act(c, { t: 'join', id: 'elo', character: 'elodie' });
  c = act(c, { t: 'join', id: 'gm', character: 'pierre' });
  return act(c, { t: 'gm', id: 'gm', op: { op: 'count', counter: 'blocks.played', set: 3 } });
}

test('a machine content is valid, and every machine starts at its initial state', () => {
  assert.deepEqual(validateContent(CONTENT), []);
  const c = newCampaign(CONTENT, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(c.facts.machines).map(([id, m]) => [id, m.state])),
    { cat: 'hungry', gate: 'closed', visitor: 'away', shop: 'shut' });
});

test('a condition transition, a zone, effects (wisps, goto, cutscene), the chooser leading and held still', () => {
  let c = started();
  assert.equal(stateOf(c, 'gate'), 'open', 'the false start done opens the gate');
  assert.deepEqual(zonesAt(c.facts, CONTENT, c.at.node).map((z) => z.id), ['gate']);
  assert.equal(leads(c.facts, CONTENT), false);
  assert.equal(act(c, { t: 'zone', id: 'gm', zone: 'gate' }), c, 'only the chooser');
  c = act(c, { t: 'zone', id: 'elo', zone: 'gate' });
  assert.deepEqual([c.at.node, stateOf(c, 'gate'), c.party.players.gm.statuses], ['hub', 'through', ['wisp']]);
  assert.equal(leads(c.facts, CONTENT), true);
  assert.equal(chooserHeld(c.facts, CONTENT, 'hub'), true);
  const news = c.news.find((n) => n.t === 'cutscene');
  assert.deepEqual(news && { t: news.t, id: news.id }, { t: 'cutscene', id: 'gate' });
  c = act(c, { t: 'ack', id: 'screen', upTo: c.newsSeq });
  assert.equal(stateOf(c, 'gate'), 'done', 'the acked cutscene is an event');
  assert.equal(chooserHeld(c.facts, CONTENT, 'hub'), false);
  assert.equal(act(c, { t: 'enter', id: 'gm', node: 'childhood' }), c, 'the chooser leads: the game master uses goto');
});

test('object actions by condition and by who, an event effect, a timed state, hidden props and a pickup', () => {
  let c = act(started(), { t: 'gm', id: 'gm', op: { op: 'goto', node: 'childhood' } });
  assert.equal(hintAt(c.facts, CONTENT, 'childhood'), 'The cat looks hungry.', 'a state\'s hint wins over the node\'s');
  const rules = () => objectRules(c.facts, CONTENT);
  assert.equal(objectAction('cat', c.party.players.elo, rules())?.key, 'pet', 'no fish: pet');
  assert.equal(objectAction('cat', c.party.players.gm, rules())?.key, 'pet', 'anyone may pet');
  assert.equal(act(c, { t: 'use', id: 'elo', object: 'cat', action: 'feed' }), c, 'feed is not offered without a fish');
  c = act(c, { t: 'gm', id: 'gm', op: { op: 'give', item: 'fish', to: 'elodie' } });
  assert.equal(objectAction('cat', c.party.players.elo, rules())?.key, 'feed');
  assert.equal(objectAction('cat', c.party.players.gm, rules())?.key, 'pet', 'the condition is the chooser\'s action');
  c = act(c, { t: 'use', id: 'elo', object: 'cat', action: 'feed', now: 100 });
  assert.deepEqual([stateOf(c, 'cat'), c.facts.flags.includes('cat.fed'), c.facts.counters['clock.hours']], ['fed', true, 2],
    'a flag and a counter moved (in-game time) by the transition');
  assert.equal(nextTimer(c.facts, CONTENT), 2100);
  assert.equal(act(c, { t: 'tick', now: 2099 }), c);
  c = act(c, { t: 'tick', now: 2100 });
  assert.equal(stateOf(c, 'cat'), 'gone');
  assert.deepEqual(sceneAt(CONTENT, c.facts, 'childhood').props.map((p) => p.id), ['well']);
  assert.equal(sceneAt(CONTENT, c.facts, 'childhood'), sceneAt(CONTENT, c.facts, 'childhood'), 'the same scene object');
  assert.equal(act(c, { t: 'pickup', id: 'gm', item: 'bell' }), c, 'the chooser picks up');
  c = act(c, { t: 'pickup', id: 'elo', item: 'bell' });
  assert.deepEqual([holding(c.facts, 'elodie', 'bell'), stateOf(c, 'cat')], [1, 'done']);
  assert.equal(c.news.at(-1)?.t, 'item');
});

test('one character from wisp to avatar (the countdown) with a line, and back to a wisp', () => {
  let c = act(started(), { t: 'zone', id: 'elo', zone: 'gate' });
  assert.deepEqual(c.party.players.gm.statuses, ['wisp']);
  c = act(c, { t: 'gm', id: 'gm', op: { op: 'machine', machine: 'visitor', state: 'here' }, now: 50 });
  assert.deepEqual(c.party.players.gm.statuses, ['wisp', 'incarnating'], 'the server\'s countdown, then incarnate');
  assert.deepEqual(c.party.players.elo.statuses, [], 'only that character');
  assert.deepEqual(speechAt(c.facts, CONTENT).map((l) => [l.character, l.text]), [['pierre', 'Hello!']]);
  c = act(c, { t: 'incarnate', id: 'gm' });
  c = act(c, { t: 'gm', id: 'gm', op: { op: 'machine', machine: 'visitor', state: 'gone' } });
  assert.deepEqual(c.party.players.gm.statuses, ['wisp']);
  assert.deepEqual(speechAt(c.facts, CONTENT), []);
});

test('a machine setting an introduction flag wakes that wisp up', () => {
  let c = act(started(), { t: 'join', id: 'sol', character: 'sol' });
  assert.deepEqual(c.party.players.sol.statuses, ['wisp']);
  c = act(c, { t: 'gm', id: 'gm', op: { op: 'machine', machine: 'visitor', state: 'friend' } });
  assert.deepEqual(c.party.players.sol.statuses, ['wisp', 'incarnating']);
});

test('a loop in the content (goto ↔ entered) stops instead of overflowing', () => {
  /** @type {Content} */
  const looping = { ...CONTENT, machines: { ...CONTENT.machines, ping: { initial: 'a', states: {
    a: { on: { 'entered:childhood': { to: 'b', do: [{ goto: 'teens' }] } } },
    b: { on: { 'entered:teens': { to: 'a', do: [{ goto: 'childhood' }] } } },
  } } } };
  assert.deepEqual(validateContent(looping), []);
  const c = reduceCampaign(started(), { t: 'gm', id: 'gm', op: { op: 'goto', node: 'childhood' } }, looping);
  assert.ok(['childhood', 'teens'].includes(c.at.node));
});

test('an offer: the node opens only during it, its lobby opens on enter, and it lapses', () => {
  let c = act(started(), { t: 'gm', id: 'gm', op: { op: 'goto', node: 'childhood' } });
  assert.equal(act(c, { t: 'enter', id: 'elo', node: 'childhood.blocks' }), c, 'enterWhen does not hold');
  c = act(c, { t: 'use', id: 'elo', object: 'well', action: 'ring', now: 0 });
  assert.equal(offerAt(c.facts, CONTENT, 'childhood')?.accept, 'Play');
  assert.equal(stateOf(act(c, { t: 'tick', now: 1000 }), 'shop'), 'shut', 'lapsed');
  c = act(c, { t: 'enter', id: 'elo', node: 'childhood.blocks', now: 10 });
  assert.deepEqual([c.at.node, c.at.activity?.stage, stateOf(c, 'shop')], ['childhood.blocks', 'lobby', 'shut']);
});

test('the game master puts a machine in a state; a save keeps machines safe for changed content', () => {
  let c = act(started(), { t: 'gm', id: 'gm', op: { op: 'machine', machine: 'cat', state: 'gone' } });
  assert.equal(stateOf(c, 'cat'), 'gone');
  assert.equal(act(c, { t: 'gm', id: 'gm', op: { op: 'machine', machine: 'cat', state: 'nope' } }), c);
  assert.equal(act(c, { t: 'gm', id: 'elo', op: { op: 'machine', machine: 'cat', state: 'hungry' } }), c, 'game master only');
  const raw = JSON.parse(JSON.stringify(c));
  raw.facts.machines.ghost = { state: 'x', since: 0 };
  raw.facts.machines.shop = { state: 'renamed', since: 5 };
  const loaded = loadCampaign(raw, CONTENT);
  assert.deepEqual([loaded.facts.machines.ghost, stateOf(loaded, 'shop'), stateOf(loaded, 'cat')], [undefined, 'shut', 'gone']);
});

test('content validation names broken machines', () => {
  /** @type {any} */
  const broken = { ...CONTENT, leadAfter: { machine: 'gate', in: ['trough'] }, machines: { ...CONTENT.machines, bad: { initial: 'a', states: { a: {
    on: { 'x:y': 'nowhere', 'ridee:well': 'a', 'n:ull': null, 'zone:z': { to: 'a', do: [{ flag: 42 }] } }, pickups: [{ item: 'fish', node: 'hub', x: 1, y: 1, radius: 1 }], hide: ['ghost-prop'],
    enter: [{ explode: true }, { item: 'fish', to: 'winner' }, { count: 'clock.hours', by: 'one' }], after: { ms: 10, to: 'a' },
    when: [{ if: { machine: 'ghost', in: ['x'] }, to: 'a' }], speech: { nobody: 'Hi' },
    zones: [{ id: 'z', node: 'hub' }], b: 1,
    characters: { ghost: { actions: [{ key: 'hug', text: 'Hug' }] }, pierre: { actions: [{ key: 'kiss', text: 'Kiss', speaker: 'object' }] } },
  } } } }, rooms: { ...CONTENT.rooms, odd: { ...ROOM, id: 'odd', props: [prop('sol', { x: 1, y: 6, w: 1, h: 1 })] } } };
  const errors = validateContent(broken).join('\n');
  for (const part of ['unknown state "nowhere"', 'must leave the state', 'unknown prop "ghost-prop"', 'invalid effect',
    '"winner" is for node rewards', 'count needs a counter name', 'speech by "nobody"',
    'no action "ridee" on "well"', 'event "n:ull" goes to unknown state', 'flag needs a name', 'zone "z" needs numbers', 'initial state "a" cannot have after', 'unknown machine "ghost"', 'unknown state "trough"',
    'actions on "ghost", not a character', 'speaker is "target" or none', 'prop "sol" has a character\'s id']) {
    assert.ok(errors.includes(part), `reports: ${part}\n${errors}`);
  }
});

test('an action on a character: fired by another member, never on themselves or on a wisp', () => {
  /** @type {any} */
  const content = { ...CONTENT, machines: { ...CONTENT.machines, greet: { initial: 'waiting', states: {
    waiting: { characters: { pierre: { actions: [{ key: 'greet', text: 'Greet', by: 'anyone' }] } }, on: { 'greet:pierre': 'greeted' } },
    greeted: {},
  } } } };
  assert.deepEqual(validateContent(content), []);
  let c = newCampaign(content, 1);
  c = reduceCampaign(c, { t: 'join', id: 'elo', character: 'elodie' }, content);
  c = reduceCampaign(c, { t: 'join', id: 'gm', character: 'pierre' }, content);
  const use = (/** @type {Campaign} */ x, /** @type {string} */ id) => reduceCampaign(x, { t: 'use', id, character: 'pierre', action: 'greet' }, content);
  assert.equal(use(c, 'gm'), c, 'not on themselves');
  const wisp = reduceCampaign(c, { t: 'gm', id: 'gm', op: { op: 'wisp', character: 'pierre', on: true } }, content);
  assert.ok(wisp.party.players.gm.statuses.includes('wisp'));
  assert.equal(use(wisp, 'elo'), wisp, 'not on a wisp');
  assert.equal(stateOf(use(c, 'elo'), 'greet'), 'greeted');
});
