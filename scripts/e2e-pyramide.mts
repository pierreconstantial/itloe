// Pyramide end-to-end: a real server on Pyramide's development start, four phone pages and a TV page in headless
// Chrome (each phone a separate device), and a screen socket that reads every view. The four players take the
// lobby's spots and play a classic round and a bidding duel to their podiums, back to the lobby between them:
// clues, guesses, the skip and the bids go through the phones' own forms and buttons.
// Checks: after every move, the word in play is on the clue givers' phones and on no guesser's phone and no
// TV screen (what the pages draw: the word is in the data every phone and TV receives); a clue giver whose
// socket drops and comes back sees the word again and the round carries on; no word is drawn twice across the
// two rounds. Plays a fixed word bank of its own (BLOKO_PYRAMIDE_DIR), with words no screen has any other
// reason to show.
// Usage: start Chrome with --remote-debugging-port=<CDP>, then
//        PORT=3194 CDP=9222 node scripts/e2e-pyramide.mts      (never PORT 3131: the live server)
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdpConnect, check, Client, finish, HTTP, lobbyOf, openPage, type Page, pyramideOf, settingsOf, type Server, SOCKET_PROBE, startServer, stop } from './e2e-lib.mts';
import { clueProblem } from '../shared/pyramide.js';

const PORT = process.env.PORT ?? '3141';
const CDP = process.env.CDP ?? '9222';
const VAR = mkdtempSync(join(tmpdir(), 'itloe-pyramide-'));
const SHOTS = '/tmp/pyr-shots-e2e';

// ---------- the word bank: words and clues no screen has another reason to show ----------
const BANK = {
  easy: ['zèbre', 'koala', 'igloo', 'yaourt', 'toucan', 'pirate'],
  medium: ['xylophone', 'trapèze', 'kangourou', 'périscope', 'cornemuse', 'gondole', 'harmonica', 'catapulte', 'tambourin', 'scaphandre', 'hélicoptère', 'mongolfière'],
  hard: ['anthracite', 'quenelle', 'myriapode', 'sarcophage'],
};
const BANK_DIR = join(VAR, 'bank');
mkdirSync(BANK_DIR);
writeFileSync(join(BANK_DIR, 'words.json'), JSON.stringify({
  language: 'fr',
  categories: Object.fromEntries(Object.entries(BANK).map(([level, words]) => [level, words.map((word, k) => ({ id: `${level}-${k}`, word }))])),
}));
const CLUES = ['rouge', 'vert', 'chaud', 'froid', 'vite', 'lent', 'haut', 'doux', 'sucre', 'grand', 'petit', 'noir', 'rond', 'long'];
let clueCount = 0;
/** The next clue of the list that the word accepts. */
function clueFor(word: string): string {
  for (let k = 0; k < CLUES.length; k++) {
    const clue = CLUES[clueCount++ % CLUES.length];
    if (clueProblem(word, clue) === null) return clue;
  }
  throw new Error(`no clue for ${word}`);
}
/** A guess that is no word of the bank. */
const WRONG = 'pomme';

// ---------- processes and pages ----------
let server: Server | null = null;
const pages: Page[] = [];
let T!: Client; // the screen socket: every view
let tv!: Page;
type Seat = { name: string, id: string, page: Page };
const seats: Record<string, Seat> = {};
const byId = (id: string): Seat => Object.values(seats).find((s) => s.id === id)!;
/** A message on a phone's own socket, as the phone would send it. */
const say = (who: string, m: object) => seats[who].page.ev(`window.__ws.send(${JSON.stringify(JSON.stringify(m))})`);
const round = (): any => pyramideOf(T.last());
const holders = (v: any): Record<string, string | null> => Object.fromEntries(v.minigame.spots.map((s: any) => [s.id, s.holder]));

