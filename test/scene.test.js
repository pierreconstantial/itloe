// Contract G — scene geometry (shared/scene.js) and the TV's draw order (public/screen/scene-render.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEET, PARTY_ROOM, blocked, feetBox, isWalkable, prop, resolve, room, spawnAt, wallsAround,
} from '../shared/scene.js';
import { WORLD, spawnPoint } from '../shared/world.js';
import { CHARACTERS } from '../shared/characters.js';
import { childrenOf, SAMPLE_CONTENT } from '../shared/campaign/index.js';
import { buildDrawList, drawOrder } from '../public/screen/scene-render.js';
import { PROP_PIXELS } from '../public/screen/party-room.js';

/** @typedef {import('../shared/scene.js').Scene} Scene */

/** A bare room: floor 1..15 × 5..8, one solid block in the middle. @returns {Scene} */
const boxRoom = () => room('t', { x: 1, y: 5, w: 14, h: 3 }, [
  prop('block', { x: 7, y: 6, w: 2, h: 1 }, { solid: { x: 7, y: 6, w: 2, h: 1 } }),
]);

test('scene: feetBox is centred on x with its bottom on y; blocked() ignores touching edges', () => {
  const b = feetBox(8, 7);
  assert.deepEqual(b, { x: 8 - FEET.w / 2, y: 7 - FEET.h, w: FEET.w, h: FEET.h });
  const s = boxRoom();
  assert.equal(blocked(s, { x: 7.5, y: 6.5, w: 0.1, h: 0.1 }), true, 'inside the block');
  assert.equal(blocked(s, { x: 5, y: 6, w: 2, h: 1 }), false, 'left edge touching the block is not a hit');
  assert.equal(blocked(s, { x: 5, y: 6, w: 2.01, h: 1 }), true, 'one hair of overlap is');
});

test('scene: isWalkable is false inside a solid, outside the floor and on non-finite input', () => {
  const s = boxRoom();
  assert.equal(isWalkable(s, 3, 7), true);
  assert.equal(isWalkable(s, 8, 7), false, 'standing in the block');
  assert.equal(isWalkable(s, 8, 4), false, 'above the floor (back wall)');
  assert.equal(isWalkable(s, 8, 8.5), false, 'past the front edge');
  assert.equal(isWalkable(s, 0.2, 7), false, 'half out of the left wall');
  assert.equal(isWalkable(s, NaN, 7), false);
});

test('resolve: a diagonal push into a wall slides along it instead of sticking', () => {
  const s = boxRoom();
  // walking down-right into the front wall (floor stops at y = 8): x keeps going, y stops
  const r = resolve(s, { x: 4, y: 8 }, { x: 4.1, y: 8.1 });
  assert.equal(r.x, 4.1, 'the x component went through');
  assert.equal(r.y, 8, 'the y component was dropped');
  // the mirror case against the left wall: y slides, x stops
  const l = resolve(s, { x: 1, y: 7 }, { x: 0.9, y: 7.1 });
  assert.equal(l.x, 1);
  assert.equal(l.y, 7.1);
});

test('resolve: never crosses a solid, however big the step (no tunnelling)', () => {
  const s = boxRoom(); // block x 7..9, y 6..7
  const r = resolve(s, { x: 6, y: 6.5 }, { x: 10, y: 6.5 }); // one huge step straight through it
  assert.ok(isWalkable(s, r.x, r.y), 'it ends on free floor…');
  assert.ok(r.x <= 7 - FEET.w / 2 + 1e-9, '…stopped at the block, not teleported past it');
  assert.ok(r.x > 6, 'and it did walk up to it');
});

test('resolve: rounds a prop corner instead of snagging on it', () => {
  const s = boxRoom(); // block x 7..9, y 6..7
  // walking right just below the block: the feet box clips its bottom-left corner by a few cm
  const snag = { x: 6.68, y: 7.3 };
  assert.ok(isWalkable(s, snag.x, snag.y), 'the start is free');
  assert.ok(!isWalkable(s, snag.x + 0.1, snag.y), 'the plain move is blocked by the corner');
  const r = resolve(s, snag, { x: snag.x + 0.1, y: snag.y });
  assert.equal(r.x, snag.x + 0.1, 'it goes through…');
  assert.ok(r.y > snag.y, '…by slipping a little way round the corner');
  assert.ok(r.y - snag.y <= 0.25, 'and never more than the corner tolerance');
  assert.ok(isWalkable(s, r.x, r.y));
});

