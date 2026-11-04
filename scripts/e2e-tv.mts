// TV end-to-end (slice 2/2b, screen side): a real /screen/ page in headless Chrome (CDP), a real
// server this script kill -9s, and phones as WebSocket clients. Checks lobby re-entry after newGame,
// auto-reconnect after a restart in every phase, presence dimming (debounced), screens never bumped,
// and the wake-from-sleep reconnect.
// Usage: start Chrome with --remote-debugging-port=<CDP>, then
//        PORT=3180 CDP=9222 [SHOTS=dir] node scripts/e2e-tv.mts       (never PORT 3131: the live server)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnPoint } from '../shared/world.js';
import { check, Client, finish, HTTP, legalMoves, playToDone, sleep } from './e2e-lib.mts';

const PORT = process.env.PORT ?? '3141';
if (PORT === '3131') throw new Error('3131 is the live server: pick another PORT');
const CDP = process.env.CDP ?? '9222';
const SHOTS = process.env.SHOTS;
const VAR = mkdtempSync(join(tmpdir(), 'bloko-tv-'));
const MAIN = new URL('../server/main.ts', import.meta.url).pathname;

// ---------- server ----------
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

// ---------- minimal CDP page ----------
class Page {
  ws!: WebSocket;
  seq = 0;
  pending = new Map<number, (r: any) => void>();
  console: string[] = [];
  static async open(url: string): Promise<Page> {
    const t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const p = new Page();
    p.ws = new WebSocket(t.webSocketDebuggerUrl);
    p.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && p.pending.has(m.id)) { p.pending.get(m.id)!(m); p.pending.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled') p.console.push(m.params.args.map((a: any) => a.value).join(' '));
    };
    await new Promise((r) => { p.ws.onopen = r; });
    await p.cmd('Runtime.enable');
    await p.cmd('Debugger.enable');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    return p;
  }
  cmd(method: string, params: object = {}): Promise<any> {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => this.pending.set(id, r));
  }
  /** Evaluates an expression in the page, returns its JSON value. */
  async js(expr: string): Promise<any> {
    const r = await this.cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`page: ${r.result.exceptionDetails.text} in ${expr}`);
    return r.result?.result?.value;
  }
  async until(expr: string, label: string, ms = 4000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.js(expr).catch(() => false)) return true;
      await sleep(50);
    }
    console.log(`      (timed out waiting: ${label})`);
    return false;
  }
  async shot(name: string): Promise<void> {
    if (!SHOTS) return;
    const r = await this.cmd('Page.captureScreenshot', { format: 'png' });
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  }
  close(): void { this.ws.close(); }
}

// ---------- phones ----------
let room = '';
async function device(label: string): Promise<Client> {
  const c = new Client(label); await c.open();
  c.send({ t: 'hello', role: 'player', room });
  await c.waitFor((m) => m.t === 'view');
  return c;
}
async function tap(c: Client, character: string): Promise<string> {
  const i = c.mark();
  c.send({ t: 'join', character });
  const r = await c.waitFor((m) => m.t === 'welcome' || m.t === 'err', i);
  if (r.t !== 'welcome') throw new Error(`${c.label}: tap ${character} → err ${r.code}`);
  return r.playerId;
}
async function rejoin(label: string, playerId: string): Promise<Client> {
  const c = new Client(label); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'player', room, playerId });
  await c.waitFor((m) => m.t === 'welcome', i);
  return c;
}
const drop = async (c: Client) => { c.ws.close(); for (let k = 0; k < 100 && !c.closed; k++) await sleep(10); };

const tvState = 'window.bloko.state()';
const tvOnlineBanner = "document.body.classList.contains('offline')";
const tvOffline = 'JSON.stringify(window.bloko.offline().sort())';
const boardsOf = (s: any) => JSON.stringify(s.order.map((id: string) => [id, s.players[id].board, s.players[id].score, s.players[id].hand]));

let seed = 4242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

