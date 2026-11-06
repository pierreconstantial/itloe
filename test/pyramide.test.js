// Pyramide (shared/pyramide.js, server/pyramide.ts) in the main game, in the plain lobby with spots: its
// players' messages go through its server code, as on the wire, and its words come from a small fixture
// bank. Fixed seeds: the words drawn are read from the state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { askedSoFar, loadCampaign, minigameStatus, newCampaign, reduceCampaign } from '../shared/campaign/index.js';
import { minigameContent } from '../shared/campaign/sample.js';
import { minigame } from '../shared/minigames.js';
import { ranking } from '../shared/ranking.js';
import { PYRAMIDE_RULES, clueProblem, ranked, teamRanks } from '../shared/pyramide.js';
import { makePyramideServer } from '../server/pyramide.ts';
import { plainLobbyServer } from '../server/plain-lobby.ts';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../shared/campaign/types.js').CampaignAction} CampaignAction */
/** @typedef {import('../shared/pyramide.js').PyramideState} PyramideState */

const CONTENT = /** @type {import('../shared/campaign/types.js').Content} */ (minigameContent('pyramide'));
const SERVER = plainLobbyServer(makePyramideServer(new URL('./fixtures/pyramide', import.meta.url).pathname));
const RULES = /** @type {import('../shared/minigames.js').MinigameRules<any, any>} */ (minigame('pyramide'));
const IO = { apply: () => false, send: () => {} };

/** @param {Campaign} c @param {...CampaignAction} actions */
const run = (c, ...actions) => actions.reduce((x, a) => reduceCampaign(x, a, CONTENT), c);
const act = (/** @type {any} */ action) => /** @type {CampaignAction} */ ({ t: 'activity', action });
/** The server stepping a player onto a spot, or off (null). @param {string} id @param {string | null} spot */
const step = (id, spot) => act({ t: 'spot', id, spot });

/** A phone's message, through the server code: the next campaign, the same one when refused. @param {Campaign} c @param {string} id @param {object} m */
function send(c, id, m) {
  const reply = SERVER.message(m, { id, now: 1, gameMasterId: 'p', state: /** @type {any} */ (c.at.activity), asked: askedSoFar(c) }, IO);
  return reply && 'action' in reply ? run(c, act(reply.action)) : c;
}
/** @param {Campaign} c @param {string} id @param {object} m */
const ok = (c, id, m) => {
  const next = send(c, id, m);
  assert.notEqual(next, c, `${id} ${JSON.stringify(m)}: accepted`);
  return next;
};
/** @param {Campaign} c @param {string} id @param {object} m @param {string} why */
const no = (c, id, m, why) => assert.equal(send(c, id, m), c, why);

/** The running round. @param {Campaign} c @returns {PyramideState} */
const round = (c) => /** @type {any} */ (c.at.activity).round;
/** The team whose turn it is. @param {Campaign} c */
const playing = (c) => round(c).teams[round(c).turn];
/** A restart: the campaign through JSON and back. @param {Campaign} c */
const restarted = (c) => loadCampaign(JSON.parse(JSON.stringify(c)), CONTENT);

/** Pierre (the game master), Élodie, Nico and Sol in Pyramide's lobby. */
const inLobby = () => run(newCampaign(CONTENT, 7),
  { t: 'join', id: 'p', character: 'pierre' }, { t: 'join', id: 'e', character: 'elodie' },
  { t: 'join', id: 'n', character: 'nico' }, { t: 'join', id: 's', character: 'sol' }, { t: 'startMinigame', id: 'p', now: 1 });
/** …on the spots: Élodie and Nico team 1, Pierre and Sol team 2, clue givers first. */
const seated = () => run(inLobby(), step('e', 'team1-clue'), step('n', 'team1-guess'), step('p', 'team2-clue'), step('s', 'team2-guess'));

