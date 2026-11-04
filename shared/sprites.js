// M3 Contract C — character sprites (P4 owns this file inside shared/).
// 16×16 indexed-palette pixel art, Zelda-like: a big head on a small body.
// Per character: an upper body (13 rows) per view — front (down), back (up), side (right) —
// and the shared leg templates below. Left = mirrored right.
// Grid letters index the character's palette; '.' is transparent. Two letters are derived for every
// character at assembly: q = shaded pants, d = shaded shoes (the far leg in side view).
//
// Walk cycle (contact – passing – contact – passing): on a contact frame the legs are apart, so the
// body sits 1px lower (2 leg rows); on the passing frame the legs are together and the body is back
// up (3 leg rows) — that 1px bob is most of what makes a 16×16 walk read smooth. Feet always end
// on the bottom row, so callers anchor every frame the same way.

/** @typedef {'up' | 'down' | 'left' | 'right'} Dir */
/** Frame index: 0 = idle (standing), 1 = contact A, 2 = passing, 3 = contact B. @typedef {0 | 1 | 2 | 3} Frame */
/** @typedef {[string[], string[], string[], string[]]} DirFrames [idle, contactA, passing, contactB] */
/**
 * @typedef {{
 *   palette: Record<string, string>,   // letter → CSS colour
 *   frames: Record<Dir, DirFrames>     // 16 rows of 16 letters each
 * }} SpriteSheet
 */

export const SPRITE_SIZE = 16;
export const DIRS = /** @type {const} */ (['down', 'up', 'left', 'right']);
/** One walk cycle, in order: clients step through these (at WALK_FPS), never hardcode frame numbers. */
export const WALK_FRAMES = /** @type {const} */ ([1, 2, 3, 2]);
/** Suggested walk animation rate (frames of WALK_FRAMES per second). */
export const WALK_FPS = 8;

// ---- shared legs (bottom rows) ------------------------------------------------------
// [idle, contactA, passing, contactB]; contact frames have 2 rows (body 1px lower), the others 3.

const LEGS_FRONT = [
  ['....oppppppo....', '....oppooppo....', '....obboobbo....'],
  ['....oppoobbo....', '....obbo........'],
  ['....oppppppo....', '....oppooqqo....', '....obboodbo....'],
  ['....obbooppo....', '........obbo....'],
];
const LEGS_SIDE = [
  ['.....oppppo.....', '.....oppppo.....', '.....obbbbo.....'],
  ['...oqqo..oppo...', '..oddo....obbo..'],
  ['.....oppppo.....', '.....oqoppo.....', '.....odobbo.....'],
  ['...oppo..oqqo...', '..obbo....oddo..'],
];

// ---- characters (upper 13 rows per view) -----------------------------------------
// Common letters: o outline · h/H hair · s skin · e eyes · m mouth · c/C clothes · p pants · b shoes
// · a/A accents · w white · g glasses · k a second garment (jacket) or its woven detail (pleats).
// Detail drawn inside a garment takes k or that garment's own shade, never the outline colour — a
// dark line inside a garment reads as a hole punched through it, not as fabric.

