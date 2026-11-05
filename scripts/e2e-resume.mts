// P2 end-to-end: kill -9 + restart in every phase (lobby / playing / finished / timed playing).
// Runs its OWN server (a child process on PORT, scratch BLOKO_VAR) so it can SIGKILL it.
// Usage: PORT=3178 node scripts/e2e-resume.mts      (never 3131: that's the live server)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blocksOf, check, Client, finish, HTTP, legalMoves, playToDone, settingsOf, sleep } from './e2e-lib.mts';

const PORT = process.env.PORT ?? '3141';
if (PORT === '3131') throw new Error('3131 is the live server: pick another PORT');
const VAR = mkdtempSync(join(tmpdir(), 'bloko-resume-'));
const MAIN = new URL('../server/main.ts', import.meta.url).pathname;

let server: ChildProcess | null = null;
let log = '';

/** Starts the server and waits until HTTP answers. */
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

/** kill -9: no shutdown hook, no last save. Resolves once the process is gone. */
async function kill9(): Promise<void> {
  const s = server!;
  const gone = new Promise((r) => s.once('exit', r));
  s.kill('SIGKILL');
  await gone;
  server = null;
}

const roomCode = async (): Promise<string> => (await (await fetch(`${HTTP}/api/join`)).json()).code;

/** Phone with a stored id: hello + playerId → welcome + view. */
async function rejoin(label: string, playerId: string): Promise<Client> {
  const c = new Client(label); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'player', playerId });
  await c.waitFor((m) => m.t === 'welcome' && m.playerId === playerId, i);
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}

/** Comparable game content (the deadline is checked separately). */
const core = (s: any) => JSON.stringify({ ...s, deadline: null });

let s = 777;
const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);

