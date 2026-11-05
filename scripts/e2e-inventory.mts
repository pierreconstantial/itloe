// Inventory end-to-end (Contract F, server side) over real sockets and a server this script kill -9s:
// rewards land in the right inventory (chooser / winner incl. a tie / all non-left members), survive
// kill -9 and a reclaim from another device, the host's gm give/take work and are refused for an unknown
// item or character, for taking more than held, and for a non-host; an older save's flat `items` migrates
// to the chooser. Uses the sample content (old key → chooser, ticket → quiz winner, photo → all).
// Runs its OWN server (child process on PORT, scratch BLOKO_VAR, a fixed quiz bank). Usage:
//   PORT=3197 node scripts/e2e-inventory.mts      (never 3131: that's the live server)
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blocksOf, check, Client, finish, HTTP, quizOf, sleep } from './e2e-lib.mts';

const PORT = process.env.PORT ?? '3141';
if (PORT === '3131') throw new Error('3131 is the live server: pick another PORT');
const VAR = mkdtempSync(join(tmpdir(), 'bloko-inventory-'));
const MAIN = new URL('../server/main.ts', import.meta.url).pathname;
const PLACEHOLDER = new URL('../data/quiz/placeholder.json', import.meta.url).pathname;
const FIXED_BANK = join(VAR, 'fixed-bank');
mkdirSync(FIXED_BANK, { recursive: true });
copyFileSync(PLACEHOLDER, join(FIXED_BANK, 'placeholder.json'));
const BANK: { q: string, choices?: string[], answer: string | number }[] = JSON.parse(readFileSync(PLACEHOLDER, 'utf8')).questions;
const QUIZ = 'childhood.quiz';

let server: ChildProcess | null = null;
let log = '';
async function boot(fresh = false): Promise<void> {
  log = '';
  server = spawn(process.execPath, [MAIN, ...(fresh ? ['--new'] : [])], {
    env: { ...process.env, PORT, BLOKO_VAR: VAR, BLOKO_HOST: '127.0.0.1', BLOKO_QUIZ_DIR: FIXED_BANK, ITLOE_CONTENT: 'sample' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => { log += d; });
  server.stderr!.on('data', (d) => { log += d; });
  for (let k = 0; k < 100; k++) {
    try { room = (await (await fetch(`${HTTP}/api/join`)).json()).code; return; } catch { await sleep(50); }
  }
  throw new Error(`server did not come up:\n${log}`);
}
async function kill9(): Promise<void> {
  const s = server!;
  const gone = new Promise((r) => s.once('exit', r));
  s.kill('SIGKILL');
  await gone;
  server = null;
}

let room = '';
const camp = (c: Client): any => [...c.msgs].reverse().find((m) => m.t === 'view')?.campaign;
const inv = (c: Client): Record<string, Record<string, number>> => camp(c)?.facts.inventory ?? {};
const until = async (c: Client, pred: (k: any) => boolean, from = 0, ms = 4000) =>
  (await c.waitFor((m) => m.t === 'view' && !!m.campaign && pred(m.campaign), from, ms)).campaign;
const errOf = async (c: Client, msg: object): Promise<string | null> => {
  const i = c.mark();
  c.send(msg);
  try { return (await c.waitFor((m) => m.t === 'err', i, 700)).code; } catch { return null; }
};
async function player(label: string, character: string): Promise<{ c: Client, id: string }> {
  const c = new Client(label); await c.open();
  c.send({ t: 'hello', role: 'player', room });
  const i = c.mark();
  c.send({ t: 'join', character });
  return { c, id: (await c.waitFor((m) => m.t === 'welcome', i)).playerId };
}
async function rejoin(label: string, playerId: string): Promise<Client> {
  const c = new Client(label); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'player', playerId });
  await c.waitFor((m) => m.t === 'welcome' && m.playerId === playerId, i);
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}
async function screen(): Promise<Client> {
  const c = new Client('T'); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'screen' });
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}
const gm = (c: Client, op: object) => c.send({ t: 'gm', op });

