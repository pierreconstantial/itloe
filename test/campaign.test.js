// Campaign engine (shared/campaign/): rules, settle fixpoint, reducer, gm, content tolerance, validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_CONTENT as C, COUNTER, emptyFacts, holds, loadCampaign, newCampaign,
  record, reduceCampaign, settle, validateContent, zoneAt, holding, gameMasterId,
} from '../shared/campaign/index.js';
import { minigameContent } from '../shared/campaign/sample.js';
import { MINIGAMES } from '../shared/minigames.js';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../shared/campaign/types.js').CampaignAction} CampaignAction */
/** @typedef {import('../shared/campaign/types.js').Content} Content */

/** The seed of a campaign's block round (these tests' rounds are block games). @param {Campaign} c */
const blockSeed = (c) => /** @type {import('../shared/game.js').State | null | undefined} */ (c.at.activity?.round)?.seed;

/** @param {Campaign} c @param {CampaignAction[]} actions */
const run = (c, ...actions) => actions.reduce((x, a) => reduceCampaign(x, a, C), c);
/** An action of the running minigame. @param {any} action @returns {CampaignAction} */
const act = (action) => ({ t: 'activity', action });

/** The game master starts the tableau's minigame, everyone eligible gets ready, and he starts a round. @param {Campaign} c */
function startRound(c, now = 1000) {
  if (!c.at.activity) c = run(c, { t: 'startMinigame', id: 'p', now });
  if (!c.at.activity) return c; // no game master here
  const players = c.at.activity.players;
  return run(c, ...players.map((p) => act({ t: 'ready', id: p.id, on: true })), act({ t: 'start', id: 'p', now }));
}

/** Campaign with Pierre (the game master), Élodie (the chooser) and Sol in the party, at the false start. */
function party() {
  return run(newCampaign(C, 42), { t: 'join', id: 'p', character: 'pierre' }, { t: 'join', id: 'e', character: 'elodie' },
    { t: 'join', id: 's', character: 'sol' });
}

/** One block game in the current tableau, from the game master's start of the minigame to his end (counts as played). @param {Campaign} c */
function playOnce(c) {
  return run(startRound(c), act({ t: 'endGame', id: 'p' }), act({ t: 'lobby', id: 'p' }), { t: 'endMinigame', id: 'p' });
}

/** @param {Campaign} c */
const unlockedNews = (c) => c.news.filter((n) => n.t === 'unlocked').map((n) => /** @type {any} */ (n).node);

// ---------------------------------------------------------------- content

test('the sample content is valid', () => {
  assert.deepEqual(validateContent(C), []);
});

test('validateContent reports unknown parents, unknown refs, cycles, key/id mismatch, bad start, unknown room', () => {
  /** @type {any} */
  const bad = structuredClone(C);
  bad.nodes['teens.blocks'].parent = 'nowhere';
  bad.nodes.adult.unlock = { all: [{ done: 'childhood' }, { done: 'ghost' }] };
  bad.nodes.childhood.parent = 'childhood.blocks';
  bad.nodes['childhood.blocks'].parent = 'childhood';
  bad.nodes.copy = { ...bad.nodes['teens.scene'] };
  bad.nodes['teens.scene'].rewards = [{ unlock: 'nope' }];
  bad.start = 'adult';
  bad.chooser = 'bowser';
  bad.nodes.teens.room = 'ballroom';
  const errs = validateContent(bad).join('\n');
  for (const want of ['unknown parent "nowhere"', 'unknown node "ghost"', 'a tableau cannot have children', 'differs from its key',
    'unlocks unknown node "nope"', 'start "adult" must be the tableau of a minigame', 'chooser "bowser"', 'unknown room "ballroom"']) {
    assert.ok(errs.includes(want), `missing: ${want}\n${errs}`);
  }
  /** @type {any} */
  const cyc = structuredClone(C);
  cyc.nodes.childhood.parent = 'teens';
  cyc.nodes.teens.parent = 'childhood';
  assert.ok(validateContent(cyc).some((e) => e.includes('parent cycle')));
});

