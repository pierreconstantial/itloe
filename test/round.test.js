// A running round's in-memory side (server/round.ts), driven by a stand-in minigame whose server code
// lives in this file only: nothing test-only ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRound } from '../server/round.ts';
import { makePositions } from '../server/pos.ts';

/** @typedef {import('../server/pos.ts').Pos} Pos */
/** @typedef {{ walkers: string[] }} StandInState */
/** @typedef {{ t: 'tick' }} StandInAction */

/**
 * The stand-in's server code: the players in `walkers` walk its game area; `fart` sends an unsaved
 * message placed at the sender's position. Nothing is saved.
 * @type {Pick<import('../server/minigames.ts').MinigameServer<StandInState, StandInAction>, 'walks' | 'message'>}
 */
const STAND_IN = {
  walks: (s, id) => s.walkers.includes(id),
  message: (m, ctx, io) => {
    const at = io.positions()[ctx.id];
    if (m.t === 'fart' && at) io.send({ t: 'fart', x: at.x, y: at.y });
    return null;
  },
};

/** @type {(x: number, y: number) => Pos} */
const at = (x, y) => ({ x, y, dir: 'down', moving: false });

/** A round of the stand-in, Anna walking and Bob not, over fake transports. */
function harness() {
  /** @type {object[]} */ const all = [];
  /** @type {[string, Pos][]} */ const relayed = [];
  /** @type {StandInAction[]} */ const applied = [];
  /** @type {StandInState} */ const state = { walkers: ['p-anna'] };
  const round = makeRound(STAND_IN, {
    state: () => state,
    apply: (action) => { applied.push(action); return true; },
    sendAll: (msg) => all.push(msg),
    relay: (id, pos) => relayed.push([id, pos]),
  });
  /** @param {string} id @param {any} m */
  const message = (id, m) => STAND_IN.message(m, { id, now: 0, hostId: null, state }, round.io);
  return { round, all, relayed, applied, message };
}

test('a minigame lets some players walk its game area and not others', () => {
  const { round, relayed } = harness();
  assert.equal(round.walk('p-anna', at(3, 4)), true);
  assert.equal(round.walk('p-bob', at(5, 5)), false);
  assert.deepEqual(relayed, [['p-anna', at(3, 4)]]); // the screens draw only Anna moving
  assert.deepEqual(round.io.positions(), { 'p-anna': at(3, 4) });
});

test('a minigame reads positions and sends an unsaved message that reaches every phone and TV', () => {
  const { round, all, message } = harness();
  round.walk('p-anna', at(3, 4));
  message('p-anna', { t: 'fart' });
  message('p-bob', { t: 'fart' }); // not walking: no position to place it at
  assert.deepEqual(all, [{ t: 'unsaved', data: { t: 'fart', x: 3, y: 4 } }]);
});

test("the room's positions are back after the round, which drops its own", () => {
  const room = makePositions();
  room.set('p-anna', at(10, 7));
  const { round } = harness();
  round.walk('p-anna', at(3, 4));
  round.end();
  assert.deepEqual(room.entries(), [['p-anna', at(10, 7)]]);
  assert.deepEqual(round.positions.entries(), []);
  assert.equal(round.walk('p-anna', at(1, 1)), false);
});

test('once its round has ended, the io drops unsaved messages and actions', () => {
  const { round, all, applied, message } = harness();
  round.walk('p-anna', at(3, 4));
  assert.equal(round.io.apply({ t: 'tick' }), true);
  const io = round.io; // kept by the server code, e.g. for a timer
  round.end();
  message('p-anna', { t: 'fart' });
  io.send({ t: 'fart', x: 3, y: 4 });
  assert.deepEqual(all, []);
  assert.equal(io.apply({ t: 'tick' }), false);
  assert.deepEqual(applied, [{ t: 'tick' }]);
});
