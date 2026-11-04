// P1 (server) end-to-end, slice 2b — the character IS the identity: presence (`online` in view),
// reclaim by character, newest-socket-wins (`replaced`), host reclaim, dead-socket sweep, restart.
// Runs its OWN server (child process on PORT, scratch BLOKO_VAR) so it can kill -9 it.
// Usage: PORT=3179 node scripts/e2e-presence.mts      (never 3131: that's the live server)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket as WsClient } from 'ws';
import { check, Client, finish, HTTP, legalMoves, playToDone, sleep, URL_WS } from './e2e-lib.mts';

const PORT = process.env.PORT ?? '3141';
if (PORT === '3131') throw new Error('3131 is the live server: pick another PORT');
const VAR = mkdtempSync(join(tmpdir(), 'bloko-presence-'));
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

let room = '';
/** A device opening the join URL: hello with the room code, no stored id. */
async function device(label: string): Promise<Client> {
  const c = new Client(label); await c.open();
  c.send({ t: 'hello', role: 'player', room });
  await c.waitFor((m) => m.t === 'view');
  return c;
}
/** Tap a character → the welcome's playerId, or the err code. */
async function tap(c: Client, character: string): Promise<{ id?: string, err?: string }> {
  const i = c.mark();
  c.send({ t: 'join', character });
  const r = await c.waitFor((m) => m.t === 'welcome' || m.t === 'err', i);
  return r.t === 'welcome' ? { id: r.playerId } : { err: r.code };
}
/** A device with a stored id: hello + playerId. */
async function rejoin(label: string, playerId: string): Promise<Client> {
  const c = new Client(label); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'player', room, playerId });
  await c.waitFor((m) => m.t === 'welcome' && m.playerId === playerId, i);
  return c;
}
const closed = async (c: Client) => { c.ws.close(); for (let k = 0; k < 100 && !c.closed; k++) await sleep(10); };
/** Waits for the screen to see exactly this online list. */
async function onlineIs(screen: Client, ids: string[], label: string, ms = 2000): Promise<void> {
  const want = ids.join();
  try {
    await screen.waitFor((m) => m.t === 'view' && m.online?.join() === want, screen.msgs.length - 1, ms);
    check(true, `${label} (online = [${ids.length} players])`);
  } catch {
    const last = [...screen.msgs].reverse().find((m) => m.t === 'view');
    check(false, `${label}: online ${JSON.stringify(last?.online)} ≠ ${JSON.stringify(ids)}`);
  }
}
/** The `online` list of the last view a client got. */
const lastOnline = (c: Client): string[] => [...c.msgs].reverse().find((m) => m.t === 'view')?.online ?? [];
const pick = (s: any, id: string) => JSON.stringify({ b: s.players[id].board, sc: s.players[id].score, h: s.players[id].hand });

let seed = 99;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