test('validateContent checks activities through the rules list: any minigame starts, settings are checked', () => {
  /** @type {any} */
  const quizStart = structuredClone(C);
  quizStart.start = 'childhood.quiz';
  assert.deepEqual(validateContent(quizStart), []);
  const c = newCampaign(quizStart, 1);
  assert.deepEqual([c.at.kind, c.at.activity], ['quiz', null], 'the room at the quiz tableau');

  /** @type {any} */
  const bad = structuredClone(C);
  bad.start = 'childhood.scene';
  bad.nodes['childhood.blocks'].activity.settings = { size: 11, colour: 'red' };
  bad.nodes['childhood.quiz'].activity.settings = { seconds: 12 };
  bad.nodes['teens.scene'].activity = { kind: 'darts' };
  const errs = validateContent(bad).join('\n');
  for (const want of ['start "childhood.scene" must be the tableau of a minigame', 'node "childhood.blocks": setting "size" can\'t be 11',
    'node "childhood.blocks": unknown setting "colour"', 'node "childhood.quiz": setting "seconds" can\'t be 12', 'node "teens.scene": unknown activity "darts"']) {
    assert.ok(errs.includes(want), `missing: ${want}\n${errs}`);
  }
});

test('the development start: every registered minigame gets valid content that starts at its tableau', () => {
  for (const kind of Object.keys(MINIGAMES)) {
    const content = /** @type {Content} */ (minigameContent(kind));
    assert.deepEqual(validateContent(content), [], kind);
    assert.equal(newCampaign(content, 1).at.kind, kind);
  }
  assert.equal(minigameContent('darts'), null);
});

test('zoneAt: the child whose door contains the point, else null', () => {
  assert.equal(zoneAt(C, 'hub', 3, 5.2), 'childhood');
  assert.equal(zoneAt(C, 'hub', 12.5, 5.2), 'teens');
  assert.equal(zoneAt(C, 'hub', 0.1, 0.1), null);
  assert.equal(zoneAt(C, 'childhood', 5, 5.2), 'childhood.blocks');
});

// ---------------------------------------------------------------- rules

test('holds: every condition shape; unknown shapes are false', () => {
  const f = { ...emptyFacts(), flags: ['x'], done: ['a'], unlocked: ['b'], counters: { k: 3 } };
  assert.ok(holds({ always: true }, f));
  assert.ok(holds({ flag: 'x' }, f) && !holds({ flag: 'y' }, f));
  assert.ok(holds({ done: 'a' }, f) && holds({ unlocked: 'b' }, f));
  assert.ok(holds({ count: 'k', gte: 3 }, f) && !holds({ count: 'k', gte: 4 }, f) && !holds({ count: 'z', gte: 1 }, f));
  assert.ok(holds({ all: [{ flag: 'x' }, { done: 'a' }] }, f) && !holds({ all: [{ flag: 'x' }, { flag: 'y' }] }, f));
  assert.ok(holds({ any: [{ flag: 'y' }, { done: 'a' }] }, f) && holds({ not: { flag: 'y' } }, f));
  assert.equal(holds(/** @type {any} */ ({ typo: 1 }), f), false);
});

test('record: round.finished counts plays, per-node finishes, wins and totals by character', () => {
  const f = record(emptyFacts(), {
    t: 'round.finished', kind: 'blocks', node: 'hub.false-start', endReason: 'gm',
    ranking: [{ character: 'elodie', score: 30, rank: 1 }, { character: 'sol', score: 10, rank: 2 }],
  });
  assert.equal(f.counters[COUNTER.played('blocks')], 1);
  assert.equal(f.counters[COUNTER.finished('hub.false-start')], 1);
  assert.equal(f.counters[COUNTER.won('blocks', 'elodie')], 1);
  assert.equal(f.counters[COUNTER.won('blocks', 'sol')], undefined);
  assert.deepEqual(f.totals, { blocks: { elodie: 30, sol: 10 } }, 'block points kept apart from quiz points');
});

test('settle: idempotent (same object, no news) and monotonic', () => {
  const a = settle(emptyFacts(), C);
  assert.deepEqual([...a.facts.unlocked].sort(), ['hub', 'hub.false-start']);
  const b = settle(a.facts, C, 2);
  assert.equal(b.facts, a.facts);
  assert.deepEqual(b.news, []);
  // removing the cause never removes the unlock
  const c = settle({ ...a.facts, counters: {} }, C);
  assert.ok(['hub', 'hub.false-start'].every((id) => c.facts.unlocked.includes(id)));
});

test('settle: a child never unlocks before its parent', () => {
  const s = settle(emptyFacts(), C);
  assert.ok(!s.facts.unlocked.includes('childhood.blocks'), 'always-true tableau inside a locked world stays locked');
});

// ---------------------------------------------------------------- the story chain

