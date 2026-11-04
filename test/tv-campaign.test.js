// TV campaign logic: door states (public/screen/doors.js) and the cutscene queue (cutscenes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CONTENT as C, newCampaign, reduceCampaign } from '../shared/campaign/index.js';
import { doorStates, mapCopy } from '../public/screen/doors.js';
import { composeMoment, createCutscenes } from '../public/screen/cutscenes.js';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @param {Campaign} c @param {any[]} actions */
const run = (c, ...actions) => actions.reduce((x, a) => reduceCampaign(x, a, C), c);
/** @param {Campaign} c */
const game = (c) => run(c, { t: 'activity', action: { t: 'newGame', id: 'e' } }, { t: 'activity', action: { t: 'start', id: 'e', now: 1 } }, { t: 'activity', action: { t: 'endGame', id: 'e' } });

function threeGames() {
  let c = run(newCampaign(C, 3), { t: 'join', id: 'e', character: 'elodie' });
  c = run(c, { t: 'activity', action: { t: 'start', id: 'e', now: 1 } }, { t: 'activity', action: { t: 'endGame', id: 'e' } });
  return game(game(c));
}

test('doorStates: locked / new / open / done from the facts', () => {
  let c = threeGames();
  c = run(c, { t: 'back', id: 'e' });
  const byId = Object.fromEntries(doorStates(c, C).map((d) => [d.id, d.state]));
  assert.deepEqual(byId, { 'hub.false-start': 'done', childhood: 'new', teens: 'new', adult: 'locked' });
  c = run(c, { t: 'enter', id: 'e', node: 'childhood' }, { t: 'back', id: 'e' });
  assert.equal(doorStates(c, C).find((d) => d.id === 'childhood')?.state, 'open', 'entered once → no longer new');
  assert.equal(mapCopy(c, C).title, C.nodes.hub.title);
  assert.ok(mapCopy(c, C).hint.startsWith('Élodie'));
  assert.deepEqual(mapCopy(c, C).items, ['reward-1']);
});

test('composeMoment: worlds fold their own tableaux; items listed; headline', () => {
  const c = threeGames();
  const m = composeMoment(c.news, C);
  assert.deepEqual(m.unlocked.map((u) => u.id), ['childhood', 'teens']);
  assert.deepEqual(m.items, ['reward-1']);
  assert.equal(m.headline, 'New worlds unlocked!');
  assert.equal(m.upTo, c.newsSeq);
});

/** Controllable player: each play resolves when finish() is called or aborted. */
function harness(canPlay = () => true) {
  /** @type {{ m: any, signal: AbortSignal, done: () => void }[]} */
  const plays = [];
  /** @type {number[]} */
  const acks = [];
  const cs = createCutscenes({
    play: (m, signal) => new Promise((res) => {
      plays.push({ m, signal, done: () => res(undefined) });
      signal.addEventListener('abort', () => res(undefined), { once: true });
    }),
    ack: (u) => acks.push(u),
    canPlay,
    content: () => C,
  });
  return { cs, plays, acks };
}
const tickOut = () => new Promise((r) => setTimeout(r, 0));

test('cutscenes: all pending news play as ONE moment, then one ack upTo the last seq; never replayed', async () => {
  const news = threeGames().news;
  const { cs, plays, acks } = harness();
  cs.update(news, 7);
  cs.update(news, 7);
  assert.equal(plays.length, 1, 'one moment, not one per view or per entry');
  plays[0].done(); await tickOut();
  assert.deepEqual(acks, [news.at(-1)?.seq]);
  cs.update(news, 7); // the ack has not landed yet: same news again
  await tickOut();
  assert.equal(plays.length, 1, 'no replay of a shown seq');
  cs.update([], 7);
  assert.equal(cs.maxShown(), news.at(-1)?.seq);
});

test('cutscenes: two TVs — the other acks first → this one stops early and does not ack', async () => {
  const news = threeGames().news;
  const a = harness(), b = harness();
  a.cs.update(news, 7); b.cs.update(news, 7);
  a.plays[0].done(); await tickOut();
  assert.equal(a.acks.length, 1);
  b.cs.update([], 7); // A's ack reached the server: B's view has no news left
  await tickOut();
  assert.ok(b.plays[0].signal.aborted, 'B stopped');
  assert.deepEqual(b.acks, [], 'B does not ack');
  b.cs.update(news, 7); // a stale view arriving late: B never replays
  await tickOut();
  assert.equal(b.plays.length, 1);
});

test('cutscenes: deferred while a game runs; later news make a second moment; a new campaign resets', async () => {
  let open = false;
  const { cs, plays, acks } = harness(() => open);
  const news = threeGames().news;
  cs.update(news, 7);
  assert.equal(plays.length, 0, 'deferred');
  open = true; cs.poke();
  assert.equal(plays.length, 1);
  plays[0].done(); await tickOut();
  const later = [{ seq: 8, t: /** @type {const} */ ('unlocked'), node: 'adult' }];
  cs.update(later, 8);
  assert.equal(plays.length, 2);
  assert.deepEqual(plays[1].m.unlocked.map((/** @type {any} */ u) => u.id), ['adult']);
  plays[1].done(); await tickOut();
  assert.deepEqual(acks, [7, 8]);
  cs.update([{ seq: 1, t: 'item', item: 'x' }], 1); // server restarted with a NEW campaign
  assert.equal(plays.length, 3);
});

test('cutscenes: with an ack delay, a TV that sees the news vanish meanwhile stays silent', async () => {
  const news = threeGames().news;
  /** @type {number[]} */
  const acks = [];
  /** @type {(() => void)[]} */
  const ends = [];
  const cs = createCutscenes({
    play: () => new Promise((res) => ends.push(() => res(undefined))),
    ack: (u) => acks.push(u), canPlay: () => true, content: () => C, ackDelay: () => 30,
  });
  cs.update(news, 7);
  ends[0]();
  await tickOut();
  cs.update([], 7); // the other TV's ack landed during our delay
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(acks, []);
});
