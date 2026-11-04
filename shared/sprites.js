// M3 Contract C — character sprites (P4 owns this file inside shared/).
// 16×16 indexed-palette pixel art, Zelda-like: a big head on a small body.
// Per character: an upper body (13 rows) per view — front (down), back (up), side (right) —
// and the shared leg templates below (3 rows: idle + 2 walk frames). Left = mirrored right.
// Grid letters index the character's palette; '.' is transparent.

/** @typedef {'up' | 'down' | 'left' | 'right'} Dir */
/** Frame index: 0 = idle (standing), 1 and 2 = the two walk frames. @typedef {0 | 1 | 2} Frame */
/**
 * @typedef {{
 *   palette: Record<string, string>,          // letter → CSS colour
 *   frames: Record<Dir, [string[], string[], string[]]>  // [idle, walk1, walk2], 16 rows of 16 letters
 * }} SpriteSheet
 */

export const SPRITE_SIZE = 16;
export const DIRS = /** @type {const} */ (['down', 'up', 'left', 'right']);
export const WALK_FRAMES = /** @type {const} */ ([1, 2]);

// ---- shared legs (rows 13–15) ----------------------------------------------------

const LEGS_FRONT = [
  ['....oppppppo....', '....oppooppo....', '....obboobbo....'],
  ['....oppppppo....', '....oppoobbo....', '....obbo........'],
  ['....oppppppo....', '....obbooppo....', '........obbo....'],
];
const LEGS_SIDE = [
  ['.....oppppo.....', '.....oppppo.....', '.....obbbbo.....'],
  ['....oppoppo.....', '...oppo..oppo...', '...obbo..obbo...'],
  ['.....oppppo.....', '.....oppppo.....', '....obbo.obbo...'],
];

// ---- characters (upper 13 rows per view) -----------------------------------------
// Common letters: o outline · h/H hair · s skin · e eyes · m mouth · c/C clothes · p pants · b shoes
// · a/A accents · w white · g glasses.

/** @type {Record<string, { palette: Record<string, string>, down: string[], up: string[], right: string[] }>} */
const DESIGNS = {
  // Pierre — brown hair, glasses, blue hoodie.
  pierre: {
    palette: {
      o: '#1b1d24', h: '#6b4226', H: '#4a2c18', s: '#f1c48f', e: '#1b1d24', m: '#b5544c',
      g: '#2c2f38', c: '#3d73c4', C: '#2b538f', p: '#3a3f4e', b: '#1e1f25',
    },
    down: [
      '................',
      '................',
      '....oooooooo....',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohssssssho...',
      '...ogegssgego...',
      '...osssssssso...',
      '...osssmmssso...',
      '....oooooooo....',
      '..osccccccccso..',
      '..occcccccccco..',
      '...oCCCCCCCCo...',
    ],
    up: [
      '................',
      '................',
      '....oooooooo....',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...ohhhhhhhho...',
      '...oHhhhhhhHo...',
      '....oossssoo....',
      '..osccccccccso..',
      '..occcccccccco..',
      '...oCCCCCCCCo...',
    ],
    right: [
      '................',
      '................',
      '....oooooooo....',
      '...ohhhhhhhho...',
      '...ohhhhhhhhho..',
      '...ohhhhhssso...',
      '...ohhhsgegso...',
      '...ohhhsssssso..',
      '...ohhssssmo....',
      '....oooooo......',
      '....occccccso...',
      '....occccccco...',
      '....oCCCCCCo....',
    ],
  },

  // Élodie — the birthday star: striped party hat with a pompom, long golden hair,
  // pink party dress with a star.
  elodie: {
    palette: {
      o: '#2a1c24', h: '#d99a3e', H: '#a86c24', s: '#f6cfa4', e: '#2a1c24', m: '#c2485a',
      a: '#ff5fa2', A: '#ffd23f', w: '#ffffff', c: '#ff7eb9', C: '#d94f92', p: '#f6cfa4', b: '#c2185b',
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
      '..ohhccAAcchho..',
      '..ohccccccccho..',
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
      '..oHccccccccHo..',
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
      '..ohhhccccAso...',
      '..ohhhcccccco...',
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
  // oversized lilac jacket over a white top, white sneakers.
  anna: {
    palette: {
      o: '#1c1726', h: '#1f1b2b', A: '#b48cff', a: '#ff6fae', s: '#f3d2b4', e: '#1c1726', m: '#d0607a',
      c: '#b9a2ff', C: '#8f75e0', w: '#ffffff', p: '#2a2633', b: '#ffffff',
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
      '..oCCwwwwwwCCo..',
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
      '..oCCCCCCCCCCo..',
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
      '...oCCCCCCCCo...',
    ],
  },
};

// ---- assembly ----------------------------------------------------------------------

/** @param {string[]} rows */
const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

/**
 * @param {string[]} upper
 * @param {string[][]} legs [idle, walk1, walk2]
 * @returns {[string[], string[], string[]]}
 */
const withLegs = (upper, legs) => /** @type {[string[], string[], string[]]} */ (legs.map((l) => [...upper, ...l]));

/** @type {Record<string, SpriteSheet>} */
export const SPRITES = Object.fromEntries(Object.entries(DESIGNS).map(([id, d]) => {
  const right = withLegs(d.right, LEGS_SIDE);
  return [id, {
    palette: { ...d.palette },
    frames: {
      down: withLegs(d.down, LEGS_FRONT),
      up: withLegs(d.up, LEGS_FRONT),
      right,
      left: /** @type {[string[], string[], string[]]} */ (right.map(mirror)),
    },
  }];
}));

/**
 * The 16 rows of one frame, or null for an unknown character.
 * @param {string} characterId
 * @param {Dir} dir
 * @param {number} frame 0 idle, 1|2 walk (other values wrap to a walk frame)
 * @returns {string[] | null}
 */
export function spriteFrame(characterId, dir, frame) {
  const sheet = SPRITES[characterId];
  if (!sheet) return null;
  const frames = sheet.frames[dir] ?? sheet.frames.down;
  return frames[frame === 0 ? 0 : 1 + ((Math.abs(Math.trunc(frame)) + 1) % 2)];
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
 * @param {number} frame 0 idle, 1|2 walk
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