/** @type {Record<string, { palette: Record<string, string>, down: string[], up: string[], right: string[] }>} */
const DESIGNS = {
  // Pierre — brown hair under a charcoal snapback (white front panel, brim out front), glasses,
  // oversized blue hoodie with a silver chain, baggy jeans, chunky white sneakers.
  pierre: {
    palette: {
      o: '#1b1d24', h: '#6b4226', H: '#4a2c18', s: '#f1c48f', e: '#1b1d24', m: '#b5544c',
      g: '#2c2f38', c: '#3d73c4', C: '#2b538f', p: '#4b5572', b: '#e9ecf2',
      a: '#5b6478', A: '#31374a', w: '#eef1f5',
    },
    down: [
      '....oooooooo....',
      '...oaaaaaaaao...',
      '..oaaawwwwaaao..',
      '.oAAAAAAAAAAAAo.',
      '...ohhhhhhhho...',
      '...ohssssssho...',
      '...ogegssgego...',
      '...osssssssso...',
      '...osssmmssso...',
      '....oooooooo....',
      '..oscwccccwcso..',
      '..occcwwwwccco..',
      '..oCCCCCCCCCCo..',
    ],
    up: [
      '....oooooooo....',
      '...oaaaaaaaao...',
      '..oaaaaaaaaaao..',
      '..oaahhhhhhaao..',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...oHhhhhhhHo...',
      '....oossssoo....',
      '..osccccccccso..',
      '..occcccccccco..',
      '..oCCCCCCCCCCo..',
    ],
    right: [
      '....oooooooo....',
      '...oaaaaaaaao...',
      '...oaaaaawwwao..',
      '...oaaaaAAAAAAo.',
      '...ohhhhhhhho...',
      '...ohhhhhssso...',
      '...ohhhsgegso...',
      '...ohhhsssssso..',
      '...ohhssssmo....',
      '....oooooo......',
      '....occccwwso...',
      '....occcwwcco...',
      '...oCCCCCCCCo...',
    ],
  },

  // Élodie — the birthday star, with a punk edge: striped party hat with a pompom, long brown hair,
  // studded dark leather jacket open over a pink dress, dark tights and black boots.
  elodie: {
    palette: {
      o: '#2a1c24', h: '#8a5a30', H: '#5c3a1c', s: '#f6cfa4', e: '#2a1c24', m: '#c2485a',
      a: '#ff5fa2', A: '#ffd23f', w: '#ffffff', c: '#ff7eb9', C: '#d94f92', k: '#3b2f3d',
      p: '#4a3b4a', b: '#241a20',
    },
    down: [
      '.......ww.......',
      '......oaAo......',
      '.....oAaaAo.....',
      '....oaaAAaao....',
      '...ohhhhhhhho...',
      '..ohhhssssshho..',
      '..ohsessssesho..',
      '..ohsessssesho..',
      '..ohsasmmsasho..',
      '..ohhoooooohho..',
      '..ohkwkcckwkho..',
      '..ohkkcccckkho..',
      '..oCCCCCCCCCCo..',
    ],
    up: [
      '.......ww.......',
      '......oaAo......',
      '.....oAaaAo.....',
      '....oaaAAaao....',
      '...ohhhhhhhho...',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '..ohHhhhhhhHho..',
      '..oHwkkkkkkwHo..',
      '..oCCCCCCCCCCo..',
    ],
    right: [
      '.......ww.......',
      '......oaAo......',
      '.....oAaaAo.....',
      '....oaaAAaao....',
      '...ohhhhhhhho...',
      '..ohhhhhhssso...',
      '..ohhhhhhseso...',
      '..ohhhhhhsesso..',
      '..ohhhhhhsmso...',
      '..ohhhhhooo.....',
      '..ohhhwkkccso...',
      '..ohhhkkkccco...',
      '...oCCCCCCCCo...',
    ],
  },

  // Sol — taller teen: spiky black hair, red hoodie with white strings, headphones round the neck.
  sol: {
    palette: {
      o: '#15161b', h: '#22232b', H: '#121318', s: '#e8b98a', e: '#15161b', m: '#9c4a3c',
      a: '#9aa3ad', c: '#d8433a', C: '#a52f28', w: '#f2f2f2', p: '#2f4a7a', b: '#f2f2f2',
    },
    down: [
      '.....ohohhoho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohhshhshho...',
      '...osesssseso...',
      '...osesssseso...',
      '...osssmmssso...',
      '....oooooooo....',
      '...oaccccccao...',
      '..occcwccwccco..',
      '..occcccccccco..',
      '..osCCCCCCCCso..',
      '...oCCCCCCCCo...',
    ],
    up: [
      '.....ohohhoho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...oHhhhhhhHo...',
      '...ohHHHHHHho...',
      '....oooooooo....',
      '...oaccccccao...',
      '..occCCCCCCcco..',
      '..occcccccccco..',
      '..osCCCCCCCCso..',
      '...oCCCCCCCCo...',
    ],
    right: [
      '......ohohoho...',
      '...ohhhhhhhhho..',
      '...ohhhhhhhhho..',
      '...ohhhhhhssso..',
      '...ohhhhhsesso..',
      '...ohhhhsssssso.',
      '...ohhhsssmso...',
      '....oooooo......',
      '....oaaccco.....',
      '....occcccco....',
      '....occccccso...',
      '....occccccco...',
      '....oCCCCCCo....',
    ],
  },

  // Anna — 14, K-pop style: long black hair with a lilac streak and full fringe, pink heart clip,
  // oversized lilac jacket open over a white top, pleated lilac skirt, black tights,
  // chunky white sneakers.
  anna: {
    palette: {
      o: '#1c1726', h: '#1f1b2b', A: '#b48cff', a: '#ff6fae', s: '#f3d2b4', e: '#1c1726', m: '#d0607a',
      c: '#b9a2ff', C: '#8f75e0', k: '#6b53b4', w: '#ffffff', p: '#2a2633', b: '#ffffff',
    },
    down: [
      '................',
      '................',
      '....oooooooo....',
      '...ohhhhhhaho...',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '..ohsessssesho..',
      '..ohssssssssAo..',
      '..ohsssmmsssAo..',
      '..ohhoooooohAo..',
      '..ohcwwwwwwcAo..',
      '..occwwwwwwcco..',
      '..oCkCCkCCkCCo..',
    ],
    up: [
      '................',
      '................',
      '....oooooooo....',
      '...ohhhhhhaho...',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhAo..',
      '..ohhhhhhhhhAo..',
      '..ohhhhhhhhhAo..',
      '..occhhhhhhcco..',
      '..oCkCCkCCkCCo..',
    ],
    right: [
      '................',
      '................',
      '....oooooooo....',
      '...ohhhhhhaho...',
      '..ohhhhhhhhhho..',
      '..ohhhhhhhhhso..',
      '..ohhhhhhhseso..',
      '..ohhhhhhhsssso.',
      '..ohAhhhhhsmso..',
      '..ohAhhhhoooo...',
      '..ohAhhhccwso...',
      '..ohAhhcccccco..',
      '...oCCkCCkCCo...',
    ],
  },
};