try {
  await boot(true);
  room = (await (await fetch(`${HTTP}/api/join`)).json()).code;
  let screen = new Client('screen'); await screen.open(); screen.send({ t: 'hello', role: 'screen' });
  const v0 = await screen.waitFor((m) => m.t === 'view');
  check(Array.isArray(v0.online) && v0.online.length === 0 && !('online' in v0.state), 'view carries online[] beside the State, empty at first');

  // ---------- lobby: presence + reclaim ----------
  const A = await device('A');
  const idA = (await tap(A, 'anna')).id!;
  await onlineIs(screen, [idA], 'join → online');
  const B = await device('B');
  const idB = (await tap(B, 'sol')).id!;
  await onlineIs(screen, [idA, idB], 'second join → online, seat order');
  await closed(B);
  await onlineIs(screen, [idA], 'socket close → re-broadcast, player offline');
  check(screen.lastView().players[idB] && screen.lastView().order.length === 2, '…but still in the game');

  const C = await device('C');
  check((await tap(C, 'anna')).err === 'taken', 'tap an ONLINE-held character → err taken');
  const r = await tap(C, 'sol');
  check(r.id === idB, 'lobby: tap an OFFLINE-held character → welcome with the EXISTING playerId (reclaim)');
  await onlineIs(screen, [idA, idB], 'reclaim → online again');
  check(screen.lastView().order.length === 2, 'reclaim creates no new player');
  const B2 = C; // B's character now lives on device C

  // ---------- two tabs on one id: newest wins ----------
  const A2 = await rejoin('A2', idA);
  await A.waitFor((m) => m.t === 'replaced');
  for (let k = 0; k < 100 && !A.closed; k++) await sleep(10);
  check(A.closed && !A2.closed, 'second tab with the same id → old tab gets {t:replaced} and is closed');
  await sleep(150);
  check(lastOnline(screen).join() === `${idA},${idB}`, 'presence unchanged by a bump (same player, new socket)');

  // ---------- host reclaim, then the host starts ----------
  await closed(A2);
  await onlineIs(screen, [idB], 'host phone dies → offline');
  const A3 = await device('A3');
  check((await tap(A3, 'anna')).id === idA, 'host character reclaimed on a new device → same playerId');
  check(screen.lastView().hostId === idA, 'reclaimed host is still host');
  let i = A3.mark(); A3.send({ t: 'start' });
  await A3.waitFor((m) => m.t === 'view' && m.state.phase === 'playing', i);
  check(A3.lastView().phase === 'playing', 'reclaimed host can start the game');

  // ---------- mid-game reclaim keeps board, score, hand ----------
  i = A3.mark(); B2.send({ t: 'place', ...legalMoves(B2.lastView(), idB)[0] });
  await A3.waitFor((m) => m.t === 'view', i);
  const before = pick(A3.lastView(), idB);
  await closed(B2);
  await onlineIs(screen, [idA], 'mid-game drop → offline');
  const B3 = await device('B3');
  check((await tap(B3, 'sol')).id === idB, 'mid-game: tap own character on another device → reclaim (join while playing is no longer "full" for it)');
  await B3.waitFor((m) => m.t === 'view' && m.online?.includes(idB));
  check(pick(B3.lastView(), idB) === before && B3.lastView().players[idB].score > 0, 'mid-game reclaim → same board, score and hand');
  i = B3.mark(); B3.send({ t: 'place', ...legalMoves(B3.lastView(), idB)[0] });
  check((await B3.waitFor((m) => m.t === 'view' || m.t === 'err', i)).t === 'view', 'reclaimer can place');

  // ---------- the old device comes back with its stored id (the reclaim race) ----------
  const Bold = await rejoin('B-old', idB);
  await B3.waitFor((m) => m.t === 'replaced');
  check(true, 'old device rejoins with its stored id → it wins, the reclaimer gets replaced (newest wins)');
  const D = await device('D');
  check((await tap(D, 'sol')).err === 'full', 'mid-game: a character held ONLINE → refused (full while playing, as before)');
  check(pick(Bold.lastView(), idB) === pick(screen.lastView(), idB), 'bump moves no game state');

  // ---------- dead socket (never answers pings) goes offline by itself ----------
  await closed(A3);
  const zombie = new WsClient(URL_WS, { autoPong: false });
  await new Promise((res) => zombie.once('open', res));
  zombie.send(JSON.stringify({ t: 'hello', role: 'player', room, playerId: idA }));
  await onlineIs(screen, [idA, idB], 'a silent device rejoins (online)');
  const t0 = Date.now();
  await onlineIs(screen, [idB], 'no pong → swept offline, character reclaimable again', 12_000);
  console.log(`      (swept after ${Math.round((Date.now() - t0) / 100) / 10} s)`);
  zombie.terminate();
  const A4 = await device('A4');
  check((await tap(A4, 'anna')).id === idA, 'swept player reclaimed');

  // ---------- podium reclaim; a left player's character is free, not reclaimable ----------
  i = A4.mark(); Bold.send({ t: 'leave' });
  await A4.waitFor((m) => m.t === 'view' && m.state.players[idB]?.left, i);
  await closed(Bold);
  const E = await device('E');
  // A1: a left member's character is free: E joins the evening as a NEW member (watches the game)
  const eSol = await tap(E, 'sol');
  check(!!eSol.id && eSol.id !== idB && !E.lastView().players[eSol.id], 'mid-game: a LEFT player\'s character is never reclaimed (E is a new member, watching)');
  i = E.mark(); E.send({ t: 'leave' });
  await E.waitFor((m) => m.t === 'view' && m.campaign.party.players[eSol.id!].left, i);
  await playToDone(A4, idA, screen, rnd);
  await A4.waitFor((m) => m.t === 'view' && m.state.phase === 'finished');
  await closed(A4);
  await onlineIs(screen, [], 'podium: host offline');
  const Ehost = await device('Ehost');
  check((await tap(Ehost, 'anna')).id === idA, 'podium: offline host reclaimed by character');
  check(Ehost.lastView().hostId === idA && Ehost.lastView().phase === 'finished', '…still host, still on the podium');
  i = Ehost.mark(); Ehost.send({ t: 'newGame' });
  const lob = (await Ehost.waitFor((m) => m.t === 'view' && m.state.phase === 'lobby', i)).state;
  check(!lob.players[idB], 'newGame drops the left player');
  const F = await device('F');
  const idF = (await tap(F, 'sol')).id ?? '';
  check(!!idF && idF !== idB, "the left player's character is FREE in the lobby → a NEW player, not the old id");

  // ---------- kill -9 + restart: online starts empty, everyone reconnects ----------
  await kill9(); await boot();
  screen = new Client('screen2'); await screen.open(); screen.send({ t: 'hello', role: 'screen' });
  const vr = await screen.waitFor((m) => m.t === 'view');
  check(vr.online.length === 0 && vr.state.order.join() === `${idA},${idF}`, 'after restart: same players, online empty');
  const E2 = await rejoin('E2', idA);
  await onlineIs(screen, [idA], 'stored id reconnects → online');
  const F2 = await device('F2');
  check((await tap(F2, 'sol')).id === idF, 'after restart: no stored id → tap the character → reclaim');
  await onlineIs(screen, [idA, idF], 'everyone back online');
  check(screen.lastView().hostId === idA, 'host kept through the restart');
  // ---------- host controls: a dropped player can never block the game ----------
  const G = await device('G'); const idG = (await tap(G, 'pierre')).id!;
  i = E2.mark(); E2.send({ t: 'start' });
  await E2.waitFor((m) => m.t === 'view' && m.state.phase === 'playing', i);
  await closed(F2); // sol drops while NOT stuck: the game would wait for her forever
  await onlineIs(screen, [idA, idG], 'controls: a player drops mid-game');
  const errOf = async (c: Client, msg: object) => {
    const k = c.mark(); c.send(msg);
    const r = await c.waitFor((m) => m.t === 'err' || m.t === 'view', k).catch(() => null);
    return r?.t === 'err' ? r.code : r ? 'view' : 'none';
  };
  check(await errOf(G, { t: 'retire', target: idF }) === 'not-host', 'non-host retire → err not-host');
  check(await errOf(G, { t: 'endGame' }) === 'not-host', 'non-host endGame → err not-host');
  i = screen.mark(); E2.send({ t: 'retire', target: idF });
  const vr2 = (await screen.waitFor((m) => m.t === 'view' && m.state.players[idF]?.done, i)).state;
  const pf = vr2.players[idF];
  check(pf.done && pf.retired && !pf.left && vr2.phase === 'playing', 'host retires the dropped player → done + retired, not left, game goes on');
  i = E2.mark(); E2.send({ t: 'retire', target: 'p-nope' }); await sleep(300);
  check(!E2.since(i).some((m) => m.t === 'err'), "host's no-op retire (unknown target) → no error");
  const F3 = await device('F3');
  check((await tap(F3, 'sol')).id === idF, 'a retired player keeps the character: tap → reclaim');
  check(F3.lastView().players[idF].retired === true, '…and sees themself out (done) on reconnect');
  i = E2.mark(); E2.send({ t: 'place', ...legalMoves(E2.lastView(), idA)[0] }); await E2.waitFor((m) => m.t === 'view', i);
  const scores = Object.fromEntries(E2.lastView().order.map((id: string) => [id, E2.lastView().players[id].score]));
  i = screen.mark(); E2.send({ t: 'endGame' });
  const ve = (await screen.waitFor((m) => m.t === 'view' && m.state.phase === 'finished', i)).state;
  check(ve.endReason === 'host' && ve.order.every((id: string) => ve.players[id].done && ve.players[id].score === scores[id]),
    'host endGame → finished, endReason host, everyone done, scores kept');
  check(await errOf(E2, { t: 'endGame' }) === 'not-host', 'endGame on the podium → err not-host');
  check(await errOf(E2, { t: 'retire', target: idG }) === 'not-host', 'retire on the podium → err not-host');
  // solo: a host-ended game is a real score → solo best recorded
  i = E2.mark(); E2.send({ t: 'newGame' }); await E2.waitFor((m) => m.t === 'view' && m.state.phase === 'lobby', i);
  F3.send({ t: 'leave' }); G.send({ t: 'leave' });
  await E2.waitFor((m) => m.t === 'view' && m.state.order.length === 1);
  i = E2.mark(); E2.send({ t: 'start' }); await E2.waitFor((m) => m.t === 'view' && m.state.phase === 'playing', i);
  i = E2.mark(); E2.send({ t: 'place', ...legalMoves(E2.lastView(), idA)[0] }); await E2.waitFor((m) => m.t === 'view', i);
  const solo = E2.lastView().players[idA].score;
  i = E2.mark(); E2.send({ t: 'endGame' });
  const vb = await E2.waitFor((m) => m.t === 'view' && m.state.phase === 'finished', i);
  check(vb.state.endReason === 'host' && vb.best?.score === solo && solo > 0, `solo game ended by the host still counts as a best (${solo})`);
  void idG;

  // ---------- show the join QR again: any joined player → screens only, ephemeral, rate-limited ----------
  const joinQrs = (c: Client, from: number) => c.since(from).filter((m) => m.t === 'joinQr');
  i = screen.mark(); let iE = E2.mark();
  const tShow = Date.now();
  E2.send({ t: 'showJoin', requestId: 1 });
  const qr1 = await screen.waitFor((m) => m.t === 'joinQr', i);
  const showAck1 = await E2.waitFor((m) => m.t === 'joinQrAck' && m.requestId === 1, iE);
  check(showAck1.accepted && typeof showAck1.token === 'string' && showAck1.until === qr1.until,
    'requesting phone gets the accepted window token and deadline');
  check(qr1.until >= tShow + 14_000 && qr1.until <= Date.now() + 16_000 && typeof qr1.now === 'number', `showJoin → the screen gets joinQr until now + 15 s (${Math.round((qr1.until - tShow) / 1000)} s)`);
  await sleep(300);
  check(joinQrs(E2, iE).length === 0, 'players never receive joinQr (screens only)');
  i = screen.mark();
  iE = E2.mark();
  E2.send({ t: 'showJoin', requestId: 2 }); E2.send({ t: 'showJoin', requestId: 3 }); // mashed
  await sleep(400);
  check(joinQrs(screen, i).length === 0, 'rate limit: repeats within 2 s from the same phone are ignored');
  check(E2.since(iE).filter((m) => m.t === 'joinQrAck' && !m.accepted).length === 2,
    'rate-limited requests are explicitly rejected to the phone');
  const stranger = new Client('stranger'); await stranger.open();
  stranger.send({ t: 'hello', role: 'player', room });
  i = screen.mark(); stranger.send({ t: 'showJoin' }); await sleep(400);
  check(joinQrs(screen, i).length === 0, 'a socket that never joined is ignored');
  await sleep(1800);
  i = screen.mark(); iE = E2.mark(); E2.send({ t: 'showJoin', requestId: 4 });
  const qr2 = await screen.waitFor((m) => m.t === 'joinQr', i);
  const showAck2 = await E2.waitFor((m) => m.t === 'joinQrAck' && m.requestId === 4, iE);
  check(qr2.until > qr1.until, 'after 2 s a repeat goes through and EXTENDS the window');
  const tv2 = new Client('tv2'); await tv2.open();
  i = tv2.mark(); tv2.send({ t: 'hello', role: 'screen' });
  const late = await tv2.waitFor((m) => m.t === 'joinQr', i);
  check(late.until === qr2.until, 'a screen connecting while the window is open gets joinQr on hello');
  check(!readFileSync(join(VAR, 'bloko.state.json'), 'utf8').includes('joinQr'), 'never on disk (ephemeral)');

  // hideJoin: closes the window at once (until ≤ now); its own rate limit; nothing re-sent after a close
  i = screen.mark(); stranger.send({ t: 'hideJoin' }); await sleep(400);
  check(joinQrs(screen, i).length === 0, 'hideJoin from a socket that never joined → ignored');
  i = screen.mark(); iE = E2.mark(); E2.send({ t: 'hideJoin', token: showAck1.token, requestId: 5 });
  const staleHide = await E2.waitFor((m) => m.t === 'joinQrAck' && m.requestId === 5, iE);
  check(!staleHide.accepted && joinQrs(screen, i).length === 0,
    'an older window token cannot close a newer QR window');
  i = screen.mark(); iE = E2.mark(); E2.send({ t: 'hideJoin', token: showAck2.token, requestId: 6 }); // right after a show: hides have their own limit
  const qrClose = await screen.waitFor((m) => m.t === 'joinQr', i);
  const hideAck = await E2.waitFor((m) => m.t === 'joinQrAck' && m.requestId === 6, iE);
  check(hideAck.accepted, 'the owner phone receives an accepted hide acknowledgement');
  check(qrClose.until <= qrClose.now, `hideJoin → screens get joinQr with until ≤ now = close (${qrClose.until - qrClose.now} ms)`);
  i = screen.mark(); E2.send({ t: 'hideJoin', token: showAck2.token, requestId: 7 }); await sleep(400);
  check(joinQrs(screen, i).length === 0, 'a second hide (nothing open, and rate-limited) → nothing');
  const tv3 = new Client('tv3'); await tv3.open();
  i = tv3.mark(); tv3.send({ t: 'hello', role: 'screen' }); await tv3.waitFor((m) => m.t === 'view', i); await sleep(300);
  check(joinQrs(tv3, i).length === 0, 'a screen saying hello after the close gets no joinQr');
  for (const c of [stranger, tv2, tv3]) c.ws.close();
  void iE;

  for (const c of [E2, F2, F3, G, screen, D, E, F]) c.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).message}\n--- server log ---\n${log}`);
} finally {
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
