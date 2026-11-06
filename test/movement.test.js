// Contract G — the phone's own movement: public/play/movement.js integrated against a Scene.
// shared/scene.js has its own tests (test/scene.test.js) for the geometry; these cover what the
// phone adds on top of it: that a step is resolved rather than merely clamped, that the walk cycle
// keeps running against a wall, and the stick and facing behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAP_IN, SNAP_OUT, facing, posFromEcho, snapTo, step, stickVector } from '../public/play/movement.js';
import { FEET, PARTY_ROOM, isWalkable, prop, room } from '../shared/scene.js';
import { WALK_SPEED, WORLD, spawnPoint } from '../shared/world.js';
import { CHARACTERS } from '../shared/characters.js';
import { SAMPLE_CONTENT } from '../shared/campaign/index.js';

/** @typedef {import('../shared/scene.js').Scene} Scene */
/** @typedef {import('../public/play/movement.js').Pos} Pos */

/** A bare room with one solid block in the middle: floor 1..15 × 5..8, block x 7..9, y 6..7. */
const boxRoom = () => room('t', { x: 1, y: 5, w: 14, h: 3 }, [
  prop('block', { x: 7, y: 6, w: 2, h: 1 }, { solid: { x: 7, y: 6, w: 2, h: 1 } }),
]);

/** An empty room, to check the no-obstacle path is still plain integration. */
const openRoom = () => room('o', { x: 0.5, y: 4.8, w: 15, h: 4 }, []);

/** @type {(x: number, y: number, dir?: import('../shared/world.js').Dir) => Pos} */
const at = (x, y, dir = 'down') => ({ x, y, dir, moving: false });

/** One second of walking at full speed, as a distance in world units. */
const UNIT_SECOND = WALK_SPEED;

test('step: free floor → plain integration, unchanged by collision', () => {
  const s = openRoom();
  const p = step(at(8, 7), 1, 0, 0.5, s);
  assert.equal(p.x, 8 + UNIT_SECOND * 0.5, 'x advanced by speed × dt');
  assert.equal(p.y, 7, 'y untouched');
  assert.equal(p.moving, true);
  assert.equal(p.dir, 'right');
});

test('step: walking into a solid stops at it and never crosses it', () => {
  const s = boxRoom(); // block x 7..9
  let p = at(6, 6.5, 'right');
  for (let i = 0; i < 120; i++) p = step(p, 1, 0, 1 / 60, s); // two seconds of pushing right
  assert.ok(isWalkable(s, p.x, p.y), 'ended somewhere it can legally stand');
  assert.ok(p.x <= 7 - FEET.w / 2 + 1e-9, `stopped at the block's left face (x=${p.x})`);
  assert.ok(p.x > 6.5, 'and it did walk up to it rather than not moving at all');
});

test('step: a blocked push keeps moving true — the walk cycle runs on the spot', () => {
  const s = boxRoom();
  // flush against the block's left face, then keep pushing into it
  let p = at(7 - FEET.w / 2, 6.5, 'right');
  const before = { x: p.x, y: p.y };
  p = step(p, 1, 0, 1 / 60, s);
  assert.equal(p.x, before.x, 'the position did not budge');
  assert.equal(p.y, before.y);
  assert.equal(p.moving, true, 'but the avatar is still walking (Zelda rule)');
  assert.equal(p.dir, 'right', 'and still facing the wall it is pushing against');
});

test('step: releasing the stick clears moving even while blocked', () => {
  const s = boxRoom();
  const p = step(at(7 - FEET.w / 2, 6.5, 'right'), 0, 0, 1 / 60, s);
  assert.equal(p.moving, false, 'no push → not moving');
  assert.equal(p.dir, 'right', 'facing is kept when the stick is idle');
});