// ---- assembly ----------------------------------------------------------------------

/** @param {string[]} rows */
const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

/**
 * Upper body + legs, feet on the bottom row: fewer leg rows push the body down (the walk bob).
 * @param {string[]} upper 13 rows
 * @param {string[][]} legs [idle, contactA, passing, contactB]
 * @returns {DirFrames}
 */
const withLegs = (upper, legs) => /** @type {DirFrames} */ (legs.map((l) => {
  const pad = SPRITE_SIZE - upper.length - l.length;
  return [...Array(pad).fill('.'.repeat(SPRITE_SIZE)), ...upper, ...l];
}));

/** '#rrggbb' scaled towards black. @param {string} hex @param {number} k */
const shade = (hex, k) => '#' + [1, 3, 5]
  .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');

/** @type {Record<string, SpriteSheet>} */
export const SPRITES = Object.fromEntries(Object.entries(DESIGNS).map(([id, d]) => {
  const right = withLegs(d.right, LEGS_SIDE);
  return [id, {
    palette: { ...d.palette, q: shade(d.palette.p, 0.72), d: shade(d.palette.b, 0.72) },
    frames: {
      down: withLegs(d.down, LEGS_FRONT),
      up: withLegs(d.up, LEGS_FRONT),
      right,
      left: /** @type {DirFrames} */ (right.map(mirror)),
    },
  }];
}));

const WALK_COUNT = 3; // distinct walk frames: 1..3

/**
 * The 16 rows of one frame, or null for an unknown character.
 * @param {string} characterId
 * @param {Dir} dir
 * @param {number} frame 0 idle, 1..3 walk (other values wrap to a walk frame)
 * @returns {string[] | null}
 */
export function spriteFrame(characterId, dir, frame) {
  const sheet = SPRITES[characterId];
  if (!sheet) return null;
  const frames = sheet.frames[dir] ?? sheet.frames.down;
  if (frame === 0) return frames[0];
  const n = Math.abs(Math.trunc(frame)) - 1;
  return frames[1 + (((n % WALK_COUNT) + WALK_COUNT) % WALK_COUNT)];
}

/** @type {Map<string, HTMLCanvasElement | OffscreenCanvas>} */
const cache = new Map();

/**
 * 16×16 bitmap of one frame (browser only), cached.
 * @param {string} characterId @param {Dir} dir @param {number} frame
 */
function bitmap(characterId, dir, frame) {
  const key = `${characterId}/${dir}/${frame}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = spriteFrame(characterId, dir, frame);
  if (!rows) return null;
  const c = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(SPRITE_SIZE, SPRITE_SIZE)
    : Object.assign(document.createElement('canvas'), { width: SPRITE_SIZE, height: SPRITE_SIZE });
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  paint(g, rows, SPRITES[characterId].palette, 0, 0, 1);
  cache.set(key, c);
  return c;
}

/**
 * @param {CanvasRenderingContext2D} ctx @param {string[]} rows @param {Record<string, string>} palette
 * @param {number} x @param {number} y @param {number} scale
 */
function paint(ctx, rows, palette, x, y, scale) {
  rows.forEach((row, py) => {
    for (let px = 0; px < row.length; px++) {
      const color = palette[row[px]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + px * scale, y + py * scale, scale, scale);
    }
  });
}

/**
 * Draws one sprite frame with crisp pixels; (x, y) = top-left corner, size = 16 × scale.
 * Unknown characters draw nothing and return false.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} characterId
 * @param {Dir} dir
 * @param {number} frame 0 idle, 1..3 walk (cycle WALK_FRAMES)
 * @param {number} x
 * @param {number} y
 * @param {number} scale
 * @returns {boolean}
 */
export function drawSprite(ctx, characterId, dir, frame, x, y, scale) {
  const img = bitmap(characterId, dir, frame);
  if (!img) return false;
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, Math.round(x), Math.round(y), SPRITE_SIZE * scale, SPRITE_SIZE * scale);
  ctx.imageSmoothingEnabled = smoothing;
  return true;
}
