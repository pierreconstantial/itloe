// Young Adult prop art (shared/campaign/story/young-adult.js names the props): pixel grids, same letter-per-pixel
// convention as shared/sprites.js ('.' transparent, every other letter indexes the palette), painted bottom-centred
// on the prop's box by the party room (./party-room.js).

/** A tired punk leaning on the cigarette machine, crowbar in hand. */
const TRAM_MAN_PAL = { o: '#241c2b', h: '#3b2739', s: '#dca477', e: '#241c2b', c: '#614263', C: '#3e2d50',
  p: '#303744', b: '#20212a', r: '#acb5be' };
const TRAM_MAN = [
  '....oooooooo....',
  '...ohhhhhhhho...',
  '..ohhhhhhhhhho..',
  '..ohssssssssho..',
  '..ohsesssessho..',
  '..ohssssssssho..',
  '...ohssssssho...',
  '....oooooooo....',
  '...occcccccco...',
  '..ocCccccccCor..',
  '..ocCccccccCor..',
  '...oCCCCCCCo.r..',
  '....opppppo..r..',
  '....opppppo..r..',
  '....oppooppo.r..',
  '....obboobbo.rr.',
];

/** Small shaggy dog, looking up at the man. */
const TRAM_DOG_PAL = { o: '#32252a', f: '#a66a45', F: '#d29861', e: '#1e1b20', n: '#1e1b20', c: '#d6a64d' };
const TRAM_DOG = [
  '........ooo.....',
  '.......ofFFo....',
  '......ofFeFFo...',
  '......oFFFFno...',
  '.......oFFFoo...',
  '.oo...oFcFFo....',
  'ofFoooFFFFFoo...',
  'oFFFFFFFFFFo....',
  '.oFFFFFfFfFo....',
  '..oFFFfFfFFo....',
  '...oFFo.oFFo....',
  '...oooo.oooo....',
];

/** Red Vienna cigarette automat with packs behind glass and a coin slot. */
const TRAM_AUTOMAT_PAL = { o: '#312b36', r: '#a33f47', R: '#c45458', d: '#78333d', g: '#7a8990',
  G: '#bdc5b7', w: '#ead9b9', y: '#e5b964', k: '#352e37' };
const TRAM_AUTOMAT = [
  '.oooooooooooo.',
  'oRRRRRRRRRRRRo',
  'orrrrrrrrrrrro',
  'orwwwwwwwwwrro',
  'orwGGGGGGGwwro',
  'orwGwwwwwGwGro',
  'orwGrrrrrGwGro',
  'orwGwwwwwGwGro',
  'orwGGGGGGGwwro',
  'orrrrrrrrrrrro',
  'orGGGGGGGGGrro',
  'orGwwGwwGwwGro',
  'orGrrGrrGrrGro',
  'orGGGGGGGGGrro',
  'orrrrrrrrrrrro',
  'orGGGGGGGGGrro',
  'orGwwGwwGwwGro',
  'orGrrGrrGrrGro',
  'orGGGGGGGGGrro',
  'orrrrrrrrrkkro',
  'orrrrrrrrryyro',
  'orrrrdddddddro',
  'oddddddddddddo',
  '.oooooooooooo.',
];

/** prop kind → its grid and palette. */
export const YOUNG_ADULT_PIXELS = {
  'tram-5-weird-man': { grid: TRAM_MAN, pal: TRAM_MAN_PAL },
  'tram-5-dog': { grid: TRAM_DOG, pal: TRAM_DOG_PAL },
  'tram-5-cigarette-automat': { grid: TRAM_AUTOMAT, pal: TRAM_AUTOMAT_PAL },
};