/** Plays one quiz in childhood.quiz (choice mode, 3 questions): `right` players answer right, others wrong. */
async function playQuiz(host: Client, players: { c: Client, right: boolean }[], T: Client): Promise<void> {
  let i = T.mark();
  host.send({ t: 'config', patch: { count: 3, mode: 'choice' } });
  await T.waitFor((m) => m.t === 'view' && quizOf(m)?.settings.mode === 'choice' && quizOf(m).settings.count === 3, i);
  i = T.mark(); host.send({ t: 'start' });
  let q = quizOf(await T.waitFor((m) => m.t === 'view' && quizOf(m)?.phase === 'question', i));
  for (let r = 0; r < 3; r++) {
    const bq = BANK.find((x) => x.q === q.round.question.q)!;
    const right = q.round.question.choices.indexOf(bq.choices![bq.answer as number]);
    i = T.mark();
    for (const p of players) p.c.send({ t: 'answer', choice: p.right ? right : (right + 1) % 4 });
    await T.waitFor((m) => m.t === 'view' && quizOf(m)?.phase === 'reveal' && quizOf(m).round.index === r, i);
    i = T.mark(); host.send({ t: 'next' });
    q = quizOf(await T.waitFor((m) => m.t === 'view' && (quizOf(m)?.phase === 'finished' || (quizOf(m)?.phase === 'question' && quizOf(m).round.index === r + 1)), i));
  }
}

let P!: Client, E!: Client, S!: Client, T!: Client;
let idP = '', idE = '', idS = '';
async function restart(step: string): Promise<void> {
  const before = JSON.stringify(inv(T));
  await kill9(); await boot();
  for (const c of [P, E, S, T]) c.ws.close();
  P = await rejoin('P', idP); E = await rejoin('E', idE); S = await rejoin('S', idS); T = await screen();
  check(JSON.stringify(inv(T)) === before, `kill -9 ${step} → inventories unchanged (${before})`);
}