test('resolve: a straight push into a flat wall does not slip sideways', () => {
  const s = boxRoom();
  const r = resolve(s, { x: 8, y: 7.6 }, { x: 8, y: 7.3 }); // walking up into the middle of the block
  assert.deepEqual(r, { x: 8, y: 7.6 }, 'blocked and still: only the position stops, the caller keeps walking');
});

test('resolve: starting inside a solid is not a trap, and bad input is ignored', () => {
  const s = boxRoom();
  const out = resolve(s, { x: 8, y: 6.9 }, { x: 8, y: 7.4 }); // pushed out of the block
  assert.deepEqual(out, { x: 8, y: 7.4 });
  assert.deepEqual(resolve(s, { x: 4, y: 7 }, { x: NaN, y: 7 }), { x: 4, y: 7 });
  const far = resolve(s, { x: 4, y: 7 }, { x: 99, y: 7 }); // clamped to the world, then to the wall
  assert.ok(far.x <= WORLD.w);
});

test('party room: every character spawns on walkable floor, and the spawn point is kept when it is free', () => {
  for (const id of Object.keys(CHARACTERS)) {
    const s = spawnAt(PARTY_ROOM, /** @type {any} */ (id));
    assert.ok(isWalkable(PARTY_ROOM, s.x, s.y), `${id} spawns on floor`);
    assert.deepEqual(s, spawnPoint(/** @type {any} */ (id)), `${id} keeps the shared spawn point`);
  }
  assert.ok(isWalkable(PARTY_ROOM, spawnAt(PARTY_ROOM, null).x, spawnAt(PARTY_ROOM, null).y), 'the no-character fallback too');
});

test('spawnAt: nudges out of a prop onto the nearest floor', () => {
  // a room whose sofa sits exactly on pierre's spawn point (3, 7)
  const s = room('t', { x: 0.5, y: 4.8, w: 15, h: 4 }, [
    prop('sofa', { x: 2, y: 6, w: 2, h: 2 }, { solid: { x: 2, y: 6, w: 2, h: 2 } }),
  ]);
  assert.equal(isWalkable(s, 3, 7), false, 'the raw spawn point is inside the sofa');
  const p = spawnAt(s, 'pierre');
  assert.ok(isWalkable(s, p.x, p.y), 'nudged onto floor');
  assert.equal(p.dir, 'down', 'still facing the camera');
  assert.ok(Math.hypot(p.x - 3, p.y - 7) <= 2, 'and not far from where it should have been');
});

test('party room: the campaign doors stay enterable — every door rect has walkable floor in it', () => {
  const doors = childrenOf(SAMPLE_CONTENT, 'hub').filter((n) => n.door);
  assert.ok(doors.length >= 3, 'the hub has doors to check');
  for (const n of Object.values(SAMPLE_CONTENT.nodes)) {
    const d = n.door;
    if (!d) continue;
    let reachable = 0;
    for (let x = d.x + 0.1; x <= d.x + d.w - 0.1; x += 0.1) {
      for (let y = d.y + 0.05; y <= d.y + d.h - 0.05; y += 0.05) {
        if (isWalkable(PARTY_ROOM, x, y)) reachable++;
      }
    }
    assert.ok(reachable > 0, `${n.id}: its trigger zone can be stood in`);
  }
});

test('party room: props are clear of the door rugs, and their solid is smaller than their art', () => {
  for (const p of PARTY_ROOM.props) {
    assert.ok(p.solid, `${p.id} is solid`);
    const s = /** @type {import('../shared/scene.js').Rect} */ (p.solid);
    assert.equal(s.y + s.h, p.anchorY, `${p.id}: its base sits on its baseline`);
    assert.ok(s.w <= p.box.w && s.h <= p.box.h, `${p.id}: the collider is no bigger than the art`);
    for (const n of Object.values(SAMPLE_CONTENT.nodes)) {
      const d = n.door;
      if (!d) continue;
      const clear = s.x >= d.x + d.w || s.x + s.w <= d.x || s.y >= d.y + d.h || s.y + s.h <= d.y;
      assert.ok(clear, `${p.id} does not stand on the ${n.id} rug`);
    }
  }
});

