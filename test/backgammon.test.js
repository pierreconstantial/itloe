// Backgammon's round rules (shared/backgammon.js): a whole group phase played to its end, the clock, players
// who leave or are taken out, and the ranking; and in the main game, a restart and the view (server/backgammon.ts).
// Fixed seeds; the moves are picked from the ones the rules allow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGAMMON_RULES as R, CHECKERS, OFF, allowedSteps, other, reach, standings } from '../shared/backgammon.js';
import { minigame } from '../shared/minigames.js';
import { askedSoFar, loadCampaign, minigameStatus, newCampaign, reduceCampaign, startWaitsFor } from '../shared/campaign/index.js';
import { minigameContent } from '../shared/campaign/sample.js';
import { makeBackgammonServer } from '../server/backgammon.ts';
import { plainLobbyServer } from '../server/plain-lobby.ts';
import { shiftRound } from '../server/resume.ts';

/** @typedef {import('../shared/backgammon.js').BackgammonState} BackgammonState */
/** @typedef {import('../shared/backgammon.js').BackgammonAction} BackgammonAction */

const CTX = { gameMasterId: 'p1' };
const FOUR = /** @type {const} */ (['pierre', 'elodie', 'sol', 'anna']).map((character, i) => ({ id: `p${i + 1}`, character }));

/** @param {number} n @param {import("../shared/backgammon.js").BackgammonSettings} settings @param {number} [seed] @returns {BackgammonState} */
function start(n, settings, seed = 7) {
  const s = R.init({ seed, settings, players: FOUR.slice(0, n), now: 1000 });
  assert.ok(s);
  return s;
}
/** @param {BackgammonState} s @param {BackgammonAction} a */
const ok = (s, a) => {
  const next = R.reduce(s, a, CTX);
  assert.notEqual(next, s, `${JSON.stringify(a)}: accepted`);
  return next;
};
/** A plain lobby action on a running round (leave, retire), the round after it. @param {BackgammonState} round @param {any} a @returns {BackgammonState} */
const lobbyOk = (round, a) => {
  const next = minigame('backgammon')?.reduce({ stage: 'running', seed: 0, settings: {}, players: [], ready: [], holders: {}, round }, a, CTX).round;
  assert.notEqual(next, round, `${JSON.stringify(a)}: accepted`);
  return next;
};
/** @param {BackgammonState} s @param {BackgammonAction} a */
const refused = (s, a) => assert.equal(R.reduce(s, a, CTX), s, `${JSON.stringify(a)}: refused`);

/** A seeded pick. @param {number} seed */
const picker = (seed) => (/** @type {number} */ n) => Math.floor(((seed = (seed * 16807) % 2147483647) / 2147483647) * n);

/**
 * One turn of the first unfinished board, through its player's actions: roll if needed, then picked moves
 * the rules allow until none is left, then done; a game that ends needs no done.
 * @param {BackgammonState} s @param {(n: number) => number} pick
 */
function playTurn(s, pick) {
  const i = s.boards.findIndex((b) => !b.end);
  let b = s.boards[i];
  const id = b[b.turn];
  if (!b.dice) s = ok(s, { t: 'roll', id });
  for (;;) {
    b = s.boards[i];
    if (b.end) return s;
    const dice = /** @type {number[]} */ (b.dice);
    const steps = allowedSteps(b.c[b.turn], b.c[other(b.turn)], dice);
    if (steps.length === 0) return ok(s, { t: 'done', id });
    const from = steps[pick(steps.length)].from;
    const to = reach(b.c[b.turn], b.c[other(b.turn)], dice, from);
    s = ok(s, { t: 'move', id, from, to: to[pick(to.length)].to });
  }
}

test('four players play their group phase to the podium, the game master starting each round', () => {
  let s = start(4, { minutes: 0, games: 1 });
  const pick = picker(11);
  /** @type {number[]} */
  const rounds = [];
  while (R.status(s) === 'running') {
    if (s.phase === 'results') {
      refused(s, { t: 'nextRound', id: 'p2', now: 2 });
      s = ok(s, { t: 'nextRound', id: 'p1', now: 2 });
      continue;
    }
    if (rounds.at(-1) !== s.round) rounds.push(s.round);
    assert.equal(s.boards.length, 2, 'two boards in every round');
    s = playTurn(s, pick);
    for (const b of s.boards) for (const side of /** @type {const} */ (['a', 'b'])) {
      assert.equal(b.c[side].reduce((n, x) => n + x, 0), CHECKERS, 'no checker lost or made');
    }
  }
  assert.deepEqual(rounds, [1, 2, 3]);
  assert.equal(s.endReason, 'done');
  assert.equal(s.games.length, 6, 'every pair played once');
  for (const g of s.games) assert.ok(g.points === 1 || g.points === 2, 'every game won by bearing off');
  const result = R.result(s, 'node');
  assert.equal(result.ranking.length, 4);
  assert.equal(result.ranking.reduce((n, r) => n + r.score, 0), s.games.reduce((n, g) => n + g.points, 0));
});