test('pyramide lobby: holding a spot is being ready; four spots start a round; the teams stay after it', () => {
  let c = inLobby();
  const holders = () => Object.fromEntries(RULES.spots?.(c.at.activity)?.map((s) => [s.id, s.holder]) ?? []);
  assert.deepEqual(holders(), { 'team1-clue': null, 'team1-guess': null, 'team2-guess': null, 'team2-clue': null });
  no(c, 'e', { t: 'ready', on: true }, 'no "I\'m ready" in a lobby with spots');

  c = run(c, step('e', 'team1-clue'));
  assert.deepEqual(RULES.ready(c.at.activity), ['e']);
  assert.equal(run(c, step('n', 'team1-clue')), c, 'a held spot isn\'t taken');
  assert.equal(run(c, step('n', 'nowhere')), c, 'an unknown spot');
  c = run(c, step('e', 'team1-guess'));
  assert.deepEqual([holders()['team1-clue'], holders()['team1-guess']], [null, 'e'], 'from one spot onto another');
  c = run(c, step('e', null));
  assert.deepEqual(RULES.ready(c.at.activity), [], 'stepping off: not ready');

  c = run(c, step('e', 'team1-clue'), step('n', 'team1-guess'), step('p', 'team2-clue'));
  no(c, 'p', { t: 'start' }, 'three players can\'t start');
  c = run(c, step('s', 'team2-guess'));
  assert.deepEqual(RULES.ready(c.at.activity), ['p', 'e', 'n', 's'], 'the holders, in party order');
  assert.deepEqual(restarted(c).at.activity, c.at.activity, 'the spots survive a restart');
  no(c, 'e', { t: 'start' }, 'only the game master starts');
  c = ok(c, 'p', { t: 'start' });
  assert.equal(RULES.spots?.(c.at.activity), null, 'nobody walks during a round');
  assert.deepEqual(restarted(c).at.activity, c.at.activity, 'a running round survives a restart');
  const { pool: _pool, ...shown } = round(c);
  assert.deepEqual(/** @type {any} */ (SERVER.view(/** @type {any} */ (c.at.activity))).round, shown, 'the view: the round without the words still drawable');

  c = ok(c, 'p', { t: 'endGame' });
  assert.equal(minigameStatus(c), 'podium');
  assert.deepEqual(restarted(c).at.activity, c.at.activity, 'the podium survives a restart');
  c = ok(c, 'p', { t: 'lobby' });
  assert.deepEqual(RULES.ready(c.at.activity), ['p', 'e', 'n', 's'], 'back on the spots they left');
});

