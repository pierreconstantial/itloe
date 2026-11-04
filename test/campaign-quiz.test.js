// Contract E / E1 — a quiz tableau inside the campaign engine (shared/campaign): enter → quiz lobby
// seeded from the party → finished exactly once → counters, totals and the evening's asked ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, reduceCampaign, loadCampaign, activityRunning, SAMPLE_CONTENT, COUNTER } from '../shared/campaign/index.js';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../shared/campaign/types.js').CampaignAction} CampaignAction */
/** @typedef {import('../shared/quiz/index.js').QuizState} QuizState */

const C = SAMPLE_CONTENT;
const QUIZ = 'childhood.quiz';
const CANDIDATES = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'].map((id, i) => ({ id, choices: i % 2 ? 4 : 0 }));

/** @param {Campaign} c @param {...CampaignAction} actions */
const run = (c, ...actions) => actions.reduce((x, a) => reduceCampaign(x, a, C), c);
/** @param {Campaign} c @returns {QuizState} */
const quiz = (c) => /** @type {any} */ (c.at.activity);
const act = (/** @type {any} */ action) => /** @type {CampaignAction} */ ({ t: 'activity', action });

/** Élodie (host) + Sol, standing in the World 1 quiz lobby. */
function inQuiz() {
  let c = newCampaign(C, 5);
  c = run(c, { t: 'join', id: 'e', character: 'elodie' }, { t: 'join', id: 's', character: 'sol' });
  c = run(c, { t: 'gm', id: 'e', op: { op: 'unlock', node: 'childhood' } });
  assert.ok(!c.facts.unlocked.includes(QUIZ), 'the quiz waits for the world\'s block game');
  c = run(c, { t: 'gm', id: 'e', op: { op: 'unlock', node: QUIZ } }, { t: 'gm', id: 'e', op: { op: 'goto', node: QUIZ } });
  assert.ok(c.facts.unlocked.includes(QUIZ));
  return c;
}

/** Plays the whole quiz: Élodie right every time, Sol wrong. */
function playThrough(/** @type {Campaign} */ c, now = 1000) {
  c = run(c, act({ t: 'start', id: 'e', now, candidates: CANDIDATES }));
  while (quiz(c).phase === 'question') {
    const r = /** @type {any} */ (quiz(c).round);
    const given = r.asChoice ? { choice: 0 } : { text: 'x' };
    c = run(c, act({ t: 'answer', id: 'e', ...given, now: now + 500, verdict: 'right' }),
      act({ t: 'answer', id: 's', ...given, now: now + 900, verdict: 'wrong' }));
    now += 30_000;
    c = run(c, act({ t: 'next', id: 'e', now }));
  }
  return c;
}

test('entering a quiz tableau opens a quiz lobby seeded with the party (node settings, party host)', () => {
  const c = inQuiz();
  const q = quiz(c);
  assert.equal(c.at.node, QUIZ);
  assert.equal(q.kind, 'quiz');
  assert.equal(q.phase, 'lobby');
  assert.deepEqual(q.order, ['e', 's']);
  assert.equal(q.hostId, 'e');
  assert.equal(q.settings.count, 5, 'settings from the node');
  assert.equal(activityRunning(c.at.activity), false);
});

test('quiz under way: enter/back refused; a newcomer waits for the next lobby', () => {
  let c = run(inQuiz(), act({ t: 'start', id: 'e', now: 1, candidates: CANDIDATES }));
  assert.equal(activityRunning(c.at.activity), true);
  assert.equal(run(c, { t: 'back', id: 'e' }), c, 'back refused while the quiz runs');
  c = run(c, { t: 'join', id: 'a', character: 'anna' });
  assert.ok(c.party.players.a && !quiz(c).players.a, 'joined the evening, not seated mid-quiz');
});

test('finished → quiz.finished recorded exactly once: counters, totals, asked', () => {
  const c = playThrough(inQuiz());
  const q = quiz(c);
  assert.equal(q.phase, 'finished');
  const f = c.facts;
  assert.equal(f.counters[COUNTER.quizPlayed], 1);
  assert.equal(f.counters[COUNTER.finished(QUIZ)], 1);
  assert.equal(f.counters[COUNTER.correctBy('elodie')], 5);
  assert.equal(f.counters[COUNTER.correctBy('sol')] ?? 0, 0);
  assert.equal(f.counters[COUNTER.quizWon('elodie')], 1);
  assert.equal(f.totals.elodie, q.players.e.score);
  assert.deepEqual(f.asked, q.asked);
  assert.equal(f.asked.length, 5);
  assert.ok(f.done.includes(QUIZ), 'default completion: its activity finished once');
  // nothing after the finish counts again
  const again = run(c, act({ t: 'endGame', id: 'e' }), act({ t: 'verdict', target: 's', ok: true }));
  assert.equal(again.facts.counters[COUNTER.quizPlayed], 1);
});

test('a second quiz: newGame → lobby → asked grows, never duplicated', () => {
  let c = playThrough(inQuiz());
  const first = [...c.facts.asked];
  c = run(c, act({ t: 'newGame', id: 'e' }));
  assert.equal(quiz(c).phase, 'lobby');
  c = playThrough(c, 999_000);
  assert.equal(c.facts.counters[COUNTER.quizPlayed], 2);
  assert.equal(new Set(c.facts.asked).size, c.facts.asked.length, 'no duplicates');
  assert.ok(first.every((id) => c.facts.asked.includes(id)));
});

test('the host ending a quiz still counts it (endReason host)', () => {
  let c = run(inQuiz(), act({ t: 'start', id: 'e', now: 1, candidates: CANDIDATES }));
  c = run(c, act({ t: 'endGame', id: 'e' }));
  assert.equal(quiz(c).endReason, 'host');
  assert.equal(c.facts.counters[COUNTER.quizPlayed], 1);
  assert.equal(c.facts.asked.length, 1, 'the one question shown counts as asked');
});

test('asked survives loadCampaign; an older campaign without it loads with an empty list', () => {
  const c = playThrough(inQuiz());
  const loaded = loadCampaign(JSON.parse(JSON.stringify(c)), C);
  assert.deepEqual(loaded.facts.asked, c.facts.asked);
  assert.deepEqual(loaded, c, 'round trip is exact');
  const old = JSON.parse(JSON.stringify(newCampaign(C, 1)));
  delete old.facts.asked;
  assert.deepEqual(loadCampaign(old, C).facts.asked, []);
});