test('time up: games are decided on the position at the start of the turn, by checkers off, then pips', () => {
  const s = start(2, { minutes: 5, games: 1 });
  assert.equal(R.deadline(s), 1000 + 5 * 60_000);
  const deadline = /** @type {number} */ (s.deadline);
  const mover = s.boards[0].turn;
  /** @param {Record<number, number>} at @returns {number[]} */
  const checkers = (at) => Array.from({ length: 26 }, (_, q) => at[q] ?? 0);
  /** The board with these checkers for the side to move and the other. @param {number[]} mine @param {number[]} theirs */
  const position = (mine, theirs) => /** @type {any} */ ({ [mover]: mine, [other(mover)]: theirs });
  /** @param {any} c @param {any[]} [undo] @returns {BackgammonState} */
  const at = (c, undo = []) => ({ ...s, boards: [{ ...s.boards[0], c, undo }] });

  refused(s, { t: 'timeUp', deadline: deadline - 1 });
  // level at the turn's start: the move made since doesn't count, it's a draw and nobody scores
  const level = position(checkers({ 24: 15 }), checkers({ 24: 15 }));
  let done = ok(at(position(checkers({ 24: 14, 20: 1 }), checkers({ 24: 15 })), [{ c: level, dice: [4, 2] }]), { t: 'timeUp', deadline });
  assert.deepEqual(done.boards[0].end, { winner: null, points: 0, how: 'draw' });
  assert.equal(done.phase, 'results');
  assert.deepEqual(standings(done).map((r) => r.points), [0, 0]);
  refused(done, { t: 'move', id: s.boards[0][mover], from: 24, to: 20 });
  // more checkers off wins, even with more pips, and never by a gammon
  done = ok(at(position(checkers({ [OFF]: 1, 6: 14 }), checkers({ 1: 15 }))), { t: 'timeUp', deadline });
  assert.deepEqual(done.boards[0].end, { winner: mover, points: 1, how: 'time' });
  // level on checkers off: fewer pips wins
  done = ok(at(position(checkers({ 24: 15 }), checkers({ 6: 15 }))), { t: 'timeUp', deadline });
  assert.equal(done.boards[0].end?.winner, other(mover));
});

test('a player who leaves or is taken out loses their games; fewer than two players ends the group phase', () => {
  let s = start(4, { minutes: 0, games: 1 });
  const p4board = s.boards.findIndex((b) => b.a === 'p4' || b.b === 'p4');
  s = lobbyOk(s, { t: 'leave', id: 'p4' });
  assert.equal(s.boards[p4board].end?.how, 'left', 'their game ends at once');
  const lost = s.games.filter((g) => g.a === 'p4' || g.b === 'p4');
  assert.equal(lost.length, 3, 'their game and both games still to play');
  assert.ok(lost.every((g) => g.winner !== 'p4' && g.points === 1));
  assert.equal(s.players.p4.left, true);
  assert.equal(R.status(s), 'running', 'three players carry on');
  s = lobbyOk(s, { t: 'retire', id: 'p1', target: 'p3' });
  s = lobbyOk(s, { t: 'retire', id: 'p1', target: 'p2' });
  assert.equal(R.status(s), 'finished');
  assert.equal(s.endReason, 'retired');

  // best of 3: the pair stops once one has won twice
  s = start(2, { minutes: 0, games: 3 });
  s = lobbyOk(s, { t: 'leave', id: 'p2' });
  assert.equal(s.games.length, 2);
  assert.equal(R.status(s), 'finished');
  assert.deepEqual(R.result(s, 'node').ranking.map((r) => [r.character, r.score, r.rank]), [['pierre', 2, 1], ['elodie', 0, 2]]);
});

test('the ranking: points, then points between the players level on points, then the pips their opponents had left', () => {
  const s = start(4, { minutes: 0, games: 1 });
  /** @param {string} a @param {string} b @param {string} winner @param {number} points @param {number} pips */
  const g = (a, b, winner, points, pips) => ({ a, b, winner, points, how: /** @type {const} */ ('won'), pips });
  const games = [g('p1', 'p2', 'p1', 1, 10), g('p1', 'p3', 'p1', 2, 30), g('p4', 'p1', 'p4', 1, 5),
    g('p2', 'p3', 'p3', 1, 20), g('p4', 'p2', 'p2', 1, 40), g('p3', 'p4', 'p3', 1, 8)];
  // p1 3 points, p3 2; p2 and p4 1 each, and p2 beat p4
  assert.deepEqual(standings({ ...s, games }).map((r) => [r.id, r.points, r.rank]),
    [['p1', 3, 1], ['p3', 2, 2], ['p2', 1, 3], ['p4', 1, 4]]);
  // level on points and between them: the bigger wins (pips left) rank higher
  const level = [g('p1', 'p2', 'p1', 1, 10), g('p2', 'p1', 'p2', 1, 50)];
  assert.deepEqual(standings({ ...s, games: level }).map((r) => [r.id, r.rank]), [['p2', 1], ['p1', 2], ['p3', 3], ['p4', 3]]);
});