/** A view of the screen socket whose Pyramide round satisfies `pred`, after message `from`. */
async function untilRound(pred: (s: any) => boolean, from: number, ms = 5000): Promise<any> {
  return pyramideOf(await T.waitFor((m) => m.t === 'view' && !!pyramideOf(m) && pred(pyramideOf(m)), from, ms));
}

// ---------- what the screens draw ----------
const leaks: string[] = [];
const missing: string[] = [];
let compared = 0;
const draws = (text: string, word: string) => text.toLowerCase().includes(word.toLowerCase());

/**
 * Once every phone and the TV show the round as the screen socket has it: the words in play are on their clue
 * givers' phones (the team's own word; the duel's word is both teams'), and on nothing else.
 */
async function checkScreens(): Promise<void> {
  const s = round();
  const n = s.log.length;
  const phones = Object.values(seats);
  await Promise.all([
    ...phones.map((p) => p.page.waitFor(`!!document.getElementById('pyr-log') && document.querySelectorAll('#pyr-log li:not(.dim)').length === ${n}`)),
    tv.waitFor(`window.bloko?.minigame()?.view.round?.log.length === ${n}`),
  ]);
  const texts = await Promise.all([...phones.map((p) => p.page.text()), tv.text()]);
  const words = [...new Set<string>(s.teams.map((t: any) => t.word?.word).filter(Boolean))];
  const where = `after ${n} log lines`;
  phones.forEach((seat, k) => {
    const own = s.teams.filter((t: any) => t.clue === seat.id).map((t: any) => t.word?.word);
    for (const w of words) {
      compared++;
      if (own.includes(w) && !draws(texts[k], w)) missing.push(`${seat.name}'s phone doesn't show its word "${w}" ${where}`);
      if (!own.includes(w) && draws(texts[k], w)) leaks.push(`${seat.name}'s phone draws "${w}" ${where}`);
    }
  });
  for (const w of words) {
    compared++;
    if (draws(texts[phones.length], w)) leaks.push(`the TV draws "${w}" ${where}`);
  }
}

/** Does this check's tally say the screens held? Reports and clears it. */
function reportScreens(what: string): void {
  check(leaks.length === 0, `${what}: no word in play on a guesser's phone or the TV before it was found, lost or skipped (${compared} comparisons)${leaks.length ? `: ${leaks.slice(0, 4).join('; ')}` : ''}`);
  check(missing.length === 0, `${what}: a clue giver's phone always shows its word${missing.length ? `: ${missing.slice(0, 4).join('; ')}` : ''}`);
  leaks.length = missing.length = compared = 0;
}

/** One move through a phone's UI, then the screens checked once the view has everywhere. */
async function move(doIt: () => Promise<unknown>): Promise<any> {
  const i = T.mark();
  const before = round().log.length;
  await doIt();
  const s = await untilRound((r) => r.log.length > before, i);
  if (s.endReason === null) await checkScreens();
  return s;
}
const clue = (s: any) => move(async () => {
  const t = s.teams[s.turn];
  await byId(t.clue).page.type('#pyr-clue', clueFor(t.word.word));
  await byId(t.clue).page.tap('#pyr-clue-send');
});
const guess = (s: any, found: boolean) => move(async () => {
  const t = s.teams[s.turn];
  await byId(t.guess).page.type('#pyr-guess', found ? t.word.word : WRONG);
  await byId(t.guess).page.tap('#pyr-guess-send');
});

// ---------- the lobby ----------
const SPOTS: Record<string, string> = { 'team1-clue': 'elodie', 'team1-guess': 'pierre', 'team2-clue': 'nico', 'team2-guess': 'sol' };
const podium = (what: string) => tv.waitFor(`/win!|draw/i.test(document.body.innerText)`, 30_000).then(() => check(true, `${what}: the TV shows the podium`));
async function backToLobby(): Promise<any> {
  const i = T.mark();
  await say('pierre', { t: 'lobby' });
  return T.waitFor((m) => m.t === 'view' && m.minigame?.status === 'lobby', i);
}