test('new campaign starts in the room at the false-start block tableau, no news', () => {
  const c = newCampaign(C, 1);
  assert.equal(c.at.node, 'hub.false-start');
  assert.deepEqual([c.at.kind, c.at.activity], ['blocks', null]);
  assert.deepEqual(c.news, []);
  assert.ok(c.facts.seen.includes('hub.false-start'));
});

test('3 block games → reward item + two worlds unlock AT ONCE (one step), seq increasing', () => {
  let c = party();
  c = playOnce(c); c = playOnce(c);
  assert.equal(c.facts.counters[COUNTER.played('blocks')], 2);
  assert.deepEqual(c.news, []);
  const before = c;
  c = playOnce(c);
  assert.equal(c.facts.counters[COUNTER.played('blocks')], 3);
  assert.ok(c.facts.done.includes('hub.false-start'));
  assert.equal(holding(c.facts, 'elodie', 'old-key'), 1, 'the Old key, to the chooser');
  assert.ok(c.facts.flags.includes('false-start-over'));
  assert.deepEqual(unlockedNews(c).sort(), ['childhood', 'childhood.blocks', 'childhood.scene', 'teens', 'teens.blocks', 'teens.scene']);
  const seqs = c.news.map((n) => n.seq);
  assert.deepEqual(seqs, seqs.map((_, i) => before.newsSeq + i + 1), 'seq 1, 2, 3…');
  assert.equal(c.newsSeq, seqs.at(-1));
});

test('round.finished is recorded exactly once per round, when the minigame ends, any end reason', () => {
  let c = startRound(party());
  c = run(c, act({ t: 'endGame', id: 'p' }));
  assert.equal(c.facts.counters[COUNTER.played('blocks')], undefined, 'kept, not recorded, on the podium');
  assert.equal(c.at.results.length, 1);
  // replays of the finished state, or an injected round.finished event, never count twice
  assert.equal(run(c, act({ t: 'endGame', id: 'p' })), c);
  assert.equal(run(c, { t: 'event', event: { t: 'round.finished', kind: 'blocks', node: 'hub.false-start', ranking: [], endReason: 'stuck' } }), c);
  c = run(c, act({ t: 'lobby', id: 'p' }), { t: 'endMinigame', id: 'p' });
  assert.equal(c.facts.counters[COUNTER.played('blocks')], 1);
  assert.deepEqual(c.at.results, []);
  // the bell
  let timed = run(newCampaign(C, 5), { t: 'join', id: 'p', character: 'pierre' }, { t: 'startMinigame', id: 'p', now: 1000 },
    act({ t: 'config', id: 'p', patch: { mode: 'timed' } }));
  timed = startRound(timed);
  const d = /** @type {number} */ (/** @type {any} */ (timed.at.activity?.round)?.deadline);
  const rung = run(timed, act({ t: 'timeUp', deadline: d }), act({ t: 'lobby', id: 'p' }), { t: 'endMinigame', id: 'p' });
  assert.equal(rung.facts.counters[COUNTER.played('blocks')], 1);
});

test('chain: both tableaux done → world done → third world unlocks', () => {
  let c = party();
  c = playOnce(playOnce(playOnce(c)));
  c = run(c, { t: 'back', id: 'p' });
  assert.equal(c.at.node, 'hub');
  for (const w of ['childhood', 'teens']) {
    c = run(c, { t: 'enter', id: 'e', node: w });
    assert.equal(c.at.node, w);
    c = run(c, { t: 'enter', id: 'e', node: `${w}.blocks` });
    assert.deepEqual([c.at.kind, c.at.activity], ['blocks', null], 'the room at the block tableau');
    c = playOnce(c);
    c = run(c, { t: 'back', id: 'p' }, { t: 'enter', id: 'e', node: `${w}.scene` });
    assert.equal(c.at.activity, null, 'scene stub: no block state');
    c = run(c, { t: 'event', event: { t: 'scene.seen', sceneId: `${w}-1`, node: `${w}.scene` } });
    assert.ok(c.facts.done.includes(`${w}.scene`));
    c = run(c, { t: 'back', id: 'p' }, { t: 'back', id: 'p' });
  }
  assert.ok(c.facts.done.includes('childhood') && c.facts.done.includes('teens'));
  assert.ok(c.facts.unlocked.includes('adult'));
  assert.ok(unlockedNews(c).includes('adult'));
});