try {
  // ---------- chooser: the false start's old key goes to Élodie only ----------
  await boot(true);
  ({ c: P, id: idP } = await player('P', 'pierre')); // host
  ({ c: E, id: idE } = await player('E', 'elodie')); // chooser
  ({ c: S, id: idS } = await player('S', 'sol'));
  T = await screen();
  for (let n = 1; n <= 3; n++) {
    let i = P.mark();
    P.send({ t: n === 1 ? 'start' : 'again' });
    await P.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'playing', i);
    i = P.mark(); P.send({ t: 'endGame' });
    await P.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'finished', i);
  }
  let k = await until(T, (x) => !!x.facts.inventory.elodie?.['old-key']);
  check(k.facts.inventory.elodie['old-key'] === 1 && !k.facts.inventory.pierre && !k.facts.inventory.sol, 'false start done → the old key to the chooser only');
  const news = k.news.find((n: any) => n.t === 'item' && n.item === 'old-key');
  check(JSON.stringify(news?.to) === '["elodie"]', `news names the recipient (${JSON.stringify(news)})`);
  check(!('items' in k.facts), 'no flat facts.items any more');
  await restart('after the reward');

  // ---------- reclaim: the inventory follows the character to another device ----------
  E.ws.close();
  await until(T, (x) => true); await sleep(300);
  const E2 = new Client('E2'); await E2.open();
  E2.send({ t: 'hello', role: 'player', room });
  let i = E2.mark(); E2.send({ t: 'join', character: 'elodie' });
  const w = await E2.waitFor((m) => m.t === 'welcome', i);
  check(w.playerId === idE && inv(E2).elodie?.['old-key'] === 1, 'reclaimed on another device: same id, the key is still Élodie\'s');
  E = E2;

  // ---------- gm give / take ----------
  i = T.mark(); gm(P, { op: 'give', item: 'ticket', to: 'sol' });
  await until(T, (x) => x.facts.inventory.sol?.ticket === 1, i);
  check(true, 'host gives a ticket to Sol');
  check(await errOf(P, { t: 'gm', op: { op: 'take', item: 'ticket', from: 'sol', count: 2 } }) === 'refused', 'take more than held → refused (no partial take)');
  check(inv(T).sol?.ticket === 1, '…and nothing was taken');
  check(await errOf(P, { t: 'gm', op: { op: 'give', item: 'unicorn', to: 'sol' } }) === 'refused', 'unknown item → refused (items must exist)');
  check(await errOf(P, { t: 'gm', op: { op: 'give', item: 'ticket', to: 'zorro' } }) === 'refused', 'unknown character → refused');
  check(await errOf(S, { t: 'gm', op: { op: 'give', item: 'ticket', to: 'sol' } }) === 'not-host', 'give from a non-host → not-host');
  check(await errOf(P, { t: 'gm', op: { op: 'unlock', node: 'hub' } }) === null, 'other no-op gm ops stay silent');
  i = T.mark(); gm(P, { op: 'take', item: 'ticket', from: 'sol' });
  await until(T, (x) => !x.facts.inventory.sol?.ticket, i);
  check(!inv(T).sol || !('ticket' in inv(T).sol), 'host takes it back: a count of 0 is removed');

  // ---------- all: the photo goes to every non-left member, never to someone who left ----------
  const { c: A, id: idA } = await player('A', 'anna');
  i = T.mark(); A.send({ t: 'leave' });
  await until(T, (x) => x.party.players[idA]?.left, i);
  i = T.mark();
  gm(P, { op: 'unlock', node: 'teens' });
  gm(P, { op: 'count', counter: 'node.teens.scene.finished', set: 1 }); // the scene "seen"
  k = await until(T, (x) => x.facts.done.includes('teens.scene'), i);
  const photo = ['pierre', 'elodie', 'sol'].map((ch) => k.facts.inventory[ch]?.photo ?? 0);
  check(photo.every((n) => n === 1) && !k.facts.inventory.anna?.photo, `teens.scene done → a photo for every present member (${photo}), none for Anna who left`);
  await restart('after the photos');

  // ---------- winner: the quiz ticket goes to rank 1 ----------
  i = T.mark();
  gm(P, { op: 'unlock', node: 'childhood' });
  gm(P, { op: 'unlock', node: QUIZ });
  gm(P, { op: 'goto', node: QUIZ });
  await T.waitFor((m) => m.t === 'view' && quizOf(m)?.phase === 'lobby', i);
  await playQuiz(P, [{ c: P, right: true }, { c: E, right: false }, { c: S, right: false }], T);
  k = await until(T, (x) => x.facts.done.includes(QUIZ));
  check(k.facts.inventory.pierre?.ticket === 1 && !k.facts.inventory.elodie?.ticket && !k.facts.inventory.sol?.ticket, 'quiz won by Pierre → the ticket to the winner only');
  await restart('after the quiz reward');

  // ---------- winner tie (a fresh evening: rewards apply once per node) ----------
  for (const c of [P, E, S, T]) c.ws.close();
  await kill9(); await boot(true);
  ({ c: P, id: idP } = await player('P', 'pierre'));
  ({ c: E, id: idE } = await player('E', 'elodie'));
  ({ c: S, id: idS } = await player('S', 'sol'));
  T = await screen();
  i = T.mark();
  gm(P, { op: 'unlock', node: 'childhood' }); gm(P, { op: 'unlock', node: QUIZ }); gm(P, { op: 'goto', node: QUIZ });
  await T.waitFor((m) => m.t === 'view' && quizOf(m)?.phase === 'lobby', i);
  // P and E answer right at the same moment → same points → a tie at rank 1
  await playQuiz(P, [{ c: P, right: true }, { c: E, right: true }, { c: S, right: false }], T);
  k = await until(T, (x) => x.facts.done.includes(QUIZ));
  const ranks = quizOf([...T.msgs].reverse().find((m) => m.t === 'view' && quizOf(m)));
  const tie = ranks.players[idP].score === ranks.players[idE].score;
  const tickets = [k.facts.inventory.pierre?.ticket ?? 0, k.facts.inventory.elodie?.ticket ?? 0, k.facts.inventory.sol?.ticket ?? 0];
  check(tie ? tickets.join() === '1,1,0' : tickets.filter((n) => n === 1).length === 1,
    tie ? `a tie at rank 1 → a ticket for EVERY co-winner (${tickets})` : `no exact tie this run (speed bonus differed by a ms): one winner, one ticket (${tickets})`);

  // ---------- an older save: flat facts.items migrate to the chooser ----------
  for (const c of [P, E, S, T]) c.ws.close();
  await kill9();
  const FILE = join(VAR, 'bloko.state.json');
  const env = JSON.parse(readFileSync(FILE, 'utf8'));
  delete env.campaign.facts.inventory;
  env.campaign.facts.items = ['old-key', 'unicorn']; // pre-Contract F shape; an unknown item is dropped
  writeFileSync(FILE, JSON.stringify(env));
  await boot();
  T = await screen();
  const migrated = inv(T);
  check(migrated.elodie?.['old-key'] === 1 && !JSON.stringify(migrated).includes('unicorn') && !('items' in camp(T).facts),
    `old save: flat items → the chooser's inventory, unknown items dropped (${JSON.stringify(migrated)})`);
  T.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).stack ?? e}\n--- server log ---\n${log}`);
} finally {
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