/** A clue giver whose socket drops: offline, then back by itself, seeing its word again; the round as it was. */
async function dropAndBack(seat: Seat, word: string): Promise<void> {
  const before = JSON.stringify(round());
  const i = T.mark();
  // the word's text is cleared first: it can only come back by a redraw after the reconnection
  await seat.page.ev(`document.getElementById('pyr-word-text').textContent = ''; window.__ws.close()`);
  const off = await T.waitFor((m) => m.t === 'view' && !m.online.includes(seat.id), i);
  await T.waitFor((m) => m.t === 'view' && m.online.includes(seat.id), T.msgs.indexOf(off) + 1, 10_000);
  await seat.page.waitFor(`document.body.innerText.toLowerCase().includes(${JSON.stringify(word.toLowerCase())})`);
  check(JSON.stringify(round()) === before, `${seat.name}, a clue giver mid-word: socket dropped and back → sees "${word}" again, the round as it was`);
}

// ---------- the rounds ----------
/** The classic round: team 1 skips its first word, then finds each word with its second clue (and lets a
 *  clue giver's socket drop mid-word); team 2 finds each with its first. */
async function classic(): Promise<any> {
  let skipped = false, dropped = false;
  for (let moves = 0; moves < 60; moves++) {
    const s = round();
    if (s.endReason !== null) return s;
    const t = s.teams[s.turn];
    if (s.step === 'clue') {
      if (!skipped && s.turn === 0 && t.clues === 0) {
        skipped = true;
        const was = t.word.id;
        const after = await move(() => byId(t.clue).page.tap('#pyr-skip'));
        check(after.teams[0].word.id !== was && after.log.at(-1).t === 'skipped' && after.teams[0].used === 0, 'classic: skipping the first word → another word, no brick used');
        continue;
      }
      if (!dropped && s.turn === 0 && t.clues === 1) {
        dropped = true;
        await dropAndBack(byId(t.clue), t.word.word);
      }
      await clue(s);
    } else {
      await guess(s, t.clues >= (s.turn === 0 ? 2 : 1));
    }
  }
  throw new Error('the classic round never ended');
}

/** Per duel word: who opens with how many bricks and how the other clue giver answers, and how many clues the
 *  playing team needs (null: never finds it). */
const DUEL: { open: number, answer?: 'pass' | 'outbid', need: number | null }[] = [
  { open: 5, answer: 'pass', need: 2 },
  { open: 5, answer: 'outbid', need: 1 },
  { open: 1, need: null },
  { open: 5, answer: 'pass', need: 1 },
  { open: 5, answer: 'pass', need: 1 },
];
async function duel(): Promise<any> {
  for (let moves = 0; moves < 60; moves++) {
    const s = round();
    if (s.endReason !== null) return s;
    const t = s.teams[s.turn];
    const plan = DUEL[s.index];
    if (s.step === 'bid') {
      const bidder = byId(t.clue).page;
      await move(async () => {
        if (!s.bid) {
          for (let n = 5; n > plan.open; n--) await bidder.tap('#pyr-bid-less');
          await bidder.tap('#pyr-bid-send');
        } else if (plan.answer === 'outbid' && s.bid.n === 5) await bidder.tap('#pyr-bid-send'); // starts one below the last bid
        else await bidder.tap('#pyr-pass');
      });
    } else if (s.step === 'clue') await clue(s);
    else await guess(s, plan.need !== null && t.clues >= plan.need);
  }
  throw new Error('the duel never ended');
}

