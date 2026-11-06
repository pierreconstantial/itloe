// The TV's avatar layer over a minigame's game area: whose avatars it draws, and the room's positions
// taken back at once after a round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarLayer } from '../public/screen/avatar-layer.js';
import { PARTY_ROOM, room } from '../shared/scene.js';

/** A stand-in minigame's game area: a scene without furniture. */
const AREA = room('stand-in-area', { x: 0.5, y: 0.5, w: 15, h: 8 }, []);
/** @type {import('../public/screen/avatar-layer.js').Roster} */
const PARTY = {
  order: ['p-anna', 'p-sol', 'p-pierre'],
  players: {
    'p-anna': { name: 'Anna', color: 1, character: 'anna' },
    'p-sol': { name: 'Sol', color: 2, character: 'sol' },
    'p-pierre': { name: 'Pierre', color: 3, character: 'pierre' },
  },
};
/** @param {string} playerId @param {number} x @param {number} y */
const pos = (playerId, x, y) => ({ t: 'pos', playerId, x, y, dir: 'down', moving: false });
/** @param {ReturnType<typeof createAvatarLayer>} layer @param {string} id */
const at = (layer, id) => {
  const a = layer.snapshot().find((s) => s.id === id);
  return a && [a.x, a.y];
};

test("a minigame's screen draws only the avatars of the players it names, on top of its game area", () => {
  const layer = createAvatarLayer();
  layer.setPlayers(PARTY, AREA);
  assert.deepEqual(layer.drawOrder(AREA, ['p-sol', 'p-anna']).sort(), ['p-anna', 'p-sol']);
  assert.deepEqual(layer.drawOrder(AREA, []), []);
  assert.deepEqual(layer.drawOrder(AREA).sort(), ['p-anna', 'p-pierre', 'p-sol']); // the rooms: everyone
});

test("after a round, the avatars stand at the room's positions at once instead of walking there", () => {
  const layer = createAvatarLayer();
  layer.setPlayers(PARTY, PARTY_ROOM);
  layer.onPos(pos('p-anna', 3, 2)); // where Anna walked in the game area
  layer.settle();
  layer.onPos(pos('p-anna', 10, 7)); // the room's position, sent again when the round ends
  layer.update(1 / 60);
  assert.notDeepEqual(at(layer, 'p-anna'), [10, 7]); // easing: still on the way
  layer.settle();
  assert.deepEqual(at(layer, 'p-anna'), [10, 7]);
  layer.update(1 / 60);
  assert.deepEqual(at(layer, 'p-anna'), [10, 7]); // and stays there
});

test('the campaign status still controls an avatar when a round roster omits statuses', () => {
  const layer = createAvatarLayer();
  layer.setPlayers(PARTY, PARTY_ROOM);
  layer.setStatuses({ 'p-anna': { statuses: [] }, 'p-sol': { statuses: ['wisp', 'charged'] },
    'p-pierre': { statuses: [] } });
  layer.setPlayers(PARTY, AREA);
  assert.deepEqual(layer.snapshot().find((a) => a.id === 'p-sol')?.statuses, ['wisp', 'charged']);
});

test('a quiet character starts its idle activity after ten seconds and stops on movement', () => {
  const layer = createAvatarLayer();
  layer.setPlayers(PARTY, PARTY_ROOM);
  /** @param {number} now */
  const idle = (now) => layer.snapshot(now).find((a) => a.id === 'p-anna')?.idle;
  const started = performance.now();
  assert.equal(idle(started + 9_900), false);
  assert.equal(idle(started + 10_100), true);
  layer.onPos(pos('p-anna', 10, 7));
  assert.equal(idle(performance.now()), false);
  layer.setOffline(new Set(['p-anna']));
  assert.equal(idle(performance.now() + 10_100), false);
});

test('jump animates the named character without changing its world position', () => {
  const layer = createAvatarLayer();
  layer.setPlayers(PARTY, PARTY_ROOM);
  const before = at(layer, 'p-anna');
  layer.onJump({ t: 'jump', playerId: 'p-anna' });
  assert.equal(layer.snapshot().find((a) => a.id === 'p-anna')?.jumping, true);
  assert.equal(layer.snapshot().find((a) => a.id === 'p-sol')?.jumping, false);
  assert.deepEqual(at(layer, 'p-anna'), before);
  assert.equal(layer.snapshot(performance.now() + 700).find((a) => a.id === 'p-anna')?.jumping, false);
});