test('step: a diagonal push into a wall slides along it instead of sticking', () => {
  const s = boxRoom(); // block x 7..9, y 6..7
  // Flush against the block's left face, pushing down-right. While the feet box still overlaps the
  // block's y span (y < 7 + FEET.h) the x component has nowhere to go, so only y may advance.
  const face = 7 - FEET.w / 2;
  let p = at(face, 6.5, 'right');
  const one = step(p, 1, 1, 1 / 60, s);
  assert.equal(one.x, face, 'one frame: x is dropped…');
  assert.ok(one.y > 6.5, '…and y goes through');

  p = at(face, 6.5, 'right');
  for (let i = 0; i < 10; i++) p = step(p, 1, 1, 1 / 60, s); // 10/60 s × 4 u/s = 0.67 u of slide
  assert.ok(p.y < 7 + FEET.h, 'precondition: still beside the block, not past its corner');
  assert.equal(p.x, face, 'x stayed blocked by the block for the whole slide');
  assert.ok(p.y > 6.5 + 0.5, `y slid down along its face (6.5 → ${p.y})`);
  assert.ok(isWalkable(s, p.x, p.y));
});

test('step: once past a solid\'s corner, the held direction is free again', () => {
  const s = boxRoom(); // block x 7..9, y 6..7
  // the same down-right push, held long enough to clear the block's bottom edge: x resumes
  let p = at(7 - FEET.w / 2, 6.5, 'right');
  for (let i = 0; i < 40; i++) p = step(p, 1, 1, 1 / 60, s);
  assert.ok(p.y >= 7 + FEET.h, 'cleared the block');
  assert.ok(p.x > 7 - FEET.w / 2, `and walked on past it (x=${p.x})`);
  assert.ok(isWalkable(s, p.x, p.y));
});

test('step: sliding works along the room walls too (same code path)', () => {
  const s = openRoom(); // floor y 4.8..8.8
  // pushing up-right against the back wall: y is blocked, x keeps going
  let p = at(8, 4.8, 'up');
  const x0 = p.x;
  for (let i = 0; i < 30; i++) p = step(p, 1, -1, 1 / 60, s);
  assert.ok(p.y >= 4.8 - 1e-9, 'y did not climb through the back wall');
  assert.ok(p.x > x0 + 0.1, `x slid along it (${x0} → ${p.x})`);
});

test('step: a huge dt cannot tunnel through a solid', () => {
  const s = boxRoom();
  // one absurd step (a stalled tab catching up) straight at the block from its left
  const p = step(at(6, 6.5, 'right'), 1, 0, 10, s);
  assert.ok(isWalkable(s, p.x, p.y), 'ends on floor it can stand on');
  assert.ok(p.x < 7, 'never came out the far side of the block');
});

test('step: stays inside the world without a separate clamp', () => {
  const s = openRoom();
  let p = at(15.5, 8.8, 'right');
  for (let i = 0; i < 120; i++) p = step(p, 1, 1, 1 / 60, s);
  assert.ok(p.x <= WORLD.w && p.y <= WORLD.h, 'inside the world box');
  assert.ok(isWalkable(s, p.x, p.y), 'and on walkable floor');
});

test('step: a position inside a prop can always walk back out (never stuck)', () => {
  const s = boxRoom();
  // the server echoes a position that predates the block: dead centre of it
  let p = at(8, 6.5, 'down');
  assert.equal(isWalkable(s, p.x, p.y), false, 'precondition: standing inside the solid');
  for (let i = 0; i < 120; i++) p = step(p, 0, 1, 1 / 60, s); // push towards the open floor
  assert.ok(p.y > 7, `walked out of the block (y=${p.y})`);
  assert.ok(isWalkable(s, p.x, p.y), 'and ended on legal floor');
});

test('step: the party room lets every character walk off its spawn', () => {
  for (const id of Object.keys(CHARACTERS)) {
    const sp = spawnPoint(/** @type {any} */ (id));
    assert.equal(isWalkable(PARTY_ROOM, sp.x, sp.y), true, `${id} spawns on walkable floor`);
    let p = at(sp.x, sp.y, 'up');
    for (let i = 0; i < 30; i++) p = step(p, 0, -1, 1 / 60, PARTY_ROOM);
    assert.ok(p.y < sp.y, `${id} can walk away from its spawn (${sp.y} → ${p.y})`);
  }
});