test('pyramide classic: skips, refused clues, turns, rotation, out of bricks, and the result', () => {
  let c = ok(seated(), 'p', { t: 'start' });
  const first = round(c);
  assert.deepEqual([first.mode, first.turn, first.step, first.teams[0].bricks, first.teams[0].word?.level], ['classic', 0, 'clue', 13, 'easy']);
  assert.deepEqual([first.teams[0].clue, first.teams[0].guess, first.teams[1].clue, first.teams[1].guess], ['e', 'n', 'p', 's']);

  // skips: before the first clue, another word of the level, no brick, the same roles; none left to spare: refused
  c = ok(c, 'e', { t: 'skip' });
  c = ok(c, 'p', { t: 'skip' });
  const skipped = round(c);
  assert.equal(skipped.drawn.length, 4, 'four easy words drawn, two of them skipped');
  assert.equal(new Set(skipped.drawn).size, 4);
  assert.deepEqual(skipped.log.map((l) => [l.team, l.t]), [[0, 'skipped'], [1, 'skipped']]);
  assert.deepEqual([skipped.teams[0].bricks, skipped.teams[0].clue, skipped.teams[0].word?.level], [13, 'e', 'easy']);
  no(c, 'e', { t: 'skip' }, 'the fixture has no easy word to spare');

  // clues: the clue giver whose turn it is, one word, not the word
  const word = /** @type {string} */ (playing(c).word?.word);
  no(c, 'n', { t: 'clue', text: 'indice' }, 'the guesser can\'t give a clue');
  no(c, 'p', { t: 'clue', text: 'indice' }, 'not team 2\'s turn');
  no(c, 'e', { t: 'clue', text: 'deux mots' }, 'one word only');
  no(c, 'e', { t: 'clue', text: `${word.toUpperCase()}S` }, 'contains the word');
  assert.equal(clueProblem('soleil', 'ensoleillé'), 'contains');
  assert.equal(clueProblem('boulangerie', 'Boulanger'), 'contains');
  assert.equal(clueProblem('parapluie', 'pluie'), 'contains', 'in the word, 4 letters or more');
  assert.equal(clueProblem('maison', 'son'), null, 'in the word, but shorter than 4 letters');
  assert.equal(clueProblem('camion', 'ami'), null);
  assert.equal(clueProblem('pluie', 'arc-en-ciel'), null);
  assert.equal(clueProblem('chat', "aujourd'hui"), null);
  c = ok(c, 'e', { t: 'clue', text: 'indice' });
  no(c, 'e', { t: 'skip' }, 'no skip after the first clue');

  // a guess: spelling mistakes aren't forgiven; then the other team's turn
  no(c, 'e', { t: 'guess', text: word }, 'the clue giver can\'t guess');
  c = ok(c, 'n', { t: 'guess', text: `${word.slice(0, -1)}x` });
  assert.deepEqual([round(c).turn, round(c).teams[0].bricks, round(c).teams[0].score], [1, 12, 0]);

  // found, with case, spaces and an article ignored: the team's next word, its roles swapped, the turn passes
  const theirs = /** @type {string} */ (playing(c).word?.word);
  c = ok(c, 'p', { t: 'clue', text: 'indice' });
  c = ok(c, 's', { t: 'guess', text: `  La ${theirs.toUpperCase()} ` });
  const found = round(c);
  assert.deepEqual([found.teams[1].score, found.teams[1].clue, found.teams[1].guess, found.teams[1].word?.level, found.turn],
    [1, 's', 'p', 'medium', 0]);
  assert.equal(found.log.at(-1)?.t, 'found');
  assert.deepEqual(found.log.slice(-3, -1).map((l) => 'id' in l && l.id), ['p', 's'], 'the log says who gave the clue and who guessed');

  // team 2 finds every word, team 1 never: team 2 finishes its four words, team 1 plays on alone and runs out
  while (round(c).endReason === null) {
    const r = round(c), t = playing(c);
    c = ok(c, t.clue, { t: 'clue', text: 'indice' });
    c = ok(c, t.guess, { t: 'guess', text: r.turn === 1 ? `le ${t.word?.word}` : 'rien' });
  }
  const end = round(c);
  assert.equal(minigameStatus(c), 'podium');
  assert.deepEqual(end.teams.map((t) => [t.score, t.used, t.bricks, t.done]), [[0, 13, 0, true], [4, 4, 9, true]]);
  assert.deepEqual([end.teams[0].clue, end.teams[0].word], ['e', null], 'team 1 never swapped, its last word lost');
  assert.equal(end.log.filter((l) => l.team === 0 && l.t === 'lost').length, 1);
  assert.equal(new Set(end.drawn).size, end.drawn.length, 'no word drawn twice');
  const result = RULES.result(c.at.activity, CONTENT.start);
  assert.deepEqual(result.ranking, [
    { character: 'pierre', score: 4, rank: 1 }, { character: 'sol', score: 4, rank: 1 },
    { character: 'elodie', score: 0, rank: 2 }, { character: 'nico', score: 0, rank: 2 },
  ]);
  assert.deepEqual([result.endReason, result.asked], ['done', end.drawn], 'every word drawn is used up, skipped ones too');

  // the tie-breaks: equal words, fewer bricks ranks first; equal bricks too, a draw sharing first place
  const tied = (/** @type {number} */ used0, /** @type {number} */ used1) => ({
    ...end, teams: /** @type {PyramideState['teams']} */ ([{ ...end.teams[0], score: 3, used: used0 }, { ...end.teams[1], score: 3, used: used1 }]),
  });
  assert.deepEqual(teamRanks(tied(10, 11)), [1, 2]);
  assert.deepEqual(teamRanks(tied(12, 11)), [2, 1]);
  assert.deepEqual(teamRanks(tied(11, 11)), [1, 1]);
  assert.deepEqual(PYRAMIDE_RULES.result(ranked(tied(11, 11)), CONTENT.start).ranking.map((r) => r.rank), [1, 1, 1, 1]);
  // the podium's rule reads the same ranks: equal words broken by bricks, each team's two players sharing theirs
  const podium = ranked(tied(10, 11));
  assert.deepEqual(ranking(podium).map((r) => [podium.players[r.id].team, r.rank]), [[0, 1], [0, 1], [1, 2], [1, 2]]);
  assert.deepEqual(PYRAMIDE_RULES.result(podium, CONTENT.start).ranking.map((r) => r.rank), [1, 1, 2, 2]);
});

