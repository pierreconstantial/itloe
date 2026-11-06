// A running minigame in the main game (shared/campaign) and its plain lobby (shared/plain-lobby.js): the game
// master's start and end, eligible players and their changes, ready, the round → podium → lobby flow, and
// results kept until the end and recorded then, once, in order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_CONTENT, COUNTER, askedSoFar, eligibleOf, holding, minigameStatus, newCampaign, readyRuleMet, reduceCampaign,
} from '../shared/campaign/index.js';
import { candidatesFor } from '../shared/quiz/bank.js';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../shared/campaign/types.js').CampaignAction} CampaignAction */
/** @typedef {import('../shared/campaign/types.js').Content} Content */

/** @param {Content} content @param {Campaign} c @param {CampaignAction[]} actions */
const runIn = (content, c, ...actions) => actions.reduce((x, a) => reduceCampaign(x, a, content), c);
/** @param {Campaign} c @param {CampaignAction[]} actions */
const run = (c, ...actions) => runIn(SAMPLE_CONTENT, c, ...actions);
/** An action of the running minigame. @param {any} action @returns {CampaignAction} */
const act = (action) => ({ t: 'activity', action });
/** The running minigame's plain lobby state. @param {Campaign} c @returns {any} */
const lobby = (c) => c.at.activity;

/** Pierre (the game master), Élodie and Sol, in the room at the false start. */
const party = (content = SAMPLE_CONTENT) => runIn(content, newCampaign(content, 42),
  { t: 'join', id: 'p', character: 'pierre' }, { t: 'join', id: 'e', character: 'elodie' }, { t: 'join', id: 's', character: 'sol' });

test('the game master starts and ends a minigame; nobody else can; ended before a finished round, it records nothing', () => {
  const c = party();
  assert.equal(run(c, { t: 'startMinigame', id: 'e', now: 1 }), c, 'a guest can\'t start it');
  const open = run(c, { t: 'startMinigame', id: 'p', now: 1 });
  assert.equal(minigameStatus(open), 'lobby');
  assert.deepEqual(lobby(open).players, [{ id: 'p', character: 'pierre' }, { id: 'e', character: 'elodie' }, { id: 's', character: 'sol' }]);
  assert.deepEqual(lobby(open).ready, []);
  assert.notEqual(open.seed, c.seed, 'the campaign\'s seed advances');
  assert.equal(run(open, { t: 'startMinigame', id: 'p', now: 2 }), open, 'already running');
  assert.equal(run(open, { t: 'endMinigame', id: 'e' }), open, 'a guest can\'t end it');
  const running = run(open, act({ t: 'ready', id: 'e', on: true }), act({ t: 'start', id: 'p', now: 2 }));
  assert.equal(minigameStatus(running), 'running');
  assert.equal(run(running, { t: 'endMinigame', id: 'p' }), running, 'not while a round runs');
  const podium = run(running, act({ t: 'endGame', id: 'p' }));
  assert.equal(minigameStatus(podium), 'podium');
  assert.equal(run(podium, { t: 'endMinigame', id: 'p' }), podium, 'not on the podium');
  const ended = run(open, { t: 'endMinigame', id: 'p' });
  assert.deepEqual([ended.at.kind, ended.at.activity, ended.at.results], ['blocks', null, []], 'the room at the tableau');
  assert.equal(ended.facts, open.facts, 'no finished round: nothing recorded');
});

