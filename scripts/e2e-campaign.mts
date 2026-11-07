// Campaign end-to-end (slice 3, server side): the false start → 3 block rounds in one run of its minigame → reward + two worlds
// unlocked at once → news acked by seq with TWO TVs → doors (the chooser walks in, edge-triggered) →
// game master back/enter/gm — with a kill -9 + restart after every step that must resume the SAME evening and
// never count a game twice. Then chat, emotes and object actions: relay, history, rate limits, and where
// interact works. Uses the placeholder SAMPLE_CONTENT (shared/campaign/sample.js).
// Runs its OWN server (child process on PORT, scratch BLOKO_VAR) so it can kill -9 it.
// Usage: PORT=3186 node scripts/e2e-campaign.mts      (never 3131: that's the live server)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backToLobby, blocksOf, check, Client, endMinigame, finish, HTTP, lobbyOf, quizOf, roomOf, roundTrip, settled, sleep, startRound } from './e2e-lib.mts';

const PORT = process.env.PORT ?? '3141';
if (PORT === '3131') throw new Error('3131 is the live server: pick another PORT');
const VAR = mkdtempSync(join(tmpdir(), 'bloko-campaign-'));
const MAIN = new URL('../server/main.ts', import.meta.url).pathname;

let server: ChildProcess | null = null;
let log = '';
async function boot(fresh = false): Promise<void> {
  log = '';
  server = spawn(process.execPath, [MAIN, ...(fresh ? ['--new'] : [])], {
    env: { ...process.env, PORT, BLOKO_VAR: VAR, BLOKO_HOST: '127.0.0.1', ITLOE_CONTENT: 'sample' },
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

/** A view's campaign with its minigame's view where the save keeps the minigame (`at.activity`), comparable with the save. */
const campaignOf = (m: any): any => m?.campaign && { ...m.campaign, at: { ...m.campaign.at, activity: m.minigame?.view ?? null } };
/** The block round in a campaign (running, or on its podium), or undefined. */
const roundIn = (k: any): any => k.at.activity?.round ?? undefined;
/** The last campaign a client saw. */
const camp = (c: Client): any => campaignOf([...c.msgs].reverse().find((m) => m.t === 'view'));
/** Waits for a view whose campaign satisfies `pred`. */
const until = async (c: Client, pred: (k: any) => boolean, from = 0, ms = 3000) =>
  campaignOf(await c.waitFor((m) => m.t === 'view' && !!m.campaign && pred(campaignOf(m)), from, ms));
/** The persisted part of the evening, comparable across a restart (the seed is checked on its own). */
const core = (k: any) => JSON.stringify({
  // the plain lobby's view leaves out its seed; a round's view adds "best" in solo games; a timed game's deadline
  // moves by the downtime on purpose (checked on its own)
  at: { node: k.at.node, kind: k.at.kind, results: k.at.results, activity: k.at.activity && {
    stage: k.at.activity.stage, settings: k.at.activity.settings, players: k.at.activity.players, ready: k.at.activity.ready,
    round: k.at.activity.round && { ...k.at.activity.round, deadline: null, best: undefined } } },
  party: k.party, facts: k.facts, news: k.news, newsSeq: k.newsSeq,
});
/** The err `msg` is answered with (every use expects one: waiting long costs a normal run nothing), or null. */
const errOf = async (c: Client, msg: object): Promise<string | null> => {
  const i = c.mark();
  c.send(msg);
  try { return (await c.waitFor((m) => m.t === 'err', i, 5000)).code; } catch { return null; }
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
  check(onDisk, `${step}: what every client sees is already saved (before the kill)`);
  check(!('seed' in before), `${step}: the campaign on the wire carries no seed (it tells the next dice)`);
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
  check(saved().seed === disk.seed, `kill -9 ${step} → same campaign seed (next games deal the same)`);
}

const played = (k: any) => k.facts.counters['blocks.played'] ?? 0;

/** The game master starts a block round (and the minigame, unless it runs) and ends it at once (endGame counts as
 *  a round played): the podium of round `n`, its result kept, nothing recorded yet. */
async function playOne(n: number): Promise<void> {
  await startRound(P, [P, E]);
  const i = P.mark();
  const tvFrom = T1.mark();
  P.send({ t: 'endGame' });
  const k = await until(P, (x) => roundIn(x)?.phase === 'finished', i);
  await until(T1, (x) => roundIn(x)?.phase === 'finished' && x.at.results.length === n, tvFrom);
  check(k.at.results.length === n && played(k) === 0 && roundIn(k).endReason === 'gm',
    `block round ${n} ended by the game master → its result kept (${k.at.results.length}), blocks.played still 0 until the end`);
}

try {
  await boot(true);
  room = await roomCode();

  // ---------- a new evening: the false start ----------
  ({ c: P, id: idP } = await player('P', 'pierre')); // the game master
  ({ c: E, id: idE } = await player('E', 'elodie')); // the chooser, not the game master
  T1 = await screen('T1');
  T2 = await screen('T2');
  let k = await until(T1, (x) => x.party.order.length === 2);
  check(k.v === 1 && k.at.node === 'hub.false-start' && k.at.kind === 'blocks' && k.at.activity === null,
    'new evening starts AT the false-start blocks tableau, in its room (no round yet)');
  check(T1.lastGm() === idP && roomOf(T1.msgs.findLast((m) => m.t === 'view')).order.join() === `${idP},${idE}`,
    'party = both phones, game master = Pierre, both in the room');
  check(!k.facts.unlocked.includes('childhood') && k.news.length === 0, 'worlds locked, no news yet');
  await restartSame('in the room at the false start');

  // ---------- 3 block rounds in one run; a kill -9 in the lobby, mid-game and on each podium never double-counts ----------
  await playOne(1);
  const v = T1.msgs.findLast((m) => m.t === 'view');
  check(v.minigame?.kind === 'blocks' && v.minigame.status === 'podium' && v.minigame.view.round.order.join() === `${idP},${idE}`
    && JSON.stringify(v.minigame.view.round) === JSON.stringify(saved().at.activity.round) && !('activity' in v.campaign.at),
    'view: the minigame carries the block round (both seated); the campaign on the wire carries no raw minigame state');
  await restartSame('on podium 1');
  check(camp(T1).at.results.length === 1 && played(camp(T1)) === 0, 'podium 1 after restart: its result still kept once, nothing recorded');
  await backToLobby(P);
  await restartSame('in the lobby');
  check(camp(T1).at.activity.ready.join() === `${idP},${idE}`, 'the lobby after restart: both still ready');
  let i = P.mark(); P.send({ t: 'start' });
  await P.waitFor((m) => m.t === 'view' && blocksOf(m)?.phase === 'playing', i);
  await restartSame('mid-game 2 (playing)');
  check(camp(T1).at.results.length === 1, 'mid-game restart keeps nothing more');
  check(await errOf(P, { t: 'endMinigame' }) === 'refused', 'endMinigame while a round is played → refused (endGame first)');
  i = P.mark(); P.send({ t: 'endGame' });
  k = await until(P, (x) => roundIn(x)?.phase === 'finished', i);
  check(k.at.results.length === 2 && played(k) === 0, 'block round 2 → 2 results kept');
  await restartSame('on podium 2');
  await backToLobby(P);
  await playOne(3);
  await backToLobby(P);
  i = T1.mark();
  await endMinigame(P);
  k = await until(T1, (x) => x.at.activity === null, i);
  check(played(k) === 3 && k.at.results.length === 0 && !!roomOf(T1.msgs.findLast((m) => m.t === 'view')),
    'game master ends the minigame → the three rounds recorded at once (blocks.played = 3), the room at the tableau');

  // ---------- the unlock: reward + two worlds AT ONCE, queued as news ----------
  k = camp(T1);
  const kinds = k.news.map((n: any) => (n.t === 'unlocked' ? `unlocked:${n.node}` : `${n.t}:${n.item}`));
  check(k.facts.done.includes('hub.false-start') && k.facts.inventory.elodie?.['old-key'] === 1 && k.facts.flags.includes('false-start-over'),
    "false start done → the old key in the CHOOSER's inventory (Élodie) + flag");
  check(!k.facts.inventory.pierre?.['old-key'], '…and nobody else got it (the game master is not the chooser)');
  check(k.facts.unlocked.includes('childhood') && k.facts.unlocked.includes('teens') && !k.facts.unlocked.includes('adult'), 'childhood AND teens unlocked at once; adult still locked');
  check(kinds.includes('unlocked:childhood') && kinds.includes('unlocked:teens') && kinds.includes('item:old-key'), `news queued: ${kinds.join(', ')}`);
  check(k.news.every((n: any, j: number) => n.seq === j + 1) && k.newsSeq === k.news.length, 'news seq = 1, 2, 3… (newsSeq = last handed out)');
  await restartSame('in the room with news pending');
  check(core(camp(T2)) === core(camp(T1)), 'both TVs see the same news');

  // ---------- acks by seq, two TVs ----------
  const all = camp(T1).news.length;
  i = T1.mark(); P.send({ t: 'ack', upTo: 99 }); await settled([P], [T1]);
  check(camp(T1).news.length === all, 'ack from a phone → ignored (screens only)');
  T1.send({ t: 'ack' }); await settled([T1], [T1]);
  check(camp(T1).news.length === all, 'ack without upTo → ignored');
  i = T1.mark(); T1.send({ t: 'ack', upTo: 1 });
  k = await until(T1, (x) => x.news.length === all - 1, i);
  check(k.news.every((n: any) => n.seq > 1), 'TV 1 acks upTo 1 → only seq 1 leaves the queue');
  await restartSame('between two acks');
  i = T2.mark(); T2.send({ t: 'ack', upTo: 1 }); await settled([T2], [T2]);
  check(camp(T2).news.length === all - 1, 'TV 2 acks the same seq again → no-op (nothing lost)');
  i = T2.mark(); T2.send({ t: 'ack', upTo: all });
  k = await until(T2, (x) => x.news.length === 0, i);
  check(k.newsSeq === all, 'TV 2 acks the rest → queue empty, newsSeq kept (seqs never reused)');
  await restartSame('after the acks');

  // ---------- game master back to the hub; doors ----------
  check(await errOf(E, { t: 'back' }) === 'not-gm', 'non-game-master back → not-gm');
  i = P.mark(); P.send({ t: 'back' });
  k = await until(P, (x) => x.at.node === 'hub', i);
  check(k.at.activity === null && T1.msgs.findLast((m) => m.t === 'view').minigame === null, 'game master back → hub, no minigame (view minigame null)');
  await restartSame('on the hub');

  const at = () => camp(T1).at.node;
  /** A walker's step; what it caused (a door entered, a zone counted) has reached T1 when it returns. */
  const step = async (c: Client, p: { x: number, y: number }) => { c.send({ t: 'pos', ...p, dir: 'up', moving: true }); await settled([c], [T1]); };
  // door points come from the served content, so a content edit never breaks this test
  const content = await (await fetch(`${HTTP}/api/content`)).json();
  const door = (id: string, fx = 0.5, fy = 0.5) => { const d = content.nodes[id].door; return { x: d.x + d.w * fx, y: d.y + d.h * fy }; };
  const floor = { x: 8, y: 7.5 }; // open floor, below every door (doors sit on the back wall)
  check(Object.values<any>(content.nodes).every((n) => !n.door || n.door.y + n.door.h < floor.y), 'the "open floor" point is outside every door');
  await step(E, floor); // first known positions: open floor (a first pos only sets the baseline)
  await step(P, floor);
  await step(E, door('adult')); // adult's door: still locked
  check(at() === 'hub', 'chooser walks into a LOCKED door → nothing');
  await step(P, door('childhood')); // the game master walks into childhood's door: only the chooser's walk enters
  check(at() === 'hub', 'non-chooser walks into an unlocked door → nothing (the game master enters by command)');
  const zoneCount = (z: string, ch: string) => Object.entries(camp(T1).facts.counters).find(([key]) => key.includes(z) && key.includes(ch))?.[1] ?? 0;
  check(zoneCount('childhood', 'pierre') === 1, 'the game master stepping in is still recorded (zone.entered, counted once)');
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

  // ---------- game master enter / refused enter / gm ----------
  check(await errOf(P, { t: 'enter', node: 'adult' }) === 'refused', 'game master enter on a locked world → refused');
  check(await errOf(E, { t: 'gm', op: { op: 'unlock', node: 'adult' } }) === 'not-gm', 'gm from a non-game-master → not-gm');
  i = T1.mark(); P.send({ t: 'gm', op: { op: 'unlock', node: 'adult' } });
  k = await until(T1, (x) => x.facts.unlocked.includes('adult'), i);
  check(k.news.some((n: any) => n.t === 'unlocked' && n.node === 'adult' && n.seq === all + 1), 'gm unlock → adult open, news seq continues');
  i = P.mark(); P.send({ t: 'enter', node: 'teens' });
  await until(P, (x) => x.at.node === 'teens', i);
  i = P.mark(); P.send({ t: 'enter', node: 'teens.blocks' });
  k = await until(P, (x) => x.at.node === 'teens.blocks', i);
  check(k.at.activity === null && roomOf(P.msgs.findLast((m) => m.t === 'view')).order.length === 2,
    "game master enters a world's blocks tableau → its room, the whole party there");
  i = P.mark(); P.send({ t: 'startMinigame' });
  const timedLobby = lobbyOf(await P.waitFor((m) => m.t === 'view' && !!lobbyOf(m), i));
  check(timedLobby.settings.mode === 'timed' && timedLobby.players.length === 2, '…its minigame starts with the node\'s settings (timed), both eligible');
  const timedStart = await startRound(P, [P, E]);
  check(blocksOf(timedStart).order.length === 2, '…and the round starts with both seated');
  const deadline = blocksOf(timedStart).deadline;
  await restartSame('in a timed world game');
  const after = roundIn(camp(T1));
  check(after.phase === 'playing' && after.deadline >= deadline, 'timed world game resumed, its deadline shifted by the downtime (never shortened)');

  // ---------- a newcomer mid-evening ----------
  const { c: N, id: idN } = await player('N', 'anna');
  k = await until(T1, (x) => !!x.party.players[idN]);
  check(!roundIn(k).players[idN], 'newcomer during a game joins the evening and watches (not seated)');
  i = P.mark(); P.send({ t: 'endGame' }); await until(P, (x) => roundIn(x)?.phase === 'finished', i);
  const lobbyView = lobbyOf(await backToLobby(P));
  check(lobbyView.players.some((p: any) => p.id === idN) && !lobbyView.ready.includes(idN),
    '…and is in the lobby after the round, not ready (plays from a later start, below)');
  N.ws.close();

  // ---------- chat, emotes and object actions, as they work today ----------
  let N2 = await rejoin('N2', idN); // back online: the quiz below reveals once every seated player answered
  i = T1.mark();
  await endMinigame(P);
  k = await until(T1, (x) => x.at.activity === null, i);
  check(played(k) === 4, 'game master ends the world\'s minigame → its round recorded (blocks.played = 4), the room');
  const everyone = () => [P, E, N2, T1, T2];
  const marks = () => everyone().map((c) => c.mark());
  /** Once what `senders` sent has settled: the first `t` event each client got since `from`, or null for a
   *  client that got none. */
  const relayed = async (t: string, from: number[], senders: Client[]) => {
    await settled(senders, everyone());
    return everyone().map((c, j) => c.since(from[j]).find((m) => m.t === t) ?? null);
  };
  const none = async (t: string, from: number[], senders: Client[]) => (await relayed(t, from, senders)).every((m) => m === null);
  const GAP = 700; // past the per-socket limits: say and emote one per 650 ms, interact one per 700 ms
  const cooldown = async (playerId: string, kind: 'social' | 'interact') => {
    const last = T1.msgs.findLast((m) => m.playerId === playerId
      && (kind === 'interact' ? m.t === 'interact' : m.t === 'say' || m.t === 'emote'));
    const remaining = (last?.at ?? 0) + GAP - Date.now();
    if (remaining > 0) await sleep(remaining);
  };

  let from = marks();
  let t0 = Date.now();
  E.send({ t: 'say', text: '  Bonne\n  fête\tÉlodie !  ' });
  let got = await relayed('say', from, [E]);
  check(got.every((m) => m?.playerId === idE && m.text === 'Bonne fête Élodie !' && m.at >= t0 && m.at <= Date.now()),
    'say → relayed to every client, screens and phones (the sender too), with playerId, the cleaned text and at');
  const stranger = new Client('stranger'); await stranger.open();
  stranger.send({ t: 'hello', role: 'player', room });
  await stranger.waitFor((m) => m.t === 'view');
  await cooldown(idE, 'social');
  from = marks();
  stranger.send({ t: 'say', text: 'intrus' }); stranger.send({ t: 'emote', kind: 'victory' });
  T1.send({ t: 'say', text: 'écran' }); T1.send({ t: 'emote', kind: 'victory' });
  check(await none('say', from, [stranger, T1]) && await none('emote', from, [stranger, T1]), 'say and emote from a socket that is not a party member (a stranger, a TV) → dropped');
  from = marks();
  for (const text of ['é'.repeat(101), '', '   ', '\u0007\u0007', 42]) E.send({ t: 'say', text });
  check(await none('say', from, [E]), 'say with over-long (101 characters), empty, blank, control-only or non-string text → dropped');
  await cooldown(idE, 'social');
  from = marks();
  E.send({ t: 'say', text: '🎂'.repeat(100) });
  got = await relayed('say', from, [E]);
  check(got.every((m) => m?.text === '🎂'.repeat(100)), 'say with 100 characters (counted as code points) → relayed');

  await cooldown(idE, 'social');
  i = T1.mark();
  E.send({ t: 'say', text: 'un' }); E.send({ t: 'say', text: 'deux' }); E.send({ t: 'emote', kind: 'victory' });
  P.send({ t: 'say', text: 'trois' });
  await settled([E, P], [T1]);
  const burst = T1.since(i).filter((m) => m.t === 'say' || m.t === 'emote').map((m) => m.text ?? m.kind);
  check(burst.join() === 'un,trois', `rate limit: one say or emote per 650 ms per socket; a second say and an emote right after are dropped, another phone is not held back (${burst.join()})`);
  await cooldown(idE, 'social');
  from = marks();
  E.send({ t: 'say', text: 'quatre' });
  check((await relayed('say', from, [E])).every((m) => m?.text === 'quatre'), '…and after 650 ms the same phone speaks again');

  await cooldown(idN, 'social');
  from = marks();
  t0 = Date.now();
  N2.send({ t: 'emote', kind: 'annoy' });
  got = await relayed('emote', from, [N2]);
  check(got.every((m) => m?.playerId === idN && m.kind === 'annoy' && m.at >= t0), 'emote → relayed to every client with playerId, kind and at');
  await cooldown(idN, 'social');
  from = marks();
  N2.send({ t: 'emote', kind: 'dance' }); N2.send({ t: 'emote' });
  check(await none('emote', from, [N2]), 'emote of an unknown kind (or none) → dropped');

  // the history keeps the last 30 lines: 33 lines from three phones, each at its own pace
  for (let n = 0; n < 11; n++) {
    await Promise.all([idP, idE, idN].map((id) => cooldown(id, 'social')));
    const start = T1.mark();
    for (const [j, c] of [P, E, N2].entries()) c.send({ t: 'say', text: `ligne ${n * 3 + j}` });
    await Promise.all([0, 1, 2].map((j) => T1.waitFor((m) => m.t === 'say' && m.text === `ligne ${n * 3 + j}`, start)));
  }
  await T1.waitFor((m) => m.t === 'say' && m.text === 'ligne 32');
  const last30 = JSON.stringify(T1.msgs.filter((m) => m.t === 'say').slice(-30));
  N2.ws.close();
  N2 = await rejoin('N3', idN);
  const history = await N2.waitFor((m) => m.t === 'chatHistory');
  check(JSON.stringify(history.messages) === last30 && history.messages[0].text === 'ligne 3',
    `a reconnecting phone gets chatHistory on hello: the last 30 say events as relayed, oldest first (${history.messages.length}, from "${history.messages[0]?.text}")`);
  const T3 = await screen('T3');
  check(JSON.stringify((await T3.waitFor((m) => m.t === 'chatHistory')).messages) === last30, '…and so does a TV saying hello');
  T3.ws.close();

  // object actions: the sender's last pos near an object, checked against the party room
  const TABLE = { x: 11.1, y: 7.5 }; // in front of the birthday table
  check(Object.values<any>(content.nodes).every((n) => !n.door || n.door.y + n.door.h < TABLE.y), 'the table point is outside every door');
  /** Élodie (just past her limit) asks for an object's action → the interact event each client got, or null. */
  const interact = async (object = 'table') => {
    await cooldown(idE, 'interact');
    const from = marks();
    E.send({ t: 'interact', object });
    return relayed('interact', from, [E]);
  };
  const isRelayed = (got: any[]) => got.every((m) => m?.playerId === idE && m.object === 'table' && typeof m.at === 'number');
  const isDropped = (got: any[]) => got.every((m) => m === null);
  /** One line per place: `relays` is whether interact works there today. */
  const interactsHere = async (where: string, relays: boolean) => {
    const got = await interact();
    check(relays ? isRelayed(got) : isDropped(got), `${where}: interact at the table → ${relays ? 'relayed to every client with playerId, object and at' : 'dropped'}`);
  };
  await step(E, TABLE);
  await interactsHere('in the room at a block tableau', true);
  await cooldown(idE, 'interact');
  i = T1.mark();
  E.send({ t: 'interact', object: 'table' }); E.send({ t: 'interact', object: 'table' });
  await settled([E], [T1]);
  check(T1.since(i).filter((m) => m.t === 'interact').length === 1, 'rate limit: one interact per 700 ms per socket');
  check(isDropped(await interact('sofa')), 'interact naming another object than the one nearby → dropped');
  await step(E, floor);
  check(isDropped(await interact()), 'interact far from every object → dropped');
  await step(E, TABLE);
  i = P.mark(); P.send({ t: 'startMinigame' });
  await P.waitFor((m) => m.t === 'view' && !!lobbyOf(m), i);
  await interactsHere('in a minigame\'s lobby', false);

  const next = await startRound(P, [P, E, N2]);
  check(!!blocksOf(next).players[idN], 'the newcomer is seated in the round started from the lobby');
  i = P.mark(); P.send({ t: 'gm', op: { op: 'wisp', character: 'anna', on: true } });
  k = await until(P, (x) => x.party.players[idN].statuses.includes('wisp'), i);
  check(roundIn(k).players[idN].left === true && !k.at.activity.players.some((p: any) => p.id === idN),
    'GM switches a player to Wisp Mode during a round: no longer eligible, out of the round');
  i = P.mark(); P.send({ t: 'gm', op: { op: 'wisp', character: 'anna', on: false } });
  await until(P, (x) => x.party.players[idN].statuses.includes('incarnating'), i);
  k = await until(P, (x) => !x.party.players[idN].statuses.includes('wisp'), i, 5000);
  check(roundIn(k).players[idN].left === true && k.at.activity.players.some((p: any) => p.id === idN),
    'incarnation makes them eligible again, for the next round, not this one');
  await interactsHere('during a running block game', false);
  // during a round, only wisps walk: a pos from anyone else is dropped
  i = T1.mark();
  E.send({ t: 'pos', ...floor, dir: 'up', moving: true });
  await settled([E], [T1]);
  check(!T1.since(i).some((m) => m.t === 'pos'), 'during a running block game, a pos from a player who is not a wisp is dropped');
  const T4 = new Client('T4'); await T4.open();
  T4.send({ t: 'hello', role: 'screen' });
  await T4.waitFor((m) => m.t === 'chatHistory');
  await roundTrip(T4); // after the positions a hello sends
  // the lobby placed its walkers on its start positions: Élodie stands where the TVs last saw her
  const standing = T4.msgs.find((m) => m.t === 'pos' && m.playerId === idE);
  const seen = T1.msgs.findLast((m) => m.t === 'pos' && m.playerId === idE);
  check(standing?.x === seen?.x && standing?.y === seen?.y && standing?.moving === false,
    `a TV saying hello during the round gets the room's positions: Élodie stands where she was placed, not walking (${JSON.stringify(standing)})`);
  T4.ws.close();
  i = P.mark(); P.send({ t: 'endGame' });
  await until(P, (x) => roundIn(x)?.phase === 'finished', i);
  await interactsHere('on a block podium', false);
  const iP = P.mark();
  P.send({ t: 'gm', op: { op: 'goto', node: 'hub' } });
  k = await until(P, (x) => x.at.node === 'hub', iP);
  check(k.at.activity === null && played(k) === 5, 'gm goto from the podium ends the minigame first: its round recorded (blocks.played = 5)');
  await step(E, TABLE); // back from the lobby's start position
  await interactsHere('on the hub', true);
  i = P.mark(); P.send({ t: 'gm', op: { op: 'goto', node: 'childhood' } });
  await until(P, (x) => x.at.node === 'childhood', i);
  await interactsHere('in a world', true);
  i = P.mark(); P.send({ t: 'gm', op: { op: 'goto', node: 'childhood.quiz' } });
  await P.waitFor((m) => m.t === 'view' && !!roomOf(m) && m.campaign.at.kind === 'quiz', i);
  await interactsHere('in the room at a quiz tableau', true);
  const question = quizOf(await startRound(P, [P, E, N2]));
  await interactsHere('during a quiz question', false);
  i = P.mark();
  for (const c of [P, E, N2]) c.send(question.round.question.choices ? { t: 'answer', choice: 0 } : { t: 'answer', text: 'x' });
  await P.waitFor((m) => m.t === 'view' && quizOf(m)?.phase === 'reveal', i);
  await interactsHere('on a quiz reveal', false);
  i = P.mark(); P.send({ t: 'endGame' });
  await P.waitFor((m) => m.t === 'view' && quizOf(m)?.phase === 'finished', i);
  await interactsHere('on a finished quiz', false);
  for (const c of [N2, stranger]) c.ws.close();

  for (const c of [P, E, T1, T2]) c.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).stack ?? e}\n--- server log ---\n${log}`);
} finally {
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