test('pyramide duel: bidding, refused and out-of-turn bids, rotation, points, and the result', () => {
  let c = seated();
  no(c, 'e', { t: 'config', patch: { mode: 'duel' } }, 'only the game master picks the mode');
  c = ok(c, 'p', { t: 'config', patch: { mode: 'duel' } });
  c = ok(c, 'p', { t: 'start' });
  const r0 = round(c);
  assert.deepEqual([r0.mode, r0.step, r0.turn, r0.teams[0].word?.level], ['duel', 'bid', 0, 'medium']);
  assert.deepEqual(r0.teams[0].word, r0.teams[1].word, 'both clue givers see the same word');

  no(c, 'n', { t: 'bid', n: 3 }, 'a guesser doesn\'t bid');
  no(c, 'p', { t: 'bid', n: 3 }, 'team 2 bids after team 1');
  no(c, 'e', { t: 'pass' }, 'the opening bid can\'t pass');
  no(c, 'e', { t: 'bid', n: 11 }, 'at most 10');
  no(c, 'e', { t: 'bid', n: 0 }, 'at least 1');
  no(c, 'e', { t: 'skip' }, 'no skip in the duel');
  c = ok(c, 'e', { t: 'bid', n: 4 });
  no(c, 'p', { t: 'bid', n: 4 }, 'strictly lower');
  no(c, 'e', { t: 'bid', n: 3 }, 'team 1 waits for team 2');
  c = ok(c, 'p', { t: 'bid', n: 3 });
  c = ok(c, 'e', { t: 'pass' });
  assert.deepEqual([round(c).turn, round(c).step, round(c).teams[1].bricks], [1, 'clue', 3], 'the last bid plays');
  no(c, 'e', { t: 'clue', text: 'indice' }, 'only the playing team\'s clue giver');

  // word 1: team 2 spends its 3 bricks without finding it: a point for team 1, both teams' roles rotate
  for (let i = 0; i < 3; i++) {
    c = ok(c, 'p', { t: 'clue', text: 'indice' });
    c = ok(c, 's', { t: 'guess', text: 'rien' });
  }
  const r1 = round(c);
  assert.deepEqual([r1.teams[0].score, r1.teams[1].score, r1.index, r1.opening, r1.turn, r1.step], [1, 0, 1, 1, 1, 'bid']);
  assert.deepEqual([r1.teams[0].clue, r1.teams[0].guess, r1.teams[1].clue, r1.teams[1].guess], ['n', 'e', 's', 'p']);
  assert.equal(r1.log.at(-1)?.t, 'lost');

  // word 2: a bid of 1 ends the bidding at once; found: a point for team 2
  c = ok(c, 's', { t: 'bid', n: 1 });
  assert.deepEqual([round(c).turn, round(c).step, round(c).teams[1].bricks], [1, 'clue', 1]);
  c = ok(c, 's', { t: 'clue', text: 'indice' });
  c = ok(c, 'p', { t: 'guess', text: /** @type {string} */ (playing(c).word?.word) });

  // words 3 and 4: the opening team bids 1 and finds it; word 5: team 1 bids 2, team 2 passes, team 1 misses
  for (let i = 0; i < 2; i++) {
    c = ok(c, playing(c).clue, { t: 'bid', n: 1 });
    c = ok(c, playing(c).clue, { t: 'clue', text: 'indice' });
    c = ok(c, playing(c).guess, { t: 'guess', text: /** @type {string} */ (playing(c).word?.word) });
  }
  assert.deepEqual([round(c).index, round(c).opening, round(c).teams.map((t) => t.score)], [4, 0, [2, 2]]);
  c = ok(c, playing(c).clue, { t: 'bid', n: 2 });
  c = ok(c, playing(c).clue, { t: 'pass' });
  for (let i = 0; i < 2; i++) {
    c = ok(c, playing(c).clue, { t: 'clue', text: 'indice' });
    c = ok(c, playing(c).guess, { t: 'guess', text: 'rien' });
  }
  const end = round(c);
  assert.equal(minigameStatus(c), 'podium');
  assert.deepEqual([end.teams[0].score, end.teams[1].score, end.drawn.length, new Set(end.drawn).size], [2, 3, 5, 5]);
  assert.deepEqual(RULES.result(c.at.activity, CONTENT.start).ranking.map((r) => [r.character, r.score, r.rank]),
    [['pierre', 3, 1], ['sol', 3, 1], ['elodie', 2, 2], ['nico', 2, 2]]);
  const even = { ...end, teams: /** @type {PyramideState['teams']} */ ([{ ...end.teams[0], score: 3, used: 2 }, { ...end.teams[1], score: 3, used: 9 }]) };
  assert.deepEqual(teamRanks(even), [1, 1], 'equal points: a draw, whatever the bricks');
});