test('eligible players come from the tableau\'s content: named characters, story wisps included; else everyone but story wisps', () => {
  /** @type {Content} */
  const named = structuredClone(SAMPLE_CONTENT);
  /** @type {any} */ (named.nodes['hub.false-start'].activity).eligible = ['pierre', 'nico'];
  const withNico = (/** @type {Content} */ content) => runIn(content, party(content),
    { t: 'join', id: 'n', character: 'nico' }, { t: 'status', id: 'n', status: 'wisp', on: true });
  assert.deepEqual(eligibleOf(withNico(SAMPLE_CONTENT).party, 'hub.false-start', SAMPLE_CONTENT).map((p) => p.id), ['p', 'e', 's'],
    'no names: an unnamed story wisp isn\'t eligible');
  const c = runIn(named, withNico(named), { t: 'startMinigame', id: 'p', now: 1 });
  assert.deepEqual(lobby(c).players.map((/** @type {any} */ p) => p.id), ['p', 'n'], 'names: a named story wisp is eligible, the others aren\'t');
  assert.equal(runIn(named, c, act({ t: 'ready', id: 'e', on: true })), c, 'a player who isn\'t eligible can\'t get ready');
  const n = runIn(named, c, act({ t: 'ready', id: 'n', on: true }), act({ t: 'start', id: 'p', now: 2 }));
  assert.deepEqual(lobby(n).round.order, ['n'], 'Nico plays as his character');
});

test('ready: eligible players, in the lobby; Start needs one ready and seats the ready ones in party order; settings are the game master\'s', () => {
  let c = run(party(), { t: 'startMinigame', id: 'p', now: 1 });
  assert.equal(run(c, act({ t: 'start', id: 'p', now: 2 })), c, 'nobody ready');
  c = run(c, act({ t: 'ready', id: 's', on: true }), act({ t: 'ready', id: 'p', on: true }));
  assert.deepEqual(lobby(c).ready, ['p', 's'], 'in party order');
  assert.equal(run(c, act({ t: 'ready', id: 's', on: true })), c, 'already ready');
  c = run(c, act({ t: 'ready', id: 'p', on: false }));
  assert.deepEqual(lobby(c).ready, ['s'], 'tapped again: not ready');
  assert.equal(run(c, act({ t: 'config', id: 's', patch: { size: 10 } })), c, 'a guest can\'t change the settings');
  c = run(c, act({ t: 'config', id: 'p', patch: { size: 10 } }));
  assert.equal(run(c, act({ t: 'config', id: 'p', patch: { size: 10 } })), c, 'no change: the same state');
  assert.equal(run(c, act({ t: 'start', id: 's', now: 2 })), c, 'a guest can\'t start a round');
  c = run(c, act({ t: 'ready', id: 'e', on: true }), act({ t: 'start', id: 'p', now: 2 }));
  assert.deepEqual(lobby(c).round.order, ['e', 's'], 'the ready players, in party order');
  assert.equal(lobby(c).round.rules.size, 10, 'the settings, locked in');
  assert.equal(run(c, act({ t: 'ready', id: 'p', on: true })), c, 'no ready during a round');
  assert.equal(run(c, act({ t: 'config', id: 'p', patch: { size: 9 } })), c, 'no settings during a round');
});

test('a round, its podium, the lobby again with its players ready (not who left or was taken out), and a second round', () => {
  let c = run(party(), { t: 'join', id: 'a', character: 'anna' }, { t: 'startMinigame', id: 'p', now: 1 });
  c = run(c, ...['p', 'e', 's', 'a'].map((id) => act({ t: 'ready', id, on: true })), act({ t: 'start', id: 'p', now: 2 }));
  c = run(c, act({ t: 'retire', id: 'e', target: 's' }));
  assert.equal(lobby(c).round.players.s.done, false, 'only the game master takes a player out');
  c = run(c, act({ t: 'retire', id: 'p', target: 's' }), { t: 'leave', id: 'a' });
  assert.deepEqual(lobby(c).players.map((/** @type {any} */ p) => p.id), ['p', 'e', 's'], 'who left the evening is no longer listed');
  assert.equal(lobby(c).round.players.a.left, true, '…and is out of the round');
  c = run(c, { t: 'join', id: 'n', character: 'nico' });
  assert.deepEqual(lobby(c).players.map((/** @type {any} */ p) => p.id), ['p', 'e', 's', 'n'], 'a newcomer is listed');
  assert.equal(lobby(c).round.players.n, undefined, '…and watches the round');
  assert.equal(run(c, act({ t: 'lobby', id: 'p' })), c, 'back to the lobby: from the podium only');
  c = run(c, act({ t: 'endGame', id: 'p' }));
  assert.equal(minigameStatus(c), 'podium', 'the round finished: the podium, in the same step');
  assert.equal(run(c, act({ t: 'lobby', id: 's' })), c, 'back to the lobby: the game master only');
  c = run(c, act({ t: 'lobby', id: 'p' }));
  assert.deepEqual([minigameStatus(c), lobby(c).round], ['lobby', null]);
  assert.deepEqual(lobby(c).ready, ['p', 'e'], 'the round\'s players come back ready, except who was taken out or left');
  const seed = lobby(c).seed;
  c = run(c, act({ t: 'ready', id: 'n', on: true }), act({ t: 'start', id: 'p', now: 3 }));
  assert.deepEqual(lobby(c).round.order, ['p', 'e', 'n'], 'the second round, the newcomer in it');
  assert.equal(lobby(c).round.seed, seed, 'its seed from the lobby\'s…');
  assert.notEqual(lobby(c).seed, seed, '…which advances');
});