try {
  server = await startServer(PORT, join(VAR, 'var'), 'minigame:pyramide', { stdio: 'pipe', env: { ...process.env, BLOKO_PYRAMIDE_DIR: BANK_DIR } });
  const room = (await (await fetch(`${HTTP}/api/join`)).json()).code;
  const cdp = await cdpConnect(CDP);
  const open = async (label: string, phone: boolean) => {
    const p = await openPage(cdp, label, phone, () => SHOTS, phone ? [SOCKET_PROBE] : []);
    pages.push(p);
    return p;
  };

  tv = await open('tv', false);
  await tv.goto(`${HTTP}/screen/`);
  for (const name of ['pierre', 'elodie', 'nico', 'sol']) { // Pierre first: the game master
    const page = await open(name, true);
    await page.goto(`${HTTP}/play?room=${room}`);
    await page.tap(`.pick-card[data-id="${name}"]`);
    await page.waitFor(`localStorage.getItem('bloko-id') && document.getElementById('view-pick')?.closest('[hidden]')`);
    seats[name] = { name, id: await page.ev(`localStorage.getItem('bloko-id')`), page };
  }
  T = new Client('T'); await T.open();
  T.send({ t: 'hello', role: 'screen' });
  await T.waitFor((m) => m.t === 'view');

  // ---------- the lobby: four players take the spots ----------
  let i = T.mark();
  await say('pierre', { t: 'startMinigame' });
  await T.waitFor((m) => m.t === 'view' && !!lobbyOf(m) && !!m.minigame.spots, i);
  i = T.mark();
  for (const [spot, who] of Object.entries(SPOTS)) await say(who, { t: 'takeSpot', spot });
  const held = await T.waitFor((m) => m.t === 'view' && !!m.minigame?.spots && Object.values(holders(m)).every(Boolean), i);
  check(Object.entries(SPOTS).every(([spot, who]) => holders(held)[spot] === seats[who].id), 'lobby: four players on the four spots');

  // ---------- a classic round ----------
  i = T.mark();
  await say('pierre', { t: 'start' });
  await untilRound((s) => s.mode === 'classic' && s.endReason === null, i);
  await checkScreens();
  const first = await classic();
  reportScreens('classic round');
  check(first.endReason === 'done' && first.teams.every((t: any) => t.score === 4 && t.done)
    && first.teams[0].used === 8 && first.teams[1].used === 4 && first.players[seats.nico.id].rank === 1 && first.players[seats.pierre.id].rank === 2,
  'classic round played through: both teams found their four words, team 2 with fewer bricks ranks first');
  await podium('classic round');

  // ---------- the lobby again, on the same spots; a bidding duel ----------
  const lobby = await backToLobby();
  check(Object.entries(SPOTS).every(([spot, who]) => holders(lobby)[spot] === seats[who].id), 'after the round: back in the lobby, still on their spots');
  i = T.mark();
  await say('pierre', { t: 'config', patch: { mode: 'duel' } });
  await T.waitFor((m) => m.t === 'view' && settingsOf(m)?.mode === 'duel', i);
  i = T.mark();
  await say('pierre', { t: 'start' });
  await untilRound((s) => s.mode === 'duel' && s.endReason === null, i);
  await checkScreens();
  const second = await duel();
  reportScreens('duel round');
  check(second.endReason === 'done' && second.teams.map((t: any) => t.score).join() === '3,2' && second.players[seats.elodie.id].rank === 1 && second.players[seats.sol.id].rank === 2,
    'duel played through: five words with bids, an outbid, a bid of 1 lost, 3 points to 2 → team 1 ranks first');
  check(new Set([...first.drawn, ...second.drawn]).size === first.drawn.length + second.drawn.length, `no word drawn twice across the two rounds (${first.drawn.length} + ${second.drawn.length} words)`);
  await podium('duel round');
  await backToLobby();
  check(true, 'duel round: back to the lobby');
} catch (e) {
  check(false, `crashed: ${(e as Error).stack ?? e}\n--- server log ---\n${server?.log() ?? ''}`);
} finally {
  T?.ws.close();
  for (const p of pages) await p.close();
  await stop(server?.proc ?? null);
  rmSync(VAR, { recursive: true, force: true, maxRetries: 5 });
}
finish();