test('pyramide: a player taken out or leaving ends the round with the scores so far; the others keep their spots', () => {
  let c = ok(seated(), 'p', { t: 'start' });
  c = ok(c, 'e', { t: 'clue', text: 'indice' });
  c = ok(c, 'n', { t: 'guess', text: /** @type {string} */ (playing(c).word?.word) });
  no(c, 'e', { t: 'retire', target: 'n' }, 'only the game master takes a player out');
  c = ok(c, 'p', { t: 'retire', target: 'n' });
  assert.equal(minigameStatus(c), 'podium');
  assert.deepEqual([round(c).endReason, round(c).players.n.retired, round(c).teams[0].score], ['retired', true, 1]);
  c = ok(c, 'p', { t: 'lobby' });
  assert.deepEqual(RULES.ready(c.at.activity), ['p', 'e', 's'], 'taken out: off their spot');

  c = ok(run(c, step('n', 'team1-guess')), 'p', { t: 'start' });
  c = run(c, { t: 'leave', id: 's' });
  assert.equal(minigameStatus(c), 'podium');
  assert.equal(round(c).endReason, 'left');
  c = ok(c, 'p', { t: 'lobby' });
  assert.deepEqual(RULES.ready(c.at.activity), ['p', 'e', 'n'], 'gone from the evening: off their spot');
});

test('pyramide: a word is never drawn twice in an evening, across rounds; a mode the words left can\'t fill doesn\'t start', () => {
  let c = ok(seated(), 'p', { t: 'start' });
  c = ok(c, 'e', { t: 'skip' });
  c = ok(c, 'p', { t: 'skip' });
  const used = [...round(c).drawn];
  c = ok(ok(c, 'p', { t: 'endGame' }), 'p', { t: 'lobby' });
  no(c, 'p', { t: 'start' }, 'every easy word is used up: no classic round');

  c = ok(ok(c, 'p', { t: 'config', patch: { mode: 'duel' } }), 'p', { t: 'start' });
  used.push(...round(c).drawn);
  c = ok(ok(c, 'p', { t: 'endGame' }), 'p', { t: 'lobby' });
  c = ok(c, 'p', { t: 'start' });
  const next = round(c).drawn;
  assert.equal(next.length, 1);
  assert.ok(!used.includes(next[0]), 'not a word from an earlier round');
  assert.equal(new Set(used).size, used.length);
});
