// Contract E / E1 — a quiz tableau inside the campaign engine (shared/campaign): enter → the room → a quiz
// started with the party → finished exactly once → its result: counters, totals and the evening's asked ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign, reduceCampaign, loadCampaign, roundStatus, SAMPLE_CONTENT, record, holds } from '../shared/campaign/index.js';
import { startQuiz, QUIZ_COUNTER, QUIZ_RULES } from '../shared/quiz/index.js';

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

/** Élodie (host) + Sol, standing in the room at the World 1 quiz. */
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
  c = run(c, { t: 'start', id: 'e', now, inputs: CANDIDATES });
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

test('quiz under way: enter/back refused; a newcomer waits for the next round', () => {
  let c = run(inQuiz(), { t: 'start', id: 'e', now: 1, inputs: CANDIDATES });
  assert.equal(roundStatus(c), 'running');
  assert.equal(run(c, { t: 'back', id: 'e' }), c, 'back refused while the quiz runs');
  c = run(c, { t: 'join', id: 'a', character: 'anna' });
  assert.ok(c.party.players.a && !quiz(c).players.a, 'joined the evening, not seated mid-quiz');
});

test('taking a player out of a quiz counts as their leaving: host only, while it runs', () => {
  let c = run(inQuiz(), { t: 'start', id: 'e', now: 1, inputs: CANDIDATES });
  assert.equal(run(c, act({ t: 'retire', id: 's', target: 'e' })), c, 'a guest can\'t');
  c = run(c, act({ t: 'retire', id: 'e', target: 's' }));
  assert.equal(quiz(c).players.s.left, true, 'Sol is out of the quiz');
  assert.equal(quiz(c).players.s.score, 0, '…and keeps a score for the podium');
  assert.equal(c.party.players.s.left, false, '…but still in the evening');
  assert.equal(run(c, act({ t: 'retire', id: 'e', target: 's' })), c, 'twice: nothing more');
  const r = /** @type {any} */ (quiz(c).round);
  c = run(c, act({ t: 'answer', id: 'e', ...(r.asChoice ? { choice: 0 } : { text: 'x' }), now: 2, verdict: 'right' }));
  assert.equal(quiz(c).phase, 'reveal', 'the round no longer waits for Sol');
  c = run(c, act({ t: 'endGame', id: 'e' }));
  assert.equal(roundStatus(c), 'finished');
  assert.equal(run(c, act({ t: 'retire', id: 'e', target: 'e' })), c, 'on the podium: refused');
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

test('an injected round.finished event is refused: only the engine derives it (exactly once)', () => {
  const c = newCampaign(SAMPLE_CONTENT, 1);
  const injected = reduceCampaign(c, { t: 'event', event: { t: 'round.finished', kind: 'quiz', node: 'childhood.quiz', ranking: [], asked: ['q1'], endReason: 'done' } }, SAMPLE_CONTENT);
  assert.equal(injected, c);
});

test('the quiz result counts right answers per node (total and per character) for content conditions', () => {
  const C = SAMPLE_CONTENT;
  const c = newCampaign(C, 1);
  /** @type {QuizState} */
  const q = {
    .../** @type {QuizState} */ (startQuiz({ seed: 1, settings: {}, now: 0, players: [{ id: 'e', character: 'elodie' }], inputs: CANDIDATES })),
    phase: 'finished', endReason: 'done', order: ['e', 's'],
    players: {
      e: { id: 'e', character: 'elodie', name: 'Élodie', color: 1, score: 900, correct: 3, left: false },
      s: { id: 's', character: 'sol', name: 'Sol', color: 2, score: 400, correct: 2, left: false },
    },
  };
  const f = record(c.facts, { t: 'round.finished', kind: 'quiz', node: 'childhood.quiz', ...QUIZ_RULES.result(q, 'childhood.quiz') });
  assert.equal(f.counters[QUIZ_COUNTER.nodeCorrect('childhood.quiz')], 5);
  assert.equal(f.counters[QUIZ_COUNTER.nodeCorrectBy('childhood.quiz', 'elodie')], 3);
  assert.equal(f.counters[QUIZ_COUNTER.nodeCorrectBy('childhood.quiz', 'sol')], 2);
  assert.equal(f.counters[QUIZ_COUNTER.correctBy('elodie')], 3);
  assert.ok(holds({ count: QUIZ_COUNTER.nodeCorrect('childhood.quiz'), gte: 4 }, f), '"unlock X when the childhood quiz had ≥ 4 right"');
  assert.deepEqual(f.totals, { quiz: { elodie: 900, sol: 400 } });
});

test('loadCampaign migrates an older flat totals into totals.blocks', () => {
  const c = newCampaign(SAMPLE_CONTENT, 1);
  const old = JSON.parse(JSON.stringify({ ...c, facts: { ...c.facts, totals: { elodie: 120, sol: 80 } } }));
  assert.deepEqual(loadCampaign(old, SAMPLE_CONTENT).facts.totals, { blocks: { elodie: 120, sol: 80 } });
  const already = JSON.parse(JSON.stringify({ ...c, facts: { ...c.facts, totals: { blocks: { elodie: 1 }, quiz: { sol: 2 } } } }));
  assert.deepEqual(loadCampaign(already, SAMPLE_CONTENT).facts.totals, { blocks: { elodie: 1 }, quiz: { sol: 2 } });
});
