// Campaign end-to-end (slice 3, server side): the false start → 3 block games → reward + two worlds
// unlocked at once → news acked by seq with TWO TVs → doors (the chooser walks in, edge-triggered) →
// host back/enter/gm — with a kill -9 + restart after every step that must resume the SAME evening and
// never count a game twice. Uses the placeholder SAMPLE_CONTENT (shared/campaign/sample.js).
// Runs its OWN server (child process on PORT, scratch BLOKO_VAR) so it can kill -9 it.
// Usage: PORT=3186 node scripts/e2e-campaign.mts      (never 3131: that's the live server)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, Client, finish, HTTP, sleep } from './e2e-lib.mts';

const PORT = process.env.PORT ?? '3141';
if (PORT === '3131') throw new Error('3131 is the live server: pick another PORT');
const VAR = mkdtempSync(join(tmpdir(), 'bloko-campaign-'));
const MAIN = new URL('../server/main.ts', import.meta.url).pathname;

let server: ChildProcess | null = null;
let log = '';
async function boot(fresh = false): Promise<void> {
  log = '';
  server = spawn(process.execPath, [MAIN, ...(fresh ? ['--new'] : [])], {
    env: { ...process.env, PORT, BLOKO_VAR: VAR, BLOKO_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => { log += d; });
  server.stderr!.on('data', (d) => { log += d; });
  for (let k = 0; k < 100; k++) {
    try { await fetch(`${HTTP}/api/join`); return; } catch { await sleep(50); }
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
const roomCode = async (): Promise<string> => (await (await fetch(`${HTTP}/api/join`)).json()).code;

/** The last campaign a client saw. */
const camp = (c: Client): any => [...c.msgs].reverse().find((m) => m.t === 'view')?.campaign;
/** Waits for a view whose campaign satisfies `pred`. */
const until = async (c: Client, pred: (k: any) => boolean, from = 0, ms = 3000) =>
  (await c.waitFor((m) => m.t === 'view' && !!m.campaign && pred(m.campaign), from, ms)).campaign;
/** The persisted part of the evening, comparable across a restart (the seed is checked on its own). */
const core = (k: any) => JSON.stringify({
  // a timed game's deadline moves by the downtime on purpose (checked on its own)
  at: { ...k.at, activity: k.at.activity && { ...k.at.activity, deadline: null } },
  party: k.party, facts: k.facts, news: k.news, newsSeq: k.newsSeq,
});
const errOf = async (c: Client, msg: object): Promise<string | null> => {
  const i = c.mark();
  c.send(msg);
  try { return (await c.waitFor((m) => m.t === 'err', i, 600)).code; } catch { return null; }
};

let room = '';
async function player(label: string, character: string): Promise<{ c: Client, id: string }> {
  const c = new Client(label); await c.open();
  c.send({ t: 'hello', role: 'player', room });
  const i = c.mark();
  c.send({ t: 'join', character });
  const id = (await c.waitFor((m) => m.t === 'welcome', i)).playerId;
  return { c, id };
}
async function rejoin(label: string, playerId: string): Promise<Client> {
  const c = new Client(label); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'player', playerId });
  await c.waitFor((m) => m.t === 'welcome' && m.playerId === playerId, i);
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}
async function screen(label: string): Promise<Client> {
  const c = new Client(label); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'screen' });
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}

let P: Client, E: Client, T1: Client, T2: Client;
let idP = '', idE = '';
/** kill -9 + restart: the evening must come back byte for byte (persisted part), same room. */
/** Paths where two JSON values differ (first `max`), for a readable failure. */
function diff(a: any, b: any, path = '', out: string[] = [], max = 12): string[] {
  if (out.length >= max || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[key], b[key], `${path}.${key}`, out, max);
  } else {
    out.push(`${path || '.'}: ${JSON.stringify(a)?.slice(0, 80)} → ${JSON.stringify(b)?.slice(0, 80)}`);
  }
  return out;
}
const saved = () => JSON.parse(readFileSync(join(VAR, 'bloko.state.json'), 'utf8')).campaign;

