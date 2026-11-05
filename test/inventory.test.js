// Contract F — inventory: item catalogue, per-character inventory, rewards `to`, `has`, gm give/take, migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_CONTENT, emptyFacts, holds, holding, loadCampaign, newCampaign, reduceCampaign, settle, validateContent,
} from '../shared/campaign/index.js';
import { recipients } from '../shared/campaign/rules.js';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../shared/campaign/types.js').Content} Content */

/** @param {Content} C @param {Campaign} c @param {any[]} actions @returns {Campaign} */
const runC = (C, c, ...actions) => actions.reduce((x, a) => reduceCampaign(x, a, C), c);

/** Élodie (host, chooser), Sol, Anna in the party at the false start of `C`. @param {Content} C */
function party(C) {
  return runC(C, newCampaign(C, 3), { t: 'join', id: 'e', character: 'elodie' }, { t: 'join', id: 's', character: 'sol' }, { t: 'join', id: 'a', character: 'anna' });
}
/** One block game ended by the host, then back to the lobby. @param {Content} C @param {Campaign} c */
function game(C, c) {
  if (c.at.activity?.phase === 'finished') c = runC(C, c, { t: 'activity', action: { t: 'newGame', id: 'e' } });
  return runC(C, c, { t: 'activity', action: { t: 'start', id: 'e', now: 1 } }, { t: 'activity', action: { t: 'endGame', id: 'e' } });
}

/** A small content where the false start rewards with a given `to`. @param {any} reward @returns {Content} */
function withReward(reward) {
  /** @type {Content} */
  const C = structuredClone(SAMPLE_CONTENT);
  C.nodes['hub.false-start'].complete = { count: 'blocks.played', gte: 1 };
  C.nodes['hub.false-start'].rewards = [reward];
  return C;
}

// ---------------------------------------------------------------- validation

test('validateContent: the catalogue, and every item reward / has condition names a catalogue item', () => {
  assert.deepEqual(validateContent(SAMPLE_CONTENT), []);
  /** @type {any} */
  const bad = structuredClone(SAMPLE_CONTENT);
  bad.items.copy = { ...bad.items.photo };               // id ≠ key
  bad.items.blank = { id: 'blank', name: '', icon: '', description: 'x' };
  bad.nodes['hub.false-start'].rewards = [{ item: 'ghost' }, { item: 'photo', to: 'nobody' }, { item: 'photo', count: 0 }];
  bad.nodes.adult.unlock = { all: [{ has: 'ghost-2' }, { has: 'photo', who: 'bowser' }] };
  const errs = validateContent(bad).join('\n');
  for (const want of ['item "copy": id "photo" differs from its key', 'item "blank": missing name', 'item "blank": missing icon',
    'reward gives unknown item "ghost"', 'reward to "nobody"', 'reward count must be a whole number', 'needs unknown item "ghost-2"', 'invalid unlock condition']) {
    assert.ok(errs.includes(want), `missing: ${want}\n${errs}`);
  }
  /** @type {any} */
  const none = structuredClone(SAMPLE_CONTENT);
  delete none.items;
  assert.ok(validateContent(none).some((e) => e.includes('item catalogue')));
});

// ---------------------------------------------------------------- rewards `to`

test('reward to the chooser (default): the Old key lands in Élodie’s inventory, news says who', () => {
  let c = party(SAMPLE_CONTENT);
  c = game(SAMPLE_CONTENT, game(SAMPLE_CONTENT, game(SAMPLE_CONTENT, c)));
  assert.equal(holding(c.facts, 'elodie', 'old-key'), 1);
  assert.equal(holding(c.facts, 'sol', 'old-key'), 0);
  const n = c.news.find((x) => x.t === 'item');
  assert.deepEqual(n && { item: n.item, to: /** @type {any} */ (n).to }, { item: 'old-key', to: ['elodie'] });
});

test('reward to "all": every non-left party member, one each', () => {
  const C = withReward({ item: 'photo', to: 'all' });
  let c = runC(C, party(C), { t: 'leave', id: 'a' });
  c = runC(C, c, { t: 'join', id: 'p', character: 'pierre' });
  c = game(C, c);
  assert.deepEqual(['elodie', 'sol', 'anna', 'pierre'].map((ch) => holding(c.facts, ch, 'photo')), [1, 1, 0, 1], 'Anna left: none for her');
  assert.deepEqual(/** @type {any} */ (c.news.find((x) => x.t === 'item'))?.to, ['elodie', 'sol', 'pierre']);
});

test('reward to "winner": rank 1 of the activity that completed the node — all of them when tied', () => {
  const C = withReward({ item: 'ticket', to: 'winner', count: 2 });
  let c = party(C);
  // everyone at 0 → a three-way tie: all three win
  c = game(C, c);
  assert.deepEqual(['elodie', 'sol', 'anna'].map((ch) => holding(c.facts, ch, 'ticket')), [2, 2, 2], 'tied → all, count 2 each');
  // a clear winner (pure: the ranking of the triggering event)
  const ev = { t: 'round.finished', kind: 'blocks', node: 'x', endReason: 'stuck',
    ranking: [{ character: 'sol', score: 90, rank: 1 }, { character: 'elodie', score: 10, rank: 2 }] };
  assert.deepEqual(recipients('winner', C, { event: /** @type {any} */ (ev) }), ['sol']);
  assert.deepEqual(recipients('winner', C, {}), ['elodie'], 'no ranking in this step → the chooser');
  assert.deepEqual(recipients('anna', C, {}), ['anna'], 'a named character');
});

