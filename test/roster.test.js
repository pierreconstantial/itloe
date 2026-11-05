// The roster wired end to end: every character has a colour, a sprite and a place on the TV.
// Since there is no browser in the gate, the CSS side is checked by reading the stylesheets:
// what cannot be asserted here (how it actually looks) is called out in the package report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHARACTERS, ROSTER_SIZE } from '../shared/characters.js';
import { SPRITES, SPRITE_SIZE, DIRS, spriteFrame } from '../shared/sprites.js';
import { PARTY_ROOM, isWalkable, spawnAt } from '../shared/scene.js';
import { spawnPoint } from '../shared/world.js';

const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BASE_CSS = read('public/commun/base.css');
const SCREEN_CSS = read('public/commun/screen-main.css');
const QUIZ_CSS = read('public/screen/quiz.css');

/** '#rrggbb' → [r, g, b] */
const rgb = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Cheap perceptual distance between two hex colours (weighted RGB, "redmean").
 * @param {string} a @param {string} b */
function distance(a, b) {
  const [ar, ag, ab] = rgb(a), [br, bg, bb] = rgb(b);
  const r = (ar + br) / 2, dr = ar - br, dg = ag - bg, db = ab - bb;
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}
/** The value of a CSS custom property declared in a stylesheet. @param {string} css @param {string} name */
function token(css, name) {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css);
  return m?.[1].toLowerCase() ?? null;
}

test('roster: ids, names and colours line up, one colour slot per character', () => {
  const ids = Object.keys(CHARACTERS);
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

test('roster: each character is recognisable — no two sprites share a silhouette or a palette', () => {
  const ids = Object.keys(CHARACTERS);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = spriteFrame(ids[i], 'down', 0), b = spriteFrame(ids[j], 'down', 0);
      assert.notDeepEqual(a, b, `${ids[i]} and ${ids[j]} are drawn differently`);
      const pa = SPRITES[ids[i]].palette, pb = SPRITES[ids[j]].palette;
      assert.notEqual(JSON.stringify(pa), JSON.stringify(pb), `${ids[i]} and ${ids[j]} do not share a palette`);
      // hair and main garment: at least one of the two must differ clearly
      const hair = distance(pa.h ?? '#000000', pb.h ?? '#000000');
      const cloth = distance(pa.c ?? '#000000', pb.c ?? '#000000');
      assert.ok(hair > 60 || cloth > 60, `${ids[i]} vs ${ids[j]}: hair (${Math.round(hair)}) or clothes (${Math.round(cloth)}) must differ`);
    }
  }
});

test('colours: base.css has one --pN per character, all far enough apart', () => {
  /** @type {string[]} */
  const slots = [];
  for (let i = 1; i <= ROSTER_SIZE; i++) {
    const v = token(BASE_CSS, `p${i}`);
    assert.ok(v, `--p${i} is defined in base.css`);
    slots.push(v);
  }
  assert.equal(new Set(slots).size, slots.length, 'no two player colours are the same value');
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      assert.ok(distance(slots[i], slots[j]) > 100,
        `--p${i + 1} and --p${j + 1} are too close (${Math.round(distance(slots[i], slots[j]))})`);
    }
    // and far from the UI colours they are drawn next to or on top of
    for (const name of ['ok', 'bad', 'accent', 'cell', 'bg', 'bg-2']) {
      const ui = token(BASE_CSS, name);
      if (!ui) continue;
      assert.ok(distance(slots[i], ui) > 55, `--p${i + 1} is too close to --${name}`);
    }
  }
});

test('TV: every player count the roster allows has a board layout and a density', () => {
  for (let n = 1; n <= ROSTER_SIZE; n++) {
    const sel = `.arena[data-players="${n}"]`;
    assert.ok(SCREEN_CSS.includes(sel), `${sel} is laid out in screen-main.css`);
    // a density rule sets the panel type sizes for that count
    assert.ok(new RegExp(`${sel.replace(/[[\]"]/g, (c) => `\\${c}`)}[^{]*\\{[^}]*--pcell`).test(SCREEN_CSS),
      `${sel} has its own --head/--pcell sizing`);
  }
  for (let n = 1; n <= ROSTER_SIZE; n++) {
    assert.ok(QUIZ_CSS.includes(`.quiz-result:nth-child(${n})`) || n === 1,
      `the quiz reveal animates seat ${n}`);
  }
});

test('spawns: the whole roster starts on walkable floor, and spawnAt never has to nudge', () => {
  const seen = new Set();
  for (const id of Object.keys(CHARACTERS)) {
    const raw = spawnPoint(/** @type {any} */ (id));
    assert.ok(isWalkable(PARTY_ROOM, raw.x, raw.y), `${id} spawns on free floor`);
    assert.deepEqual(spawnAt(PARTY_ROOM, /** @type {any} */ (id)), raw, `${id}: spawnAt is a no-op`);
    seen.add(`${raw.x},${raw.y}`);
    // and nobody spawns on top of a neighbour
    for (const other of Object.keys(CHARACTERS)) {
      if (other === id) continue;
      const o = spawnPoint(/** @type {any} */ (other));
      assert.ok(Math.abs(o.x - raw.x) > 0.6 || o.y !== raw.y, `${id} and ${other} do not overlap`);
    }
  }
  assert.equal(seen.size, ROSTER_SIZE, 'every character has its own spot');
});