/** Every client has received the latest broadcast (they all show the same evening). A step is awaited
 *  on ONE client; the others may still be a broadcast behind, so `before` is taken only once all agree. */
async function converged(): Promise<any> {
  const clients = () => [P, E, T1, T2];
  for (let k = 0; k < 100; k++) {
    const views = clients().map((c) => core(camp(c)));
    if (views.every((x) => x === views[0])) return camp(T1);
    await sleep(20);
  }
  throw new Error(`clients never converged: ${clients().map((c) => c.label).join(', ')}`);
}

async function restartSame(step: string): Promise<void> {
  const before = await converged();
  // the server saves BEFORE it broadcasts: whatever every client sees is already on disk
  const disk = saved();
  const onDisk = core(disk) === core(before);
  if (!onDisk) console.log(`  [${step}] disk ≠ what every client sees:\n    ${diff(JSON.parse(core(before)), JSON.parse(core(disk))).join('\n    ')}`);
  check(onDisk && disk.seed === before.seed, `${step}: what every client sees is already saved (before the kill)`);
  await kill9();
  await boot();
  for (const c of [P, E, T1, T2]) c?.ws.close();
  P = await rejoin('P', idP);
  E = await rejoin('E', idE);
  T1 = await screen('T1');
  T2 = await screen('T2');
  const same = core(camp(T1)) === core(before);
  if (!same) console.log(`  [${step}] resumed ≠ before (T1's last view):\n    ${diff(JSON.parse(core(before)), JSON.parse(core(camp(T1)))).join('\n    ')}`);
  check(same && (await roomCode()) === room, `kill -9 ${step} → same evening resumed`);
  check(camp(T1).seed === before.seed, `kill -9 ${step} → same campaign seed (next games deal the same)`);
}

const played = (k: any) => k.facts.counters['blocks.played'] ?? 0;

/** Host starts a block game and ends it at once (endGame counts as a game played, A1). */
async function playOne(n: number): Promise<void> {
  let i = P.mark();
  P.send({ t: camp(P).at.activity.phase === 'lobby' ? 'start' : 'again' });
  await P.waitFor((m) => m.t === 'view' && m.state?.phase === 'playing', i);
  i = P.mark();
  P.send({ t: 'endGame' });
  const k = await until(P, (x) => x.at.activity?.phase === 'finished', i);
  check(played(k) === n && k.at.activity.endReason === 'host', `block game ${n} ended by the host → blocks.played = ${played(k)}`);
}

