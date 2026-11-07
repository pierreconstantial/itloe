// Small ambient people, drawn on the same 16-pixel grid as the playable characters.
// They are scene props: no dialogue, inventory, collision, or player slot.

import { YOUNG_ADULT_PIXELS } from './art/young-adult.js';

const sprite = (/** @type {string[]} */ ...rows) => rows.map((row) => row.padEnd(16, '.'));

const OLD_WOMAN = sprite(
  '.....ooooo......',
  '....ohhhhhhho...',
  '....ohihihho....',
  '....ohssssho....',
  '.....osssso.....',
  '.....ooosoo.....',
  '....occcccco....',
  '...ociccccco.a..',
  '...occccccco.a..',
  '...ocddddcco.a..',
  '....occcccoo.a..',
  '.....oppppoo.a..',
  '.....oppppo..a..',
  '.....oppppo..a..',
  '.....ob..bo..a..',
  '.....oo..oo..o..',
);
const ICE_KID = sprite(
  '....ooooooo.....',
  '...orrrrrrro....',
  '...orrrrrro.....',
  '....ossssso..w..',
  '....osseeso..w..',
  '.....osssso..a..',
  '......oooo..a...',
  '....occccooa....',
  '...ocicccco.....',
  '...occcccco.....',
  '....occcco......',
  '.....opppo......',
  '.....opppo......',
  '.....opopo......',
  '.....ob.bo......',
  '.....oo.oo......',
);
const LAZY_GUY = sprite(
  '....oooooooo....',
  '...ohhhhhhhho...',
  '...ohhhhhhho....',
  '....osssssso....',
  '....osseeo......',
  '.....osssso.....',
  '...ooccccsoo....',
  '..ociccccccco...',
  '.occcccccccco...',
  '.odddddccccco...',
  '..oddddcccpo....',
  '...oppppppo.....',
  '..oppppppo......',
  '.opppp.oppo.....',
  '.obbbb..obbo....',
  '.ooooo..oooo....',
);
const DANCING_GIRL = sprite(
  '.....oooo.......',
  '....ohhhho......',
  '....ohihho......',
  '....osssso......',
  '....osesso......',
  '.....osso.......',
  '..s..occoo..s...',
  '..osociccoso....',
  '...occcccco.....',
  '....occcco......',
  '....occcco......',
  '...occcccco.....',
  '....oppppo......',
  '....op.opo......',
  '....ob..bo......',
  '....oo..oo......',
);
const DANCING_GIRL_UP = sprite(
  '.....oooo.......',
  '....ohhhho......',
  '....ohihho......',
  '....osssso......',
  '....osesso......',
  '.s...osso...s...',
  '.os..occoo..so..',
  '..osociccoso....',
  '...occcccco.....',
  '....occcco......',
  '....occcco......',
  '...occcccco.....',
  '....oppppo......',
  '...opp..po......',
  '...ob...bo......',
  '...oo...oo......',
);
const DANCING_MAN = sprite(
  '....oooooo......',
  '...ohhhhhho.....',
  '...ohhhhhho.....',
  '....ossssso.....',
  '....osesso......',
  '.....osso.......',
  '...ooccccoos....',
  '..ocicccccoos...',
  '...occcccco.....',
  '....occcco......',
  '....oppppo......',
  '....oppppo......',
  '....op.opo......',
  '...opp..ppo.....',
  '...obb..bbo.....',
  '...ooo..ooo.....',
);
const DANCING_MAN_UP = sprite(
  '....oooooo......',
  '...ohhhhhho.....',
  '...ohhhhhho.....',
  '....ossssso.....',
  '....osesso......',
  '.....osso....s..',
  '...ooccccoo..os.',
  '..ocicccccosos..',
  '...occcccco.....',
  '....occcco......',
  '....oppppo......',
  '....oppppo......',
  '....op.opo......',
  '....pp..ppo.....',
  '....bb..bbo.....',
  '....oo..ooo.....',
);
const BEER_GUY = sprite(
  '....oooooo......',
  '...ohhhhhho.....',
  '...ohhhhhho.....',
  '....ossssso.....',
  '....osesso..aa..',
  '.....osso...aw..',
  '....occcco.saw..',
  '...ociccccosoo..',
  '...occcccco.....',
  '....occcco......',
  '....oppppo......',
  '....oppppo......',
  '....oppppo......',
  '....op.opo......',
  '....ob.bo......',
  '....oo.oo......',
);
const BEER_GUY_SIP = sprite(
  '....oooooo......',
  '...ohhhhhho.....',
  '...ohhhhhho.....',
  '....ossssso.....',
  '....osesso.aww..',
  '.....osso.sao...',
  '....occccoos....',
  '...ocicccco.....',
  '...occcccco.....',
  '....occcco......',
  '....oppppo......',
  '....oppppo......',
  '....oppppo......',
  '....op.opo......',
  '....ob.bo......',
  '....oo.oo......',
);
const BARMAN = sprite(
  '....oooooo......',
  '...ohhhhhho.....',
  '...ohhhhhho.....',
  '....ossssso.....',
  '....osesso......',
  '.....osso.......',
  '...oowwwwooo....',
  '..owwccwwcco....',
  '..owwccwwcco....',
  '...owcccwcco....',
  '...owwwwwwo.....',
  '....oppppo......',
  '....oppppo......',
  '....oppppo......',
  '....ob..bo......',
  '....oo..oo......',
);
const HYPED_PUNK = sprite(
  '.......r........',
  '......rrr.......',
  '.....rrrrr......',
  '....orrerro.....',
  '....ossssso.....',
  '....osesso......',
  '.....osso.......',
  '.s..occcco..s...',
  '.osocicccoso....',
  '...occcccco.....',
  '....occcco......',
  '....oppppo......',
  '....oppppo......',
  '...opp..ppo.....',
  '...obb..bbo.....',
  '...ooo..ooo.....',
);
const HYPED_PUNK_UP = sprite(
  '.......r........',
  '......rrr.......',
  '.....rrrrr......',
  '....orrerro.....',
  '....ossssso.....',
  '.s..osesso..s...',
  '.os..osso..so...',
  '..osoccccoso....',
  '...ocicccco.....',
  '....occcco......',
  '....occcco......',
  '....oppppo......',
  '....oppppo......',
  '...opp..ppo.....',
  '...obb..bbo.....',
  '...ooo..ooo.....',
);