test('a tableau\'s settings reach its minigame when it starts (teens.blocks is timed)', () => {
  let c = run(playOnce(playOnce(playOnce(party()))), { t: 'back', id: 'p' }, { t: 'enter', id: 'e', node: 'teens' }, { t: 'enter', id: 'e', node: 'teens.blocks' });
  const started = run(c, { t: 'startMinigame', id: 'p', now: 1 });
  assert.equal(/** @type {any} */ (started.at.activity?.settings).mode, 'timed');
  assert.equal(/** @type {any} */ (started.at.activity?.settings).timedSeconds, 120);
  c = run(c, { t: 'back', id: 'p' }, { t: 'enter', id: 'e', node: 'childhood' });
  assert.equal(c.at.node, 'teens', 'enter only a child of where the party is (childhood is a sibling)');
});


test('rewards apply once; replayable games re-enter, one-shot scenes do not', () => {
  let c = playOnce(playOnce(playOnce(party())));
  c = playOnce(c);
  assert.equal(c.news.filter((n) => n.t === 'item').length, 1, 'item news once');
  assert.equal(holding(c.facts, 'elodie', 'old-key'), 1, 'given once, never twice');
  c = run(c, { t: 'back', id: 'p' }, { t: 'enter', id: 'e', node: 'childhood' }, { t: 'enter', id: 'e', node: 'childhood.scene' },
    { t: 'event', event: { t: 'scene.seen', sceneId: 'childhood-1', node: 'childhood.scene' } }, { t: 'back', id: 'p' });
  assert.equal(run(c, { t: 'enter', id: 'e', node: 'childhood.scene' }), c, 'one-shot scene, already done');
  assert.equal(run(c, { t: 'enter', id: 'e', node: 'childhood.blocks' }).at.node, 'childhood.blocks');
});

// ---------------------------------------------------------------- party, enter, back

test('enter: the game master or the chooser only; locked nodes refused; back is the game master\'s', () => {
  let c = playOnce(playOnce(playOnce(party())));
  c = run(c, { t: 'startMinigame', id: 'p', now: 1 });
  assert.equal(run(c, { t: 'back', id: 'e' }), c, 'back: the game master only');
  c = run(c, { t: 'back', id: 'p' });
  assert.equal(c.at.node, 'hub', 'his back ends the minigame first');
  assert.equal(run(c, { t: 'enter', id: 's', node: 'teens' }), c, 'neither the game master nor the chooser');
  assert.equal(run(c, { t: 'enter', id: 'e', node: 'adult' }), c, 'locked');
  assert.equal(run(c, { t: 'enter', id: 'e', node: 'teens' }).at.node, 'teens', 'the chooser walks in');
  assert.equal(run(c, { t: 'enter', id: 'p', node: 'childhood' }).at.node, 'childhood', 'the game master overrides');
});

test('the game master is whoever holds the content\'s character: never passed on, back when Pierre rejoins', () => {
  let c = run(newCampaign(C, 42), { t: 'join', id: 'e', character: 'elodie' }, { t: 'join', id: 's', character: 'sol' });
  assert.equal(gameMasterId(c.party, C), null, 'before Pierre joins, nobody');
  assert.equal(run(c, { t: 'startMinigame', id: 'e', now: 1 }), c, 'the first to join is not the game master');
  c = run(c, { t: 'join', id: 'p', character: 'pierre' });
  assert.equal(gameMasterId(c.party, C), 'p');
  c = run(startRound(c), { t: 'leave', id: 'p' });
  assert.equal(gameMasterId(c.party, C), null, 'once he left, nobody');
  assert.equal(run(c, act({ t: 'endGame', id: 'e' })), c, 'nobody else ends the round');
  c = run(c, { t: 'join', id: 'p2', character: 'pierre' }, act({ t: 'endGame', id: 'p2' }));
  assert.equal(c.at.activity?.stage, 'podium', 'Pierre back, under a new id');
  c = run(c, { t: 'status', id: 'p2', status: 'wisp', on: true });
  assert.ok(c.party.players.p2.statuses.includes('wisp'));
  assert.equal(run(c, act({ t: 'lobby', id: 'p2' })).at.activity?.stage, 'lobby', 'wisp or not');
});


test('party: a left member\'s character is free', () => {
  let c = run(party(), { t: 'leave', id: 'e' });
  assert.equal(c.party.players.e.left, true);
  c = run(c, { t: 'join', id: 'e2', character: 'elodie' });
  assert.ok(c.party.players.e2, 'a left member\'s character is free');
  assert.equal(run(c, { t: 'leave', id: 'e' }), c, 'already left');
  assert.equal(run(c, { t: 'join', id: 'x', character: 'sol' }), c, 'character held → refused');
  assert.equal(run(c, { t: 'join', id: 'e2', character: 'anna' }), c, 'id already in the party');
});