test('rewards apply once: a replayable node finished again gives nothing more', () => {
  const C = withReward({ item: 'photo', to: 'all' });
  let c = game(C, party(C));
  c = game(C, game(C, c));
  assert.equal(holding(c.facts, 'sol', 'photo'), 1);
  assert.equal(c.news.filter((x) => x.t === 'item').length, 1);
});

// ---------------------------------------------------------------- has

test('has: anyone (default) / a given character, gte; it can open a node', () => {
  const f = { ...emptyFacts(), inventory: { sol: { photo: 2 }, elodie: { 'old-key': 1 } } };
  assert.ok(holds({ has: 'photo' }, f));
  assert.ok(holds({ has: 'photo', who: 'sol', gte: 2 }, f));
  assert.ok(!holds({ has: 'photo', who: 'sol', gte: 3 }, f));
  assert.ok(!holds({ has: 'photo', who: 'elodie' }, f));
  assert.ok(!holds({ has: 'ticket' }, f));
  /** @type {Content} */
  const C = structuredClone(SAMPLE_CONTENT);
  C.nodes.adult.unlock = { has: 'ticket', who: 'anna' };
  let c = runC(C, party(C), { t: 'gm', id: 'e', op: { op: 'unlock', node: 'childhood' } });
  assert.ok(!c.facts.unlocked.includes('adult'));
  c = runC(C, c, { t: 'gm', id: 'e', op: { op: 'give', item: 'ticket', to: 'anna' } });
  assert.ok(c.facts.unlocked.includes('adult'), 'giving the item opens the node in the same step');
});

// ---------------------------------------------------------------- gm give / take

test('gm give/take: host only; unknown item, unknown character, bad count or taking more than held → refused (same ref)', () => {
  const C = SAMPLE_CONTENT;
  let c = party(C);
  assert.equal(runC(C, c, { t: 'gm', id: 's', op: { op: 'give', item: 'photo', to: 'sol' } }), c, 'host only');
  assert.equal(runC(C, c, { t: 'gm', id: 'e', op: { op: 'give', item: 'ghost', to: 'sol' } }), c, 'unknown item');
  assert.equal(runC(C, c, { t: 'gm', id: 'e', op: /** @type {any} */ ({ op: 'give', item: 'photo', to: 'bowser' }) }), c, 'unknown character');
  assert.equal(runC(C, c, { t: 'gm', id: 'e', op: { op: 'give', item: 'photo', to: 'sol', count: 0 } }), c, 'count ≥ 1');
  c = runC(C, c, { t: 'gm', id: 'e', op: { op: 'give', item: 'photo', to: 'sol', count: 3 } });
  assert.equal(holding(c.facts, 'sol', 'photo'), 3);
  assert.equal(runC(C, c, { t: 'gm', id: 'e', op: { op: 'take', item: 'photo', from: 'sol', count: 4 } }), c, 'more than held: refused whole');
  c = runC(C, c, { t: 'gm', id: 'e', op: { op: 'take', item: 'photo', from: 'sol', count: 3 } });
  assert.equal(holding(c.facts, 'sol', 'photo'), 0);
  assert.deepEqual(c.facts.inventory, {}, 'an emptied entry is removed (no zero counts)');
  assert.equal(runC(C, c, { t: 'gm', id: 'e', op: { op: 'take', item: 'photo', from: 'sol' } }), c, 'nothing to take');
});

// ---------------------------------------------------------------- migration + tolerance

test('loadCampaign: old shared facts.items → the chooser, one each; items no longer in the catalogue dropped', () => {
  const c = newCampaign(SAMPLE_CONTENT, 1);
  const old = JSON.parse(JSON.stringify({ ...c, facts: { ...c.facts, inventory: undefined, items: ['old-key', 'reward-1', 'old-key'] } }));
  const l = loadCampaign(old, SAMPLE_CONTENT);
  assert.deepEqual(l.facts.inventory, { elodie: { 'old-key': 1 } });
  assert.equal(/** @type {any} */ (l.facts).items, undefined, 'facts.items is gone');
  const later = JSON.parse(JSON.stringify({ ...c, facts: { ...c.facts, inventory: { sol: { photo: 2, removed: 1 }, anna: { gone: 3 } } } }));
  assert.deepEqual(loadCampaign(later, SAMPLE_CONTENT).facts.inventory, { sol: { photo: 2 } }, 'unknown items dropped, empty characters too');
  // a JSON round trip of a campaign with an inventory is unchanged
  const withInv = runC(SAMPLE_CONTENT, party(SAMPLE_CONTENT), { t: 'gm', id: 'e', op: { op: 'give', item: 'ticket', to: 'anna', count: 2 } });
  assert.deepEqual(loadCampaign(JSON.parse(JSON.stringify(withInv)), SAMPLE_CONTENT), JSON.parse(JSON.stringify(withInv)));
});

test('settle never invents an item outside the catalogue (content edited under a saved campaign)', () => {
  /** @type {Content} */
  const C = structuredClone(SAMPLE_CONTENT);
  C.nodes.hub.rewards = [{ item: 'not-in-catalogue' }];
  C.nodes.hub.complete = { always: true };
  const s = settle(emptyFacts(), C);
  assert.deepEqual(s.facts.inventory, {});
  assert.ok(!s.news.some((n) => n.t === 'item'));
});