const outline = '#1f1b2a';
const skin = '#dba37b';
const shared = { o: outline, s: skin, e: outline, p: '#3a3549', b: '#26222b', a: '#c69453', w: '#f8deaa' };

/** A small rat seen from the side, facing right (its grid is 16 wide and only a few rows high). */
const RAT = [
  '................',
  '...........oo...',
  '.......ooooggo..',
  'pp...oogggggwoo.',
  '..pooggggggggggr',
  '.....oo.o..o.o..',
].map((row) => row.padEnd(16, '.'));
/** A grid facing the other way. @param {string[]} grid */
const mirrored = (grid) => grid.map((row) => [...row].reverse().join(''));
/** The same rat facing left. */
const RAT_LEFT = mirrored(RAT);
/** Toni's dog, back at night: its Tram 5 art, chasing the rat. */
const NIGHT_DOG = YOUNG_ADULT_PIXELS['tram-5-dog'];

/** Ambient art and its quiet two-step movement. Every grid is 16 wide and 16 high, but the rat's (low on the
 *  ground); `scurry` runs to and fro, facing its way (`altGrid` facing left). */
export const AMBIENT_NPCS = Object.freeze({
  'tram-5-rat': { grid: RAT, altGrid: RAT_LEFT, pal: { o: '#1d1a1f', g: '#6d6670', w: '#e8e0d0', p: '#c98b93', r: '#d98f9a' }, motion: 'scurry', period: 5200, phase: 0 },
  // the rat's run, a moment late: always on its tail
  'tram-5-night-dog': { grid: NIGHT_DOG.grid, altGrid: mirrored(NIGHT_DOG.grid), pal: NIGHT_DOG.pal, motion: 'scurry', period: 5200, phase: -0.7 },
  'tram-5-old-woman': { grid: OLD_WOMAN, pal: { ...shared, h: '#d5d0c4', i: '#eee7d8', c: '#4d7063', d: '#33524b' }, motion: 'nod', period: 2700, phase: 0 },
  'tram-5-ice-kid': { grid: ICE_KID, pal: { ...shared, r: '#c5494d', c: '#4a85a4', i: '#79b5c7' }, motion: 'bounce', period: 1500, phase: 1 },
  'tram-5-lazy-guy': { grid: LAZY_GUY, pal: { ...shared, h: '#393845', c: '#8b6854', i: '#b68d65', d: '#644d47' }, motion: 'nod', period: 4100, phase: 2 },
  'shelter-dancing-girl': { grid: DANCING_GIRL, altGrid: DANCING_GIRL_UP, pal: { ...shared, h: '#ae4c78', i: '#d57da0', c: '#438f91' }, motion: 'dance', period: 700, phase: 0 },
  'shelter-dancing-man': { grid: DANCING_MAN, altGrid: DANCING_MAN_UP, pal: { ...shared, h: '#332b3b', i: '#e78279', c: '#913f5a' }, motion: 'dance', period: 700, phase: Math.PI },
  'shelter-beer-guy': { grid: BEER_GUY, altGrid: BEER_GUY_SIP, pal: { ...shared, h: '#443238', i: '#bc6765', c: '#63455d' }, motion: 'sip', period: 2300, phase: 1 },
  'shelter-barman': { grid: BARMAN, pal: { ...shared, h: '#33272e', c: '#332c39' }, motion: 'sway', period: 3200, phase: 0 },
  'shelter-hyped-punk': { grid: HYPED_PUNK, altGrid: HYPED_PUNK_UP, pal: { ...shared, r: '#e0703d', c: '#232630', i: '#c2594a', p: '#7c2d46' }, motion: 'dance', period: 540, phase: 2 },
});