test('wallsAround: the feet box is held inside the floor rect, and nowhere else', () => {
  const floor = { x: 2, y: 3, w: 5, h: 4 };
  const s = { id: 't', floor, solids: wallsAround(floor), props: [] };
  assert.ok(isWalkable(s, floor.x, floor.y), 'the top-left corner of the floor is walkable');
  assert.ok(isWalkable(s, floor.x + floor.w, floor.y + floor.h), 'and the bottom-right one');
  assert.ok(!isWalkable(s, floor.x - 0.01, floor.y), 'a hair past the left edge is not');
  assert.ok(!isWalkable(s, floor.x, floor.y - 0.01), 'nor past the back wall');
  assert.ok(!isWalkable(s, floor.x, floor.y + floor.h + 0.01), 'nor past the front edge');
});

test('draw order: props and actors interleave by baseline, back and front layers never sort', () => {
  const s = room('t', { x: 1, y: 5, w: 14, h: 3 }, [
    prop('rug', { x: 2, y: 5, w: 2, h: 1 }, { layer: 'back' }),
    prop('table', { x: 7, y: 6, w: 2, h: 1 }, { anchorY: 7 }),
    prop('lamp', { x: 4, y: 0, w: 1, h: 1 }, { layer: 'front', anchorY: 1 }),
  ]);
  const behind = { id: 'p-behind', y: 6.5 };
  const front = { id: 'p-front', y: 7.5 };
  assert.deepEqual(drawOrder(s, [front, behind]), ['rug', 'p-behind', 'table', 'p-front', 'lamp']);
  // the front prop stays last even though its baseline is the highest on screen
  assert.equal(drawOrder(s, []).at(-1), 'lamp');
});

test('draw order: equal baselines break on id, every frame the same way', () => {
  const s = room('t', { x: 1, y: 5, w: 14, h: 3 }, [prop('table', { x: 7, y: 6, w: 2, h: 1 }, { anchorY: 7 })]);
  const a = { id: 'bbb', y: 7 }, b = { id: 'aaa', y: 7 }, c = { id: 'ccc', y: 7 };
  const once = drawOrder(s, [a, b, c]);
  assert.deepEqual(once, ['aaa', 'bbb', 'ccc', 'table'], 'ties sort by id; the prop id loses to none of them by y');
  assert.deepEqual(drawOrder(s, [c, a, b]), once, 'insertion order does not matter');
  assert.deepEqual(drawOrder(s, [b, c, a]), once);
});

test('draw order: the list is reused between frames without leaking entries', () => {
  const s = room('t', { x: 1, y: 5, w: 14, h: 3 }, [prop('table', { x: 7, y: 6, w: 2, h: 1 })]);
  const out = /** @type {import('../public/screen/scene-render.js').Item[]} */ ([]);
  buildDrawList(s, [{ id: 'a', y: 6 }, { id: 'b', y: 8 }], out);
  assert.equal(out.length, 3);
  buildDrawList(s, [{ id: 'a', y: 6 }], out);
  assert.deepEqual(out.map((e) => e.id), ['a', 'table'], 'the avatar that left is gone');
});

test('party room: the prop grids are rectangular and only use their own palette', () => {
  for (const [id, { grid, pal }] of Object.entries(PROP_PIXELS)) {
    const w = grid[0].length;
    grid.forEach((row, y) => {
      assert.equal(row.length, w, `${id} row ${y} is ${row.length} wide, expected ${w}`);
      for (const ch of row) assert.ok(ch === '.' || ch in pal, `${id} row ${y}: '${ch}' is not in the palette`);
    });
    const art = PARTY_ROOM.props.find((p) => p.kind === id);
    assert.ok(art, `${id} is a prop of the party room`);
  }
});