try {
  // ---------- lobby ----------
  await boot(true);
  const room = await roomCode();
  let A = new Client('A'); await A.open(); A.send({ t: 'hello', role: 'player', room });
  let i = A.mark(); A.send({ t: 'join', character: 'anna' });
  const idA = (await A.waitFor((m) => m.t === 'welcome', i)).playerId;
  let B = new Client('B'); await B.open(); B.send({ t: 'hello', role: 'player', room });
  i = B.mark(); B.send({ t: 'join', character: 'sol' });
  const idB = (await B.waitFor((m) => m.t === 'welcome', i)).playerId;
  await A.waitFor((m) => m.t === 'view' && blocksOf(m).order.length === 2);
  A.send({ t: 'pos', x: 4, y: 4, dir: 'up', moving: false });
  await sleep(100);
  i = A.mark(); A.send({ t: 'config', patch: { grace: 2 } }); // settings changed in the lobby
  await A.waitFor((m) => m.t === 'view' && settingsOf(m)?.grace === 2, i);
  const lobby = A.lastView();
  const lobbySettings = JSON.stringify(A.lastSettings());
  check(!readFileSync(join(VAR, 'bloko.state.json'), 'utf8').includes('"pos"'), 'avatar positions are never persisted');

  await kill9(); await boot();
  check((await roomCode()) === room, `lobby kill -9 → same room code (${room})`);
  A = await rejoin('A', idA); B = await rejoin('B', idB);
  check(core(A.lastView()) === core(lobby) && A.lastView().phase === 'lobby' && A.lastHost() === idA
    && JSON.stringify(A.lastSettings()) === lobbySettings && A.lastSettings().grace === 2,
    'lobby kill -9 → same players, host and settings (changed in the lobby); stored ids rejoin');
  check(!A.msgs.some((m) => m.t === 'pos'), 'positions are ephemeral: none replayed after a restart');
  check(/RESUMED .* block game lobby/.test(log), 'server log says it resumed the lobby');

  // ---------- playing (marathon) ----------
  i = A.mark(); A.send({ t: 'start' });
  await A.waitFor((m) => m.t === 'view' && blocksOf(m).phase === 'playing', i);
  i = B.mark(); const iA = A.mark(); A.send({ t: 'place', ...legalMoves(A.lastView(), idA)[0] });
  await B.waitFor((m) => m.t === 'view', i);
  await A.waitFor((m) => m.t === 'view', iA); // the snapshot is read from A: wait for A's copy too
  const playing = A.lastView();
  check(playing.players[idA].score > 0, 'a move is on the board before the kill');

  await kill9(); await boot();
  A = await rejoin('A', idA); B = await rejoin('B', idB);
  check(core(A.lastView()) === core(playing) && A.lastView().deadline === null, 'playing kill -9 → same boards, hands, scores');
  i = B.mark(); A.send({ t: 'place', ...legalMoves(A.lastView(), idA)[0] });
  check((await B.waitFor((m) => m.t === 'view' || m.t === 'err', i)).t === 'view', 'resumed game accepts the next move');

  // ---------- finished ----------
  await playToDone(A, idA, B, rnd);
  await playToDone(B, idB, A, rnd);
  await A.waitFor((m) => m.t === 'view' && blocksOf(m).phase === 'finished');
  i = A.mark(); A.send({ t: 'config', patch: { cleanBoardBonus: 450 } }); // the next game's settings, set on the podium
  await A.waitFor((m) => m.t === 'view' && settingsOf(m)?.cleanBoardBonus === 450, i);
  const podium = A.lastView();
  const podiumSettings = JSON.stringify(A.lastSettings());

  await kill9(); await boot();
  A = await rejoin('A', idA); B = await rejoin('B', idB);
  check(core(A.lastView()) === core(podium) && A.lastView().phase === 'finished', 'finished kill -9 → same podium');
  check(JSON.stringify(A.lastSettings()) === podiumSettings && A.lastSettings().grace === 2 && A.lastSettings().cleanBoardBonus === 450,
    'finished kill -9 → the settings changed in the lobby and on the podium are kept');
  i = B.mark(); B.send({ t: 'newGame' });
  check((await B.waitFor((m) => m.t === 'err', i)).code === 'not-host', 'after resume: non-host newGame → err not-host');
  i = A.mark(); A.send({ t: 'newGame' });
  const back = blocksOf(await A.waitFor((m) => m.t === 'view' && blocksOf(m).phase === 'lobby', i));
  check(back.order.join() === `${idA},${idB}` && A.lastHost() === idA && (await roomCode()) === room, 'after resume: host newGame → lobby, same players + room');

  // newGame lobby survives a kill too (the case of the first playtest)
  await kill9(); await boot();
  A = await rejoin('A', idA); B = await rejoin('B', idB);
  check(core(A.lastView()) === core(back), 'newGame lobby kill -9 → same lobby');

  // ---------- playing (timed): the clock keeps its REMAINING time ----------
  A.send({ t: 'config', patch: { mode: 'timed', timedSeconds: 60 } });
  await A.waitFor((m) => m.t === 'view' && settingsOf(m)?.mode === 'timed');
  i = A.mark(); A.send({ t: 'start' });
  const tv = await A.waitFor((m) => m.t === 'view' && blocksOf(m).phase === 'playing', i);
  const deadline0 = blocksOf(tv).deadline as number;
  await sleep(2200); // > 1 heartbeat: savedAt is fresh even though nobody moved
  const killedAt = Date.now();
  const left = deadline0 - killedAt;
  const timedBefore = A.lastView();
  await kill9();
  const DOWN = 4000;
  await sleep(DOWN);
  await boot();
  A = await rejoin('A', idA);
  const rv = [...A.msgs].reverse().find((m) => m.t === 'view');
  const leftAfter = blocksOf(rv).deadline - rv.now;
  const shift = blocksOf(rv).deadline - deadline0;
  check(blocksOf(rv).phase === 'playing' && core(blocksOf(rv)) === core(timedBefore), 'timed kill -9 → same game, still playing');
  check(shift >= DOWN && shift <= DOWN + 1500, `timed deadline shifted by the downtime (${shift} ms for ≥ ${DOWN} ms down)`);
  check(Math.abs(leftAfter - left) <= 1500, `remaining time kept (${Math.round(left / 100) / 10} s before → ${Math.round(leftAfter / 100) / 10} s after)`);
  check(/timed clock paused \d+ s while down/.test(log), 'server log reports the paused clock');
  i = A.mark(); A.send({ t: 'place', ...legalMoves(blocksOf(rv), idA)[0] });
  check((await A.waitFor((m) => m.t === 'view' || m.t === 'err', i)).t === 'view', 'resumed timed game accepts moves (not expired)');

  // ---------- suspended process (laptop lid closed): SIGSTOP → SIGCONT, no restart ----------
  const beforeStop = A.lastView();
  const leftStop = beforeStop.deadline - Date.now();
  i = A.mark();
  server!.kill('SIGSTOP');
  await sleep(DOWN);
  server!.kill('SIGCONT');
  const sv = (await A.waitFor((m) => m.t === 'view' && blocksOf(m).deadline !== beforeStop.deadline, i, 4000));
  const leftCont = blocksOf(sv).deadline - sv.now;
  check(blocksOf(sv).phase === 'playing' && Math.abs(leftCont - leftStop) <= 1500,
    `suspended ${DOWN / 1000} s → clock paused, still playing (${Math.round(leftStop / 100) / 10} s → ${Math.round(leftCont / 100) / 10} s left)`);
  check(!A.since(i).some((m) => m.t === 'view' && blocksOf(m).phase === 'finished'), 'the overdue bell did not end the game on wake');

  // ---------- older envelopes: ISO savedAt, or none at all ----------
  const FILE = join(VAR, 'bloko.state.json');
  for (const [label, edit] of [
    ['ISO-string savedAt (pre-slice-2)', (e: any) => { e.savedAt = new Date(e.savedAt).toISOString(); }],
    ['no savedAt', (e: any) => { delete e.savedAt; }],
  ] as const) {
    await kill9();
    const env = JSON.parse(readFileSync(FILE, 'utf8'));
    edit(env);
    writeFileSync(FILE, JSON.stringify(env));
    await boot();
    A = await rejoin('A', idA);
    const v = A.lastView();
    check(v.phase === 'playing' && v.players[idA].score === env.campaign.at.activity.players[idA].score && (await roomCode()) === room,
      `envelope with ${label} still resumes`);
  }
  // ---------- the bell falls due DURING a suspend: wake must pause the clock, not end the game ----------
  await kill9();
  const env = JSON.parse(readFileSync(FILE, 'utf8'));
  env.savedAt = Date.now();
  env.campaign.at.activity.deadline = Date.now() + 2500;
  writeFileSync(FILE, JSON.stringify(env));
  await boot();
  A = await rejoin('A', idA);
  const dueSoon = A.lastView().deadline;
  i = A.mark();
  server!.kill('SIGSTOP');
  await sleep(DOWN); // the 2.5 s bell is overdue when the process wakes
  server!.kill('SIGCONT');
  await sleep(800);
  const woke = A.lastView();
  check(woke.phase === 'playing' && woke.deadline > dueSoon && !A.since(i).some((m) => m.t === 'view' && blocksOf(m).phase === 'finished'),
    `overdue bell on wake → ignored, clock paused (${Math.round((woke.deadline - Date.now()) / 100) / 10} s left)`);
  const ended = await A.waitFor((m) => m.t === 'view' && blocksOf(m).phase === 'finished', i, 6000);
  check(blocksOf(ended).endReason === 'time', `…and the bell still rings at the shifted deadline (endReason ${blocksOf(ended).endReason})`);

  // ---------- a pre-campaign (v1) save: migrated into the campaign, never lost ----------
  await kill9();
  const v2 = JSON.parse(readFileSync(FILE, 'utf8'));
  check(v2.v === 2 && !!v2.campaign && typeof v2.savedAt === 'number', 'the save is an envelope v2 { v:2, campaign, room, savedAt }');
  // a v1 save is a bare block State, which kept its settings and its host
  const legacy = { v: 1, savedAt: Date.now(), state: { ...v2.campaign.at.activity, settings: v2.campaign.at.settings, hostId: v2.campaign.party.hostId }, room: v2.room, bestPrevious: null };
  writeFileSync(FILE, JSON.stringify(legacy));
  await boot();
  check(/MIGRATED a v1 save/.test(log), 'v1 save → migrated (server log says so)');
  A = await rejoin('A', idA);
  check(core(A.lastView()) === core(legacy.state) && A.lastView().phase === legacy.state.phase && (await roomCode()) === room,
    'v1 save → same block game, same room; stored ids rejoin');
  const migrated = A.msgs.findLast((m) => m.t === 'view').campaign;
  check(migrated.party.order.join() === legacy.state.order.join() && migrated.party.hostId === legacy.state.hostId,
    'v1 save → the party is rebuilt from its players (same ids, same host)');
  const kept = readdirSync(VAR).filter((f) => f.startsWith('bloko.state.json.v1-'));
  check(kept.length === 1 && JSON.parse(readFileSync(join(VAR, kept[0]), 'utf8')).v === 1, 'the original v1 file is kept next to the save');
  check(JSON.parse(readFileSync(FILE, 'utf8')).v === 2, 'and the live save is v2 from the first write on');

  for (const c of [A, B]) c.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).message}\n--- server log ---\n${log}`);
} finally {
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