test('a player who stops being eligible leaves the minigame; one who becomes eligible joins it', () => {
  let c = run(party(), { t: 'startMinigame', id: 'p', now: 1 }, act({ t: 'ready', id: 's', on: true }), act({ t: 'ready', id: 'e', on: true }));
  c = run(c, act({ t: 'start', id: 'p', now: 2 }), { t: 'gm', id: 'p', op: { op: 'wisp', character: 'sol', on: true } });
  assert.equal(lobby(c).round.players.s.left, true, 'a new story wisp is out of the round');
  assert.deepEqual(lobby(c).players.map((/** @type {any} */ p) => p.id), ['p', 'e']);
  c = run(c, { t: 'gm', id: 'p', op: { op: 'wisp', character: 'sol', on: false } });
  assert.deepEqual(lobby(c).players.map((/** @type {any} */ p) => p.id), ['p', 'e'], 'still a wisp while incarnating');
  c = run(c, { t: 'incarnate', id: 's' });
  assert.deepEqual(lobby(c).players.map((/** @type {any} */ p) => p.id), ['p', 'e', 's'], 'incarnated: eligible again');
  c = run(c, { t: 'leave', id: 'e' });
  assert.equal(minigameStatus(c), 'podium', 'the last player out ends the round');
  assert.equal(c.at.results.length, 1, '…and its result is kept');
});

test('goto and back end a running minigame first: the finished rounds recorded, a running round dropped', () => {
  let c = run(party(), { t: 'startMinigame', id: 'p', now: 1 }, act({ t: 'ready', id: 'e', on: true }), act({ t: 'start', id: 'p', now: 2 }));
  c = run(c, act({ t: 'endGame', id: 'p' }), act({ t: 'lobby', id: 'p' }), act({ t: 'start', id: 'p', now: 3 }));
  assert.equal(minigameStatus(c), 'running', 'a second round runs');
  for (const move of /** @type {CampaignAction[]} */ ([{ t: 'gm', id: 'p', op: { op: 'goto', node: 'hub' } }, { t: 'back', id: 'p' }])) {
    const moved = run(c, move);
    assert.deepEqual([moved.at.node, moved.at.activity, moved.at.results], ['hub', null, []], move.t);
    assert.equal(moved.facts.counters[COUNTER.played('blocks')], 1, `${move.t}: the finished round, not the running one`);
  }
});

/** Five questions, four with choices, for the quiz's candidates (the bank stays on the server). */
const BANK = /** @type {import('../shared/quiz/bank.js').Question[]} */ (['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10']
  .map((id) => ({ id, q: id, choices: ['a', 'b', 'c', 'd'], answer: 0, category: 'x', level: 1, source: 'test' })));