test('the hub doors stay walkable: every rug holds floor reachable from a spawn', () => {
  // The doors are server-side edge triggers over the `pos` the phone sends (server/main.ts), so the
  // phone must be able to put its feet inside each rug. A flood fill from a spawn over the walkable
  // grid proves the props did not fence one off — the check that matters once furniture can move.
  const G = 0.05;
  const key = (/** @type {number} */ x, /** @type {number} */ y) => `${Math.round(x / G)},${Math.round(y / G)}`;
  const start = spawnPoint('pierre');
  const seen = new Set([key(start.x, start.y)]);
  /** @type {[number, number][]} */
  const queue = [[start.x, start.y]];
  while (queue.length) {
    const [x, y] = /** @type {[number, number]} */ (queue.pop());
    for (const [dx, dy] of [[G, 0], [-G, 0], [0, G], [0, -G]]) {
      const nx = x + dx, ny = y + dy;
      if (!isWalkable(PARTY_ROOM, nx, ny)) continue;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  const doors = Object.entries(SAMPLE_CONTENT.nodes).filter(([, n]) => !!n.door);
  assert.ok(doors.length >= 8, `the sample content has doors to check (${doors.length})`);
  for (const [id, node] of doors) {
    const d = /** @type {{ x: number, y: number, w: number, h: number }} */ (node.door);
    let reachable = 0;
    for (let x = d.x; x <= d.x + d.w; x += G) {
      for (let y = d.y; y <= d.y + d.h; y += G) {
        if (isWalkable(PARTY_ROOM, x, y) && seen.has(key(x, y))) reachable++;
      }
    }
    assert.ok(reachable > 0, `door ${id} can still be walked into (${reachable} reachable cells)`);
  }
});

// ---- unchanged by Contract G: the stick, the facing, the wire form ----

test('stickVector: dead zone, rescaling and clamping', () => {
  assert.deepEqual(stickVector(0, 0, 56), { vx: 0, vy: 0 }, 'centre');
  assert.deepEqual(stickVector(5, 0, 56), { vx: 0, vy: 0 }, 'inside the dead zone');
  const far = stickVector(560, 0, 56);
  assert.ok(Math.abs(far.vx - 1) < 1e-9 && far.vy === 0, 'past the rim → full speed, clamped to 1');
  const diag = stickVector(56, 56, 56);
  assert.ok(Math.hypot(diag.vx, diag.vy) <= 1 + 1e-9, 'a diagonal is never faster than an axis');
});

test('facing: dominant axis with hysteresis, kept when idle', () => {
  assert.equal(facing(0, 0, 'left'), 'left', 'idle keeps the facing');
  assert.equal(facing(1, 0, 'down'), 'right');
  assert.equal(facing(0, 1, 'right'), 'down');
  // already facing right, pushed slightly more up than right: hysteresis keeps it horizontal
  assert.equal(facing(0.9, -1, 'right'), 'right', 'no flicker on a near-diagonal');
  assert.equal(facing(0.2, -1, 'right'), 'up', 'a clearly dominant axis still wins');
});

test('posFromEcho only clamps: a position inside a prop is kept, not teleported', () => {
  // It must not resolve against a scene — the phone may legitimately be sent a position that a new
  // prop now covers, and step() is what walks it back out.
  const echoed = posFromEcho({ x: 11, y: 7, dir: 'down' });
  assert.deepEqual(echoed, { x: 11, y: 7, dir: 'down', moving: false });
  assert.equal(isWalkable(PARTY_ROOM, 11, 7), false, 'that spot is inside the table');
});

test('snapping: near a free spot\'s centre the character stands on it, and walks off only past a wider radius', () => {
  const centre = { x: 8, y: 7 };
  /** @type {{ x: number, y: number } | null} */ let held = null;
  const walk = (/** @type {number} */ x) => (held = snapTo({ x, y: 7 }, held, [centre]));
  assert.equal(walk(8 - SNAP_IN - 0.05), null, 'not close enough yet');
  assert.equal(walk(8 - SNAP_IN + 0.05), centre, 'close: on the centre');
  assert.equal(walk(8 + SNAP_IN + 0.05), centre, 'past the snapping radius, still held: no flicker at its edge');
  assert.equal(walk(8 + SNAP_OUT + 0.05), null, 'pushed past the wider radius: free again');
  assert.equal(walk(8 + SNAP_IN + 0.05), null, 'and coming back within it doesn\'t snap until the snapping radius');
});
