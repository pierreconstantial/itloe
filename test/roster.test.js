// The roster wired end to end: every character has a colour slot and a sprite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, ROSTER_SIZE } from '../shared/characters.js';
import { SPRITES, SPRITE_SIZE, DIRS, spriteFrame } from '../shared/sprites.js';

test('roster: ids, names and colours line up, one colour slot per character', () => {
  const ids = Object.keys(CHARACTERS);
  assert.deepEqual(ids, ['pierre', 'elodie', 'sol', 'anna', 'nico', 'konz']);
  assert.equal(ids.length, ROSTER_SIZE);
  const colors = ids.map((id) => CHARACTERS[/** @type {keyof typeof CHARACTERS} */ (id)].color);
  assert.deepEqual(colors, colors.map((_, i) => i + 1), 'colours are 1..N in display order');
  assert.equal(new Set(colors).size, colors.length, 'no two characters share a colour');
  for (const id of ids) {
    const c = CHARACTERS[/** @type {keyof typeof CHARACTERS} */ (id)];
    assert.equal(c.id, id);
    assert.ok(c.name.length > 0 && c.name.length <= 12, `${id}: a name that fits a TV label`);
  }
});

test('roster: every character has a sprite that keeps the sheet contract', () => {
  for (const id of Object.keys(CHARACTERS)) {
    const sheet = SPRITES[id];
    assert.ok(sheet, `${id} has a sprite sheet`);
    for (const k of ['q', 'd']) assert.ok(k in sheet.palette, `${id}: '${k}' is derived at assembly`);
    for (const dir of DIRS) {
      for (let f = 0; f <= 3; f++) {
        const rows = spriteFrame(id, dir, f);
        assert.ok(rows, `${id}/${dir}/${f} exists`);
        assert.equal(rows.length, SPRITE_SIZE, `${id}/${dir}/${f}: 16 rows`);
        rows.forEach((row, y) => {
          assert.equal(row.length, SPRITE_SIZE, `${id}/${dir}/${f} row ${y}: 16 columns`);
          for (const ch of row) {
            assert.ok(ch === '.' || ch in sheet.palette, `${id}/${dir}/${f} row ${y}: '${ch}' is not in the palette`);
          }
        });
        assert.ok(/[bd]/.test(rows[SPRITE_SIZE - 1]), `${id}/${dir}/${f}: stands on its feet, on the bottom row`);
        assert.ok(!/[bd]/.test(rows.slice(0, 13).join('')), `${id}/${dir}/${f}: no shoe drawn in the upper body`);
      }
    }
    // left is the mirror of right, so a character never faces the wrong way
    const right = spriteFrame(id, 'right', 1), left = spriteFrame(id, 'left', 1);
    assert.deepEqual(left, right?.map((r) => [...r].reverse().join('')), `${id}: left mirrors right`);
  }
});
