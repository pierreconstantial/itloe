// The plain lobby's server code (server/plain-lobby.ts): which err a phone's lobby message gets, derived as
// server/main.ts does (no reply: none; no action: its refusal; an action the engine leaves unchanged: its
// refusal). Runs through the campaign engine at the sample content's block tableau, with a stand-in for
// the round's server code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CONTENT, newCampaign, reduceCampaign } from '../shared/campaign/index.js';
import { plainLobbyServer } from '../server/plain-lobby.ts';

/** @typedef {import('../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../shared/campaign/types.js').CampaignAction} CampaignAction */

const SERVER = plainLobbyServer({ message: () => null, view: (s) => s });
const IO = { apply: () => false, send: () => {} };

/** @param {Campaign} c @param {CampaignAction[]} actions */
const run = (c, ...actions) => actions.reduce((x, a) => reduceCampaign(x, a, SAMPLE_CONTENT), c);
/** @param {any} action @returns {CampaignAction} */
const act = (action) => ({ t: 'activity', action });

/** The err code `m` from `id` gets (null: none). @param {Campaign} c @param {string} id @param {any} m */
function errOf(c, id, m) {
  const reply = SERVER.message(m, { id, now: 1, gameMasterId: 'p', state: /** @type {any} */ (c.at.activity), asked: [] }, IO);
  if (!reply) return null;
  if (!('action' in reply)) return reply.refused;
  return run(c, act(reply.action)) === c ? reply.refused ?? null : null;
}

/** Pierre (the game master), Élodie and Sol in the block game's lobby. */
const lobby = () => run(newCampaign(SAMPLE_CONTENT, 42),
  { t: 'join', id: 'p', character: 'pierre' }, { t: 'join', id: 'e', character: 'elodie' }, { t: 'join', id: 's', character: 'sol' },
  { t: 'startMinigame', id: 'p', now: 1 });
const ready = () => run(lobby(), act({ t: 'ready', id: 'e', on: true }), act({ t: 'ready', id: 's', on: true }));
const running = () => run(ready(), act({ t: 'start', id: 'p', now: 1 }));
const podium = () => run(running(), act({ t: 'endGame', id: 'p' }));

test('a guest gets not-gm for every game-master message, where the game master\'s would go through', () => {
  assert.equal(errOf(lobby(), 'e', { t: 'config', patch: { grace: 2 } }), 'not-gm');
  assert.equal(errOf(ready(), 'e', { t: 'start' }), 'not-gm');
  assert.equal(errOf(podium(), 'e', { t: 'lobby' }), 'not-gm');
  assert.equal(errOf(running(), 'e', { t: 'endGame' }), 'not-gm');
  assert.equal(errOf(running(), 'e', { t: 'retire', target: 's' }), 'not-gm');
});

test('the game master at the wrong moment gets refused (settings: locked outside the lobby)', () => {
  assert.equal(errOf(lobby(), 'p', { t: 'start' }), 'refused', 'nobody ready');
  assert.equal(errOf(podium(), 'p', { t: 'start' }), 'refused', 'start is for the lobby');
  assert.equal(errOf(lobby(), 'p', { t: 'lobby' }), 'refused', 'already in the lobby');
  assert.equal(errOf(podium(), 'p', { t: 'endGame' }), 'refused', 'no round running');
  assert.equal(errOf(podium(), 'p', { t: 'retire', target: 's' }), 'refused', 'no round running');
  assert.equal(errOf(podium(), 'p', { t: 'config', patch: { grace: 2 } }), 'locked');
});

test('a round\'s message outside a round gets not-playing; a take-out of an unknown player is silent', () => {
  assert.equal(errOf(lobby(), 'e', { t: 'place', piece: 0, x: 0, y: 0 }), 'not-playing');
  assert.equal(errOf(podium(), 'e', { t: 'place', piece: 0, x: 0, y: 0 }), 'not-playing');
  assert.equal(errOf(running(), 'p', { t: 'retire', target: 'p-nope' }), null);
});