// ---------------------------------------------------------------- ack

test('ack by seq: two TVs, one acks — only the entries up to its seq go', () => {
  let c = playOnce(playOnce(playOnce(party())));
  const n = c.news.length;
  assert.ok(n >= 3);
  const mid = c.news[1].seq;
  const tvA = run(c, { t: 'ack', id: 'screen', upTo: mid });
  assert.equal(tvA.news.length, n - 2);
  assert.ok(tvA.news.every((x) => x.seq > mid));
  // the second TV acks an older seq: nothing more is dropped
  assert.equal(run(tvA, { t: 'ack', id: 'screen', upTo: c.news[0].seq }), tvA);
  // later news keep counting up after an ack
  let d = run(tvA, { t: 'ack', id: 'screen', upTo: c.newsSeq });
  assert.deepEqual(d.news, []);
  d = run(d, { t: 'gm', id: 'p', op: { op: 'unlock', node: 'adult' } });
  assert.deepEqual(d.news.map((x) => x.seq)[0], c.newsSeq + 1);
  assert.equal(run(c, /** @type {any} */ ({ t: 'ack', id: 'screen' })), c, 'upTo required');
});

// ---------------------------------------------------------------- gm

test('gm: the game master only; goto / unlock / lock (sticks) / setFlag / count / reset-node', () => {
  let c = party();
  assert.equal(run(c, { t: 'gm', id: 's', op: { op: 'unlock', node: 'adult' } }), c, 'the game master only');
  c = run(c, { t: 'gm', id: 'p', op: { op: 'unlock', node: 'teens' } });
  assert.ok(c.facts.unlocked.includes('teens') && c.facts.unlocked.includes('teens.blocks'), 'forced unlock settles its children');
  c = run(c, { t: 'gm', id: 'p', op: { op: 'lock', node: 'teens' } });
  assert.ok(!c.facts.unlocked.includes('teens'));
  c = playOnce(playOnce(playOnce(c)));
  assert.ok(!c.facts.unlocked.includes('teens'), 'a gm lock sticks even when its condition holds');
  assert.ok(c.facts.unlocked.includes('childhood'));
  c = run(c, { t: 'gm', id: 'p', op: { op: 'unlock', node: 'teens' } });
  assert.ok(c.facts.unlocked.includes('teens'));
  c = run(c, { t: 'gm', id: 'p', op: { op: 'goto', node: 'teens.blocks' } });
  assert.equal(c.at.node, 'teens.blocks');
  assert.deepEqual([c.at.kind, c.at.activity], ['blocks', null]);
  c = run(c, { t: 'gm', id: 'p', op: { op: 'setFlag', flag: 'met-x', on: true } });
  assert.ok(c.facts.flags.includes('met-x'));
  c = run(c, { t: 'gm', id: 'p', op: { op: 'setFlag', flag: 'met-x', on: false } });
  assert.ok(!c.facts.flags.includes('met-x'));
  c = run(c, { t: 'gm', id: 'p', op: { op: 'count', counter: 'blocks.played', set: 10 } });
  assert.equal(c.facts.counters['blocks.played'], 10);
  c = run(c, { t: 'gm', id: 'p', op: { op: 'count', counter: 'quiz.x.correct' } });
  assert.equal(c.facts.counters['quiz.x.correct'], 1);
  c = playOnce(c);
  assert.ok(c.facts.done.includes('teens.blocks'));
  c = run(c, { t: 'gm', id: 'p', op: { op: 'reset-node', node: 'teens.blocks' } });
  assert.ok(!c.facts.done.includes('teens.blocks') && !c.facts.counters[COUNTER.finished('teens.blocks')]);
  assert.equal(run(c, { t: 'gm', id: 'p', op: /** @type {any} */ ({ op: 'explode' }) }), c);
});

// ---------------------------------------------------------------- loading a save

test('loadCampaign: a minigame that cannot give a status (a round from before minigame lobbies) is refused', () => {
  const c = startRound(party());
  const old = JSON.parse(JSON.stringify(c));
  old.at.activity = old.at.activity.round; // a round saved without its lobby
  assert.throws(() => loadCampaign(old, C), /can resume/);
  const stage = JSON.parse(JSON.stringify(c));
  stage.at.activity.stage = 'podium'; // a podium whose round still runs
  assert.throws(() => loadCampaign(stage, C), /can resume/);
});

