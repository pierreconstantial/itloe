// A running round's in-memory side (server/round.ts), driven by a stand-in minigame whose server code
// lives in this file only: nothing test-only ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRound } from '../server/round.ts';

/** @typedef {{ t: 'tick' }} StandInAction */

/** The stand-in's server code: `fart` becomes an unsaved message; nothing is saved. */
const STAND_IN = {
  /** @param {any} m @param {{ id: string }} ctx @param {import('../server/minigames.ts').MinigameIo<StandInAction>} io */
  message: (m, ctx, io) => {
    if (m.t === 'fart') io.send({ t: 'fart', by: ctx.id });
    return null;
  },
};

/** A round over fake transports: what every phone and TV receives, and the actions the campaign got. */
function harness() {
  /** @type {object[]} */ const all = [];
  /** @type {StandInAction[]} */ const applied = [];
  const round = makeRound({
    apply: (/** @type {StandInAction} */ action) => { applied.push(action); return true; },
    sendAll: (msg) => all.push(msg),
  });
  return { round, all, applied };
}

test('an unsaved message from a minigame reaches every phone and TV during its round', () => {
  const { round, all } = harness();
  STAND_IN.message({ t: 'fart' }, { id: 'p-a' }, round.io);
  assert.deepEqual(all, [{ t: 'unsaved', data: { t: 'fart', by: 'p-a' } }]);
});

test('once its round has ended, the io drops unsaved messages and actions', () => {
  const { round, all, applied } = harness();
  assert.equal(round.io.apply({ t: 'tick' }), true);
  round.end();
  STAND_IN.message({ t: 'fart' }, { id: 'p-a' }, round.io); // e.g. from a timer the server code left running
  assert.deepEqual(all, []);
  assert.equal(round.io.apply({ t: 'tick' }), false);
  assert.deepEqual(applied, [{ t: 'tick' }]);
});