/** One quiz round from the lobby: `winner` answers right, everyone else wrong. @param {Content} content @param {Campaign} c @param {string} winner */
function quizRound(content, c, winner, now = 1000) {
  const inputs = candidatesFor(BANK, lobby(c).settings, askedSoFar(c));
  c = runIn(content, c, act({ t: 'start', id: 'p', now, inputs }));
  while (lobby(c).round.phase === 'question') {
    for (const id of lobby(c).round.order) {
      c = runIn(content, c, act({ t: 'answer', id, choice: 0, now: now + 500, verdict: id === winner ? 'right' : 'wrong' }));
    }
    now += 30_000;
    c = runIn(content, c, act({ t: 'next', id: 'p', now }));
  }
  return runIn(content, c, act({ t: 'lobby', id: 'p' }));
}

test('results are kept until the end and recorded then, once, in order: the winner reward goes to the round that completed the node; no question twice', () => {
  /** @type {Content} */
  const content = structuredClone(SAMPLE_CONTENT);
  content.start = 'childhood.quiz';
  content.nodes.childhood.unlock = { always: true };
  content.nodes['childhood.quiz'].unlock = { always: true };
  content.nodes['childhood.quiz'].complete = { count: COUNTER.finished('childhood.quiz'), gte: 2 };
  let c = runIn(content, party(content), { t: 'startMinigame', id: 'p', now: 1 }, act({ t: 'config', id: 'p', patch: { count: 3 } }));
  c = runIn(content, c, ...['p', 'e', 's'].map((id) => act({ t: 'ready', id, on: true })));
  c = quizRound(content, c, 'e');
  c = quizRound(content, c, 's');
  c = quizRound(content, c, 'e');
  assert.deepEqual(c.at.results.map((r) => r.ranking.find((x) => x.rank === 1)?.character), ['elodie', 'sol', 'elodie']);
  assert.equal(c.facts.counters[COUNTER.played('quiz')], undefined, 'nothing recorded before the end');
  const asked = c.at.results.flatMap((r) => r.asked ?? []);
  assert.equal(asked.length, 9);
  assert.equal(new Set(asked).size, 9, 'no question asked twice across the rounds of one run');
  assert.deepEqual(askedSoFar(c), asked);
  const ended = runIn(content, c, { t: 'endMinigame', id: 'p' });
  assert.equal(ended.facts.counters[COUNTER.played('quiz')], 3);
  assert.equal(ended.facts.counters[COUNTER.won('quiz', 'elodie')], 2);
  assert.deepEqual(ended.facts.asked, asked);
  assert.ok(ended.facts.done.includes('childhood.quiz'));
  assert.equal(holding(ended.facts, 'sol', 'ticket'), 1, 'the second round completed the node: its winner gets the ticket');
  assert.equal(holding(ended.facts, 'elodie', 'ticket'), 0);
  assert.equal(runIn(content, ended, { t: 'endMinigame', id: 'p' }), ended, 'recorded once');
});

test('the content\'s ready rule: every named character in the party and ready; without names, every eligible player', () => {
  const players = [{ id: 'p', character: 'pierre' }, { id: 'e', character: 'elodie' }];
  assert.equal(readyRuleMet({}, players, []), true, 'no rule');
  assert.equal(readyRuleMet({ allReady: true }, players, ['p']), false);
  assert.equal(readyRuleMet({ allReady: true }, players, ['p', 'e']), true);
  assert.equal(readyRuleMet({ allReady: true, eligible: ['pierre', 'elodie', 'sol'] }, players, ['p', 'e']), false, 'Sol isn\'t in the party');
  /** @type {Content} */
  const content = structuredClone(SAMPLE_CONTENT);
  /** @type {any} */ (content.nodes['hub.false-start'].activity).allReady = true;
  const c = runIn(content, party(content), { t: 'startMinigame', id: 'p', now: 1 }, act({ t: 'ready', id: 'p', on: true }), act({ t: 'ready', id: 'e', on: true }));
  assert.equal(runIn(content, c, act({ t: 'start', id: 'p', now: 2 })), c, 'Sol isn\'t ready');
  assert.equal(minigameStatus(runIn(content, c, act({ t: 'ready', id: 's', on: true }), act({ t: 'start', id: 'p', now: 2 }))), 'running');
});
