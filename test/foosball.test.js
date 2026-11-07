// Table football's round rules (shared/foosball.js): a player who leaves or is taken out, and a team that forfeits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOSBALL_DEFAULTS, FOOSBALL_RULES, holders } from '../shared/foosball.js';
import { minigame } from '../shared/minigames.js';

/** @typedef {import('../shared/foosball.js').FoosballState} FoosballState */

const CTX = { gameMasterId: 'p1' };
/** A plain lobby action on a running match, the match after it. @param {FoosballState} round @param {any} a @returns {FoosballState} */
const lobbyReduce = (round, a) => minigame('foosball')?.reduce({ stage: 'running', seed: 0, settings: {}, players: [], ready: [], holders: {}, round }, a, CTX).round;

test('taken out: the rods pass to the teammate; a team with nobody left loses, even ahead', () => {
  const players = /** @type {const} */ (['pierre', 'elodie', 'sol']).map((character, i) => ({ id: `p${i + 1}`, character }));
  let s = /** @type {FoosballState} */ (FOOSBALL_RULES.init({ seed: 1, settings: FOOSBALL_DEFAULTS, players, now: 0 }));
  assert.deepEqual([s.players.p1.team, s.players.p2.team, s.players.p3.team], ['a', 'b', 'a']);
  s = lobbyReduce(s, { t: 'retire', id: 'p1', target: 'p3' });
  assert.deepEqual([s.players.p3.retired, s.endReason], [true, null], 'team a plays on');
  assert.ok(holders(s).a.every((id) => id === 'p1'), 'p3\'s rods pass to p1');
  s = lobbyReduce(s, { t: 'goal', team: 'b', by: 'p2' });
  s = lobbyReduce(s, { t: 'goal', team: 'b', by: 'p2' });
  s = lobbyReduce(s, { t: 'goal', team: 'a', by: 'p1' });
  s = lobbyReduce(s, { t: 'leave', id: 'p2' });
  assert.equal(s.endReason, 'left', 'team b has nobody left: the match ends');
  const ranked = FOOSBALL_RULES.result(s, 'shelter').ranking.map(({ character, score, rank }) => [character, score, rank]);
  assert.deepEqual(ranked, [['pierre', 1, 1], ['sol', 1, 1], ['elodie', 2, 2]], 'team b led 2–1 and still loses');
});