try {
  await boot(true);
  room = await roomCode();

  // ---------- a new evening: the false start ----------
  ({ c: P, id: idP } = await player('P', 'pierre')); // the host (first in)
  ({ c: E, id: idE } = await player('E', 'elodie')); // the chooser, not the host
  T1 = await screen('T1');
  T2 = await screen('T2');
  let k = await until(T1, (x) => x.party.order.length === 2);
  check(k.v === 1 && k.at.node === 'hub.false-start' && k.at.activity?.phase === 'lobby', 'new evening starts AT the false-start blocks tableau, block lobby open');
  check(k.party.hostId === idP && k.at.activity.hostId === idP && k.at.activity.order.join() === `${idP},${idE}`, 'party = both phones, host = first in, both seated in the block lobby');
  const v = T1.msgs.findLast((m) => m.t === 'view');
  check(JSON.stringify(v.state) === JSON.stringify(v.campaign.at.activity), 'view: state = campaign.at.activity (old clients keep working)');
  check(!k.facts.unlocked.includes('childhood') && k.news.length === 0, 'worlds locked, no news yet');
  await restartSame('in the false-start lobby');

  // ---------- 3 block games; a kill -9 mid-game and on each podium never double-counts ----------
  await playOne(1);
  await restartSame('on podium 1');
  check(played(camp(T1)) === 1, 'podium 1 after restart: still 1 game played (counted once)');
  let i = P.mark(); P.send({ t: 'again' });
  await P.waitFor((m) => m.t === 'view' && m.state?.phase === 'playing', i);
  await restartSame('mid-game 2 (playing)');
  check(played(camp(T1)) === 1, 'mid-game restart counts nothing');
  check(await errOf(P, { t: 'back' }) === 'refused', 'back while a game is played → refused (endGame first)');
  i = P.mark(); P.send({ t: 'endGame' });
  k = await until(P, (x) => x.at.activity?.phase === 'finished', i);
  check(played(k) === 2, 'block game 2 → blocks.played = 2');
  await restartSame('on podium 2');
  await playOne(3);

  // ---------- the unlock: reward + two worlds AT ONCE, queued as news ----------
  k = camp(T1);
  const kinds = k.news.map((n: any) => (n.t === 'unlocked' ? `unlocked:${n.node}` : `${n.t}:${n.item}`));
  check(k.facts.done.includes('hub.false-start') && k.facts.inventory.elodie?.['old-key'] === 1 && k.facts.flags.includes('false-start-over'),
    "false start done → the old key in the CHOOSER's inventory (Élodie) + flag");
  check(!k.facts.inventory.pierre?.['old-key'], '…and nobody else got it (the host is not the chooser)');
  check(k.facts.unlocked.includes('childhood') && k.facts.unlocked.includes('teens') && !k.facts.unlocked.includes('adult'), 'childhood AND teens unlocked at once; adult still locked');
  check(kinds.includes('unlocked:childhood') && kinds.includes('unlocked:teens') && kinds.includes('item:old-key'), `news queued: ${kinds.join(', ')}`);
  check(k.news.every((n: any, j: number) => n.seq === j + 1) && k.newsSeq === k.news.length, 'news seq = 1, 2, 3… (newsSeq = last handed out)');
  await restartSame('on podium 3 with news pending');
  check(core(camp(T2)) === core(camp(T1)), 'both TVs see the same news');

  // ---------- acks by seq, two TVs ----------
  const all = camp(T1).news.length;
  i = T1.mark(); P.send({ t: 'ack', upTo: 99 }); await sleep(300);
  check(camp(T1).news.length === all, 'ack from a phone → ignored (screens only)');
  T1.send({ t: 'ack' }); await sleep(300);
  check(camp(T1).news.length === all, 'ack without upTo → ignored');
  i = T1.mark(); T1.send({ t: 'ack', upTo: 1 });
  k = await until(T1, (x) => x.news.length === all - 1, i);
  check(k.news.every((n: any) => n.seq > 1), 'TV 1 acks upTo 1 → only seq 1 leaves the queue');
  await restartSame('between two acks');
  i = T2.mark(); T2.send({ t: 'ack', upTo: 1 }); await sleep(300);
  check(camp(T2).news.length === all - 1, 'TV 2 acks the same seq again → no-op (nothing lost)');
  i = T2.mark(); T2.send({ t: 'ack', upTo: all });
  k = await until(T2, (x) => x.news.length === 0, i);
  check(k.newsSeq === all, 'TV 2 acks the rest → queue empty, newsSeq kept (seqs never reused)');
  await restartSame('after the acks');

  // ---------- host back to the hub; doors ----------
  check(await errOf(E, { t: 'back' }) === 'not-host', 'non-host back → not-host');
  i = P.mark(); P.send({ t: 'back' });
  k = await until(P, (x) => x.at.node === 'hub', i);
  check(k.at.activity === null && T1.msgs.findLast((m) => m.t === 'view').state === null, 'host back → hub, no block game (view state null)');
  await restartSame('on the hub');

  const at = () => camp(T1).at.node;
  const step = async (c: Client, p: { x: number, y: number }) => { c.send({ t: 'pos', ...p, dir: 'up', moving: true }); await sleep(250); };
  // door points come from the served content, so a content edit never breaks this test
  const content = await (await fetch(`${HTTP}/api/content`)).json();
  const door = (id: string, fx = 0.5, fy = 0.5) => { const d = content.nodes[id].door; return { x: d.x + d.w * fx, y: d.y + d.h * fy }; };
  const floor = { x: 8, y: 7.5 }; // open floor, below every door (doors sit on the back wall)
  check(Object.values<any>(content.nodes).every((n) => !n.door || n.door.y + n.door.h < floor.y), 'the "open floor" point is outside every door');
  await step(E, floor); // first known positions: open floor (a first pos only sets the baseline)
  await step(P, floor);
  await step(E, door('adult')); // adult's door: still locked
  check(at() === 'hub', 'chooser walks into a LOCKED door → nothing');
  await step(P, door('childhood')); // the host walks into childhood's door: only the chooser's walk enters
  check(at() === 'hub', 'non-chooser walks into an unlocked door → nothing (the host enters by command)');
  const zoneCount = (z: string, ch: string) => Object.entries(camp(T1).facts.counters).find(([key]) => key.includes(z) && key.includes(ch))?.[1] ?? 0;
  check(zoneCount('childhood', 'pierre') === 1, 'the host stepping in is still recorded (zone.entered, counted once)');
  await step(P, door('childhood', 0.7, 0.7)); // still inside: no second count
  check(zoneCount('childhood', 'pierre') === 1, 'standing in a door → no second zone.entered (edge-triggered)');
  await step(E, door('childhood')); // Élodie walks into childhood's door
  check(at() === 'childhood', 'chooser walks into an unlocked door → the party enters that world');
  await restartSame('in a world');
  i = P.mark(); P.send({ t: 'back' }); await until(P, (x) => x.at.node === 'hub', i);
  await step(E, door('childhood', 0.6, 0.6)); // still standing on the door after coming back: not a fresh step in
  check(at() === 'hub', 'back on the hub while standing on the door → no re-entry (edge-triggered)');
  await step(E, floor); // out…
  await step(E, door('childhood')); // …and in again
  check(at() === 'childhood', 'step out and back in → enters again');
  i = P.mark(); P.send({ t: 'back' }); await until(P, (x) => x.at.node === 'hub', i);

  // ---------- host enter / refused enter / gm ----------
  check(await errOf(P, { t: 'enter', node: 'adult' }) === 'refused', 'host enter on a locked world → refused');
  check(await errOf(E, { t: 'gm', op: { op: 'unlock', node: 'adult' } }) === 'not-host', 'gm from a non-host → not-host');
  i = T1.mark(); P.send({ t: 'gm', op: { op: 'unlock', node: 'adult' } });
  k = await until(T1, (x) => x.facts.unlocked.includes('adult'), i);
  check(k.news.some((n: any) => n.t === 'unlocked' && n.node === 'adult' && n.seq === all + 1), 'gm unlock → adult open, news seq continues');
  i = P.mark(); P.send({ t: 'enter', node: 'teens' });
  await until(P, (x) => x.at.node === 'teens', i);
  i = P.mark(); P.send({ t: 'enter', node: 'teens.blocks' });
  k = await until(P, (x) => x.at.node === 'teens.blocks', i);
  check(k.at.activity?.phase === 'lobby' && k.at.activity.settings.mode === 'timed' && k.at.activity.order.length === 2,
    "host enters a world's blocks tableau → its lobby with the node's settings (timed), the whole party seated");
  i = P.mark(); P.send({ t: 'start' });
  await P.waitFor((m) => m.t === 'view' && m.state?.phase === 'playing', i);
  const deadline = camp(T1).at.activity.deadline;
  await restartSame('in a timed world game');
  const after = camp(T1).at.activity;
  check(after.phase === 'playing' && after.deadline >= deadline, 'timed world game resumed, its deadline shifted by the downtime (never shortened)');

  // ---------- a newcomer mid-evening ----------
  const { c: N, id: idN } = await player('N', 'anna');
  k = await until(T1, (x) => !!x.party.players[idN]);
  check(!k.at.activity.players[idN], 'newcomer during a game joins the evening and watches (not seated)');
  i = P.mark(); P.send({ t: 'endGame' }); await until(P, (x) => x.at.activity?.phase === 'finished', i);
  i = P.mark(); P.send({ t: 'newGame' });
  k = await until(P, (x) => x.at.activity?.phase === 'lobby', i);
  check(!!k.at.activity.players[idN], '…and is seated in the next block lobby');
  N.ws.close();

  for (const c of [P, E, T1, T2]) c.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).stack ?? e}\n--- server log ---\n${log}`);
} finally {
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
