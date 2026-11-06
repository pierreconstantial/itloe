// A running round's in-memory side (server/round.ts), driven by a stand-in minigame whose server code
// lives in this file only: nothing test-only ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRound } from '../server/round.ts';

/** @typedef {{ t: 'tick' }} StandInAction */

/**
 * The stand-in's server code: `ping` sends an unsaved message to every phone and TV. Nothing is saved.
 * @type {Pick<import('../server/minigames.ts').MinigameServer<{}, StandInAction>, 'message'>}
 */
const STAND_IN = {
  message: (m, _ctx, io) => {
    if (m.t === 'ping') io.send({ t: 'ping' });
    return null;
  },
};

/** A round of the stand-in over fake transports. */
function harness() {
  /** @type {object[]} */ const all = [];
  /** @type {StandInAction[]} */ const applied = [];
  const round = makeRound({
    apply: (action) => { applied.push(action); return true; },
    sendAll: (msg) => all.push(msg),
  });
  /** @param {string} id @param {any} m */
  const message = (id, m) => STAND_IN.message(m, { id, now: 0, gameMasterId: null, state: {} }, round.io);
  return { round, all, applied, message };
}

test('a minigame sends an unsaved message that reaches every phone and TV', () => {
  const { all, message } = harness();
  message('p-anna', { t: 'ping' });
  assert.deepEqual(all, [{ t: 'unsaved', data: { t: 'ping' } }]);
});

test('once its round has ended, the io drops unsaved messages and actions', () => {
  const { round, all, applied, message } = harness();
  assert.equal(round.io.apply({ t: 'tick' }), true);
  const io = round.io; // kept by the server code, e.g. for a timer
  round.end();
  message('p-anna', { t: 'ping' });
  io.send({ t: 'ping' });
  assert.deepEqual(all, []);
  assert.equal(io.apply({ t: 'tick' }), false);
  assert.deepEqual(applied, [{ t: 'tick' }]);
});