test('content tolerance: unknown ids dropped, settle re-runs, nothing re-locked', () => {
  const c = playOnce(playOnce(playOnce(party())));
  const raw = /** @type {Campaign} */ (JSON.parse(JSON.stringify({
    ...c,
    facts: { ...c.facts, unlocked: [...c.facts.unlocked, 'removed.world'], done: [...c.facts.done, 'removed.world'] },
    news: [...c.news, { seq: c.newsSeq + 1, t: 'unlocked', node: 'removed.world' }],
    newsSeq: c.newsSeq + 1,
  })));
  const l = loadCampaign(raw, C);
  assert.ok(!l.facts.unlocked.includes('removed.world') && !l.facts.done.includes('removed.world'));
  assert.ok(!l.news.some((n) => n.t === 'unlocked' && n.node === 'removed.world'));
  assert.ok(c.facts.unlocked.every((id) => l.facts.unlocked.includes(id)), 'nothing re-locked');
  // a content edit adds a world whose condition already holds → unlocked on load, with news
  /** @type {Content} */
  const edited = structuredClone(C);
  edited.nodes.bonus = { id: 'bonus', kind: 'world', parent: 'hub', title: 'Bonus', unlock: { count: 'blocks.played', gte: 1 } };
  assert.deepEqual(validateContent(edited), []);
  const l2 = loadCampaign(raw, edited);
  assert.ok(l2.facts.unlocked.includes('bonus'));
  assert.ok(l2.news.some((n) => n.t === 'unlocked' && n.node === 'bonus' && n.seq > raw.newsSeq));
  // the party stood in a node that no longer exists → back at the start
  const lost = loadCampaign({ ...raw, at: { node: 'removed.world', kind: null, activity: null, results: [] } }, C);
  assert.equal(lost.at.node, C.start);
  assert.deepEqual([lost.at.kind, lost.at.activity], ['blocks', null], 'the room at the start');
});

test('determinism: same actions → same campaign (seeds advance on every minigame and round started)', () => {
  const a = playOnce(playOnce(party()));
  const b = playOnce(playOnce(party()));
  assert.deepEqual(a, b);
  const r1 = run(startRound(party()), act({ t: 'endGame', id: 'p' }), act({ t: 'lobby', id: 'p' }));
  const r2 = run(r1, act({ t: 'start', id: 'p', now: 2 }));
  assert.equal(r2.at.activity?.stage, 'running', 'the round\'s players came back ready');
  assert.notEqual(blockSeed(startRound(party())), blockSeed(r2), 'the next round, a new seed');
});

test('loadCampaign: a JSON round-trip (a server restart) is deep-equal in every phase — no reshuffled seed', () => {
  const room = party();
  const lobby = run(room, { t: 'startMinigame', id: 'p', now: 1 }, act({ t: 'ready', id: 'e', on: true }));
  const playing = startRound(room);
  const podium = run(playing, act({ t: 'endGame', id: 'p' }));
  const lobbyAgain = run(podium, act({ t: 'lobby', id: 'p' }));
  const withNews = playOnce(playOnce(playOnce(room)));
  const hub = run(withNews, { t: 'back', id: 'p' });
  const world = run(hub, { t: 'enter', id: 'e', node: 'childhood' });
  const scene = run(world, { t: 'enter', id: 'e', node: 'childhood.scene' });
  const fresh = newCampaign(C, 42);
  /** @type {Record<string, Campaign>} */
  const cases = { fresh, room, lobby, playing, podium, lobbyAgain, withNews, hub, world, scene };
  for (const [name, c] of Object.entries(cases)) {
    const back = loadCampaign(JSON.parse(JSON.stringify(c)), C);
    assert.deepEqual(back, JSON.parse(JSON.stringify(c)), `${name}: deep-equal after load`);
    assert.equal(back.seed, c.seed, `${name}: seed kept`);
    // and the NEXT block game is the same one as without the restart
    const next = (/** @type {Campaign} */ x) => blockSeed(startRound(run(x, { t: 'gm', id: 'p', op: { op: 'goto', node: 'teens.blocks' } }), 5));
    assert.equal(next(back), next(c), `${name}: next block game unchanged by the restart`);
  }
  assert.ok(withNews.news.length > 0, 'pending news survive too');
  assert.equal(lobbyAgain.at.results.length, 1, 'a finished round\'s result survives in the lobby');
});