test('a round takes 2 to 4 ready players: the lobby refuses another count, and Start says why', () => {
  const M = /** @type {import('../shared/minigames.js').MinigameRules<any, any>} */ (minigame('backgammon'));
  const five = [...FOUR, { id: 'p5', character: /** @type {const} */ ('nico') }];
  const lobby = M.open({ seed: 7, settings: M.settings({}), players: five, now: 1000 });
  const readyFor = (/** @type {number} */ n) => five.slice(0, n).reduce((s, p) => M.reduce(s, { t: 'ready', id: p.id, on: true }, CTX), lobby);
  const view = /** @type {import('../shared/minigames.js').MinigameView} */ (/** @type {unknown} */ ({ kind: 'backgammon', required: {} }));
  for (const n of [1, 5]) {
    const s = readyFor(n);
    assert.equal(M.reduce(s, { t: 'start', id: 'p1', now: 2000 }, CTX), s, `${n} ready: refused`);
    assert.deepEqual(startWaitsFor(view, s), { t: 'players', min: 2, max: 4, ready: n }, `${n} ready: Start says why`);
  }
  const two = readyFor(2);
  assert.equal(startWaitsFor(view, two), null);
  assert.equal(M.status(M.reduce(two, { t: 'start', id: 'p1', now: 2000 }, CTX)), 'running');
});

test('backgammon in the main game: a round survives a restart with its remaining time; the view hides the dice', () => {
  const CONTENT = /** @type {import('../shared/campaign/types.js').Content} */ (minigameContent('backgammon'));
  const SERVER = plainLobbyServer(makeBackgammonServer());
  /** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
  /** @param {Campaign} c @param {...any} actions @returns {Campaign} */
  const run = (c, ...actions) => actions.reduce((x, a) => reduceCampaign(x, a, CONTENT), c);
  /** A phone's message, through the server code, accepted. @param {Campaign} c @param {string} id @param {object} m @param {number} [now] */
  const send = (c, id, m, now = 1000) => {
    const reply = SERVER.message(m, { id, now, gameMasterId: 'p', state: /** @type {any} */ (c.at.activity), asked: askedSoFar(c) }, { apply: () => false, send: () => {} });
    const next = reply && 'action' in reply ? run(c, { t: 'activity', action: reply.action }) : c;
    assert.notEqual(next, c, `${id} ${JSON.stringify(m)}: accepted`);
    return next;
  };
  /** @param {Campaign} c @returns {BackgammonState} */
  const round = (c) => /** @type {any} */ (c.at.activity).round;
  /** A restart: the campaign through JSON and back. @param {Campaign} c */
  const restarted = (c) => loadCampaign(JSON.parse(JSON.stringify(c)), CONTENT);

  let c = run(newCampaign(CONTENT, 7), { t: 'join', id: 'p', character: 'pierre' }, { t: 'join', id: 'e', character: 'elodie' },
    { t: 'startMinigame', id: 'p', now: 1 });
  c = send(send(c, 'p', { t: 'ready', on: true }), 'e', { t: 'ready', on: true });
  c = send(c, 'p', { t: 'start' });
  // mid-turn: the opening roll on the board, a move made
  const b = round(c).boards[0];
  const dice = /** @type {number[]} */ (b.dice);
  const mine = b.c[b.turn], theirs = b.c[other(b.turn)];
  const from = allowedSteps(mine, theirs, dice)[0].from;
  c = send(c, b[b.turn], { t: 'move', from, to: reach(mine, theirs, dice, from)[0].to });
  assert.ok(round(c).rolls > 0 && round(c).boards[0].undo.length > 0);

  const { seed: _seed, rolls: _rolls, ...shown } = round(c);
  assert.deepEqual(/** @type {any} */ (SERVER.view(/** @type {any} */ (c.at.activity))).round, shown, 'the view: the round without what tells the next roll');

  const back = restarted(c);
  assert.deepEqual(back.at.activity, c.at.activity, 'a running round survives a restart, dice and all');

  // down for 3 minutes: the deadline moves by as much, and the old one is stale
  const deadline = /** @type {number} */ (round(c).deadline);
  assert.equal(deadline, 1000 + 8 * 60_000);
  const savedAt = 2000, downtime = 3 * 60_000;
  const shifted = shiftRound(/** @type {any} */ (back), savedAt, savedAt + downtime);
  assert.equal(round(shifted).deadline, deadline + downtime);
  assert.equal(run(shifted, { t: 'activity', action: { t: 'timeUp', deadline } }), shifted, 'the timer armed before the restart is refused');
  const timeUp = run(shifted, { t: 'activity', action: { t: 'timeUp', deadline: deadline + downtime } });
  assert.equal(round(timeUp).phase, 'results');

  c = send(timeUp, 'p', { t: 'endGame' });
  assert.equal(minigameStatus(c), 'podium');
  assert.deepEqual(restarted(c).at.activity, c.at.activity, 'the podium survives a restart');
});