/** kill -9, check the TV shows the banner, restart, check it comes back with the same game. */
async function killAndBack(tv: Page, phase: string): Promise<void> {
  const before = await tv.js(`JSON.stringify(${tvState})`);
  await kill9();
  check(await tv.until(tvOnlineBanner, 'banner'), `${phase}: kill -9 → TV shows the "Connecting…" banner`);
  await tv.shot(`kill-${phase}-banner`);
  await sleep(1500);
  await boot();
  check(await tv.until(`!${tvOnlineBanner}`, 'reconnect', 6000), `${phase}: restart → TV reconnects by itself, banner gone`);
  await sleep(300);
  const after = await tv.js(`JSON.stringify(${tvState})`);
  const a = JSON.parse(after), b = JSON.parse(before);
  check(a.phase === phase && boardsOf(a) === boardsOf(b) && a.hostId === b.hostId, `${phase}: same phase, boards/scores/hands, host after the restart`);
}

let tv: Page | null = null, tv2: Page | null = null;
try {
  await boot(true);
  room = (await (await fetch(`${HTTP}/api/join`)).json()).code;
  tv = await Page.open(`${HTTP}/screen/`);
  check(await tv.until(`window.bloko?.state()?.phase === 'lobby' && !${tvOnlineBanner}`, 'tv lobby'), 'TV opens on the lobby');

  // ---------- lobby, avatars, presence ----------
  const A = await device('A'); const idA = await tap(A, 'anna');
  let B = await device('B'); const idB = await tap(B, 'sol');
  check(await tv.until('window.bloko.avatars().length === 2', '2 avatars'), 'two guests → two avatars in the party room');
  await drop(B);
  await sleep(1200);
  check(await tv.js(tvOffline) === '[]', 'lobby drop: not tagged yet within the 2 s grace');
  check(await tv.until(`${tvOffline} === ${JSON.stringify(JSON.stringify([idB]))}`, 'offline tag', 3000), 'lobby drop: tagged offline after ~2 s');
  check(await tv.js(`window.bloko.avatars().find((a) => a.id === '${idB}').offline === true`), "…the dropped guest's avatar is dimmed");
  await tv.shot('lobby-offline');
  B = await device('B2'); await tap(B, 'sol');
  check(await tv.until(`${tvOffline} === '[]'`, 'back', 1500), 'reclaim → back to normal at once');
  // blip: drop + back within 1 s → never tagged
  let flicker = false;
  await drop(B);
  const watch = (async () => { const end = Date.now() + 3500; while (Date.now() < end) { if ((await tv!.js(tvOffline)) !== '[]') flicker = true; await sleep(50); } })();
  await sleep(700);
  B = await rejoin('B3', idB);
  await watch;
  check(!flicker, 'reconnect blip (0.7 s) → the offline tag never flickers');

  // ---------- screens are never bumped ----------
  tv2 = await Page.open(`${HTTP}/screen/`);
  await tv2.until(`window.bloko?.state()?.phase === 'lobby'`, 'tv2');
  const B4 = await rejoin('B4', idB); // bumps B3 (replaced) — the TVs must not care
  await B.waitFor((m) => m.t === 'replaced');
  await sleep(300);
  check(!(await tv.js(tvOnlineBanner)) && !(await tv2.js(tvOnlineBanner)), 'a phone bump (replaced) leaves both TVs connected');
  tv2.close(); tv2 = null;
  B = B4;

  // ---------- kill -9 in the lobby ----------
  await killAndBack(tv, 'lobby');
  let A2 = await rejoin('A2', idA); B = await rejoin('B5', idB);
  const spawnOk = async () => tv!.js(`JSON.stringify(window.bloko.avatars().map((a) => [a.id, Math.round(a.x * 10), Math.round(a.y * 10)]))`);
  const exp = JSON.stringify([[idA, Math.round(spawnPoint('anna').x * 10), Math.round(spawnPoint('anna').y * 10)], [idB, Math.round(spawnPoint('sol').x * 10), Math.round(spawnPoint('sol').y * 10)]]);
  await tv.until(`window.bloko.avatars().length === 2`, 'avatars back');
  await sleep(500);
  check((await spawnOk()) === exp, 'lobby restart: avatars back, at their spawn points');

  // ---------- playing: presence on boards, kill -9 ----------
  let i = A2.mark(); A2.send({ t: 'start' });
  await A2.waitFor((m) => m.t === 'view' && m.state.phase === 'playing', i);
  check(await tv.until(`${tvState}.phase === 'playing'`, 'playing'), 'TV shows the game');
  i = B.mark(); A2.send({ t: 'place', ...legalMoves(A2.lastView(), idA)[0] }); await B.waitFor((m) => m.t === 'view', i);
  await drop(B);
  check(await tv.until(`document.querySelector('.panel[data-id="${idB}"]')?.classList.contains('is-offline')`, 'board dim', 3500),
    "mid-game drop → that player's board is dimmed + tagged");
  check(!(await tv.js(`document.querySelector('.panel[data-id="${idA}"]').classList.contains('is-offline')`)), '…the online player is not');
  const tag = await tv.js(`getComputedStyle(document.querySelector('.panel[data-id="${idB}"] .panel-head'), '::after').content`);
  check(String(tag).includes('offline'), `…with the "offline" tag (${tag})`);
  await tv.shot('playing-offline');
  B = await device('B6'); await tap(B, 'sol');
  check(await tv.until(`!document.querySelector('.panel[data-id="${idB}"]').classList.contains('is-offline')`, 'undim', 1500), 'reclaim mid-game → board back to normal');
  i = A2.mark(); B.send({ t: 'place', ...legalMoves(B.lastView(), idB)[0] }); await A2.waitFor((m) => m.t === 'view', i);
  await killAndBack(tv, 'playing');
  check(await tv.until(`document.querySelectorAll('.panel.is-offline').length === 2`, 'all offline after restart', 3500),
    'after a restart, nobody reconnected yet → both boards tagged offline (true: online is empty)');
  A2 = await rejoin('A3', idA); B = await rejoin('B7', idB);
  check(await tv.until(`document.querySelectorAll('.panel.is-offline').length === 0`, 'back online'), 'phones reconnect → tags clear');

  // ---------- wake from sleep: JS paused 6 s (timers stop, wall time runs) ----------
  tv.console.length = 0;
  await tv.cmd('Debugger.pause');
  await sleep(6000);
  await tv.cmd('Debugger.resume');
  check(await tv.until('true', 'noop', 100) && (await (async () => { const end = Date.now() + 3000; while (Date.now() < end) { if (tv!.console.some((l) => l.includes('woke after'))) return true; await sleep(50); } return false; })()),
    'wake after a 6 s freeze → TV drops the old socket and reconnects');
  check(await tv.until(`!${tvOnlineBanner}`, 'reconnected'), '…and is live again');
  i = B.mark(); A2.send({ t: 'place', ...legalMoves(A2.lastView(), idA)[0] }); await B.waitFor((m) => m.t === 'view', i);
  const sc = A2.lastView().players[idA].score;
  check(await tv.until(`${tvState}.players['${idA}'].score === ${sc}`, 'live after wake'), 'a move after the wake reaches the TV');

  // ---------- finished: kill -9 on the podium ----------
  await playToDone(A2, idA, B, rnd);
  await playToDone(B, idB, A2, rnd);
  check(await tv.until(`${tvState}.phase === 'finished'`, 'podium'), 'TV shows the podium');
  await killAndBack(tv, 'finished');
  A2 = await rejoin('A4', idA); B = await rejoin('B8', idB);

  // ---------- newGame: back to the party room, newcomer appears ----------
  i = A2.mark(); A2.send({ t: 'newGame' });
  await A2.waitFor((m) => m.t === 'view' && m.state.phase === 'lobby', i);
  check(await tv.until(`${tvState}.phase === 'lobby' && !document.getElementById('party-bg').hidden && document.body.classList.contains('party')`, 'party back'),
    'newGame → TV back in the party room');
  check(await tv.until('window.bloko.avatars().length === 2', 'avatars'), '…with both avatars');
  A2.send({ t: 'pos', x: 6, y: 6, dir: 'left', moving: false });
  check(await tv.until(`(() => { const a = window.bloko.avatars().find((a) => a.id === '${idA}'); return a && Math.abs(a.x - 6) < 0.2; })()`, 'avatar moves'),
    '…and avatars resume walking (pos relayed)');
  const N = await device('N'); const idN = await tap(N, 'pierre');
  check(await tv.until(`window.bloko.avatars().some((a) => a.id === '${idN}') && document.querySelector('.lobby-count').textContent.includes('3/')`, 'newcomer'),
    'a newcomer joins after newGame and appears on the TV');
  await tv.shot('newgame-lobby');
  for (const c of [A2, B, N]) c.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).stack}\n--- server log ---\n${log}`);
} finally {
  tv?.close(); tv2?.close();
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
