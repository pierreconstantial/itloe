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
import { SAMPLE_CONTENT } from '../shared/campaign/index.js';

/** A node's title (the server runs the sample content). @param {string} id */
const C_TITLE = (id: string): string => SAMPLE_CONTENT.nodes[id].title;
import { check, Client, finish, HTTP, legalMoves, sleep, SLOW } from './e2e-lib.mts';

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
  // a server left over from an aborted run would silently answer instead of ours
  if (await fetch(`${HTTP}/api/join`).then(() => true, () => false)) throw new Error(`port ${PORT} is busy: fuser -k ${PORT}/tcp`);
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
  targetId = '';
  seq = 0;
  pending = new Map<number, (r: any) => void>();
  console: string[] = [];
  errors: string[] = [];
  /** @param newWindow its own window: visible alongside the others (a second TV), not a background tab */
  static async open(url: string, newWindow = false): Promise<Page> {
    const t = newWindow ? await Page.newWindow(url) : await (await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const p = new Page();
    p.targetId = t.id;
    p.ws = new WebSocket(t.webSocketDebuggerUrl);
    p.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && p.pending.has(m.id)) { p.pending.get(m.id)!(m); p.pending.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled') p.console.push(m.params.args.map((a: any) => a.value).join(' '));
      if (m.method === 'Runtime.exceptionThrown') p.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    };
    await new Promise((r) => { p.ws.onopen = r; });
    await p.cmd('Runtime.enable');
    await p.cmd('Debugger.enable');
    await p.cmd('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await p.front();
    return p;
  }
  /**
   * Makes this the visible, focused tab. Full Chrome (unlike headless_shell) hides background tabs:
   * their timers are throttled to ~1/min and the TV's wake check skips hidden tabs on purpose — a
   * real TV tab is visible. Call after opening another tab and before any timing-sensitive step.
   */
  async front(): Promise<void> {
    await this.cmd('Page.enable');
    await this.cmd('Page.bringToFront');
    await this.cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  visible(): Promise<boolean> { return this.js("document.visibilityState === 'visible'"); }
  /** Target.createTarget({ newWindow }) through the browser endpoint → the new page's /json entry. */
  static async newWindow(url: string): Promise<any> {
    const ver = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
    const b = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r) => { b.onopen = r; });
    const res: any = await new Promise((r) => {
      b.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id === 1) r(m); };
      b.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url, newWindow: true } }));
    });
    b.close();
    const id = res.result.targetId;
    for (let k = 0; k < 50; k++) {
      const t = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x: any) => x.id === id);
      if (t) return t;
      await sleep(50);
    }
    throw new Error('new window target not listed');
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
    const end = Date.now() + ms * SLOW;
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
  /** Closes the TAB, not just the debugger socket: a leaked TV tab keeps reconnecting to every later server. */
  async close(): Promise<void> {
    this.ws.close();
    await fetch(`http://127.0.0.1:${CDP}/json/close/${this.targetId}`).catch(() => undefined);
  }
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


/** kill -9, check the TV shows the banner, restart, check it comes back with the same game. */
async function killAndBack(tv: Page, phase: string, ref: Client): Promise<void> {
  // the TV must have caught up with the last move before the snapshot (views race the kill)
  const want = boardsOf(ref.lastView());
  await tv.until(`(() => { const s = window.bloko.state(); return !!s && JSON.stringify(s.order.map((id) => [id, s.players[id].board, s.players[id].score, s.players[id].hand])) === ${JSON.stringify(want)}; })()`, 'tv converged');
  const before = await tv.js(`JSON.stringify(${tvState})`);
  await kill9();
  check(await tv.until(tvOnlineBanner, 'banner'), `${phase}: kill -9 → TV shows the "Connecting…" banner`);
  await tv.shot(`kill-${phase}-banner`);
  await sleep(1500);
  await boot();
  const t0 = Date.now();
  const back = await tv.until(`!${tvOnlineBanner}`, 'reconnect', 6000);
  console.log(`      (${phase}: TV back ${Date.now() - t0} ms after the server answered)`);
  if (!back) {
    console.log('      diag:', await tv.js(`JSON.stringify({ vis: document.visibilityState, focus: document.hasFocus(), cls: document.body.className })`),
      '| console:', tv.console.slice(-6).join(' / '), '| errors:', tv.errors.slice(-3).join(' / '));
  }
  check(back, `${phase}: restart → TV reconnects by itself, banner gone`);
  await sleep(300);
  const after = await tv.js(`JSON.stringify(${tvState})`);
  const a = JSON.parse(after), b = JSON.parse(before);
  const same = a.phase === phase && boardsOf(a) === boardsOf(b) && a.hostId === b.hostId;
  if (!same) {
    const diff = a.order.map((id: string) => `${id}: score ${b.players[id]?.score}→${a.players[id]?.score} hand ${JSON.stringify(b.players[id]?.hand)}→${JSON.stringify(a.players[id]?.hand)} done ${b.players[id]?.done}→${a.players[id]?.done}`);
    console.log(`      diff: phase ${b.phase}→${a.phase} host ${b.hostId}→${a.hostId} seed ${b.seed}→${a.seed} | ${diff.join(' | ')}`);
  }
  check(same, `${phase}: same phase, boards/scores/hands, host after the restart`);
}

let tv: Page | null = null, tv2: Page | null = null;
try {
  // tabs left by an aborted run on OUR port would join our server as extra TVs: close them first
  for (const t of await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()) {
    if (t.type === 'page' && String(t.url).startsWith(`${HTTP}/screen`)) await fetch(`http://127.0.0.1:${CDP}/json/close/${t.id}`);
  }
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
  await tv2.close(); tv2 = null;
  await tv.front();
  check(await tv.until("document.visibilityState === 'visible'", 'tv visible', 2000), 'TV tab is visible again (test setup)');
  B = B4;

  // ---------- kill -9 in the lobby ----------
  await killAndBack(tv, 'lobby', B);
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
  await killAndBack(tv, 'playing', A2);
  check(await tv.until(`document.querySelectorAll('.panel.is-offline').length === 2`, 'all offline after restart', 3500),
    'after a restart, nobody reconnected yet → both boards tagged offline (true: online is empty)');
  A2 = await rejoin('A3', idA); B = await rejoin('B7', idB);
  check(await tv.until(`document.querySelectorAll('.panel.is-offline').length === 0`, 'back online'), 'phones reconnect → tags clear');

  // ---------- wake from sleep: JS paused 6 s (timers stop, wall time runs) ----------
  await tv.front();
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

  // ---------- silent socket (half-open): SIGSTOP the server, TCP stays up but nothing arrives ----------
  const t0 = A2.ticks.length;
  for (let k = 0; k < 120 && A2.ticks.length === t0; k++) await sleep(100);
  const tk = A2.ticks.at(-1);
  check(A2.ticks.length > t0 && typeof tk?.now === 'number' && Math.abs(tk.now - Date.now()) < 2000, "server sends {t:'tick', now} to every socket, at least every 10 s");
  await tv.front();
  tv.console.length = 0;
  const stoppedAt = Date.now();
  server!.kill('SIGSTOP');
  const silentHit = await (async () => {
    const end = Date.now() + 36_000;
    while (Date.now() < end) { if (tv!.console.some((l) => l.includes('no message for 25 s'))) return true; await sleep(100); }
    return false;
  })();
  const silentAfter = Date.now() - stoppedAt;
  check(silentHit && silentAfter <= 26_000, `silent socket → TV gives up on it by itself (${Math.round(silentAfter / 1000)} s after the server froze; ≤ 25 s of silence)`);
  server!.kill('SIGCONT');
  check(await tv.until(`!${tvOnlineBanner}`, 'back after SIGCONT', 8000), '…server back → TV live again');
  i = B.mark(); A2.send({ t: 'place', ...legalMoves(A2.lastView(), idA)[0] }); await B.waitFor((m) => m.t === 'view', i);
  const sc2 = A2.lastView().players[idA].score;
  check(await tv.until(`${tvState}.players['${idA}'].score === ${sc2}`, 'live after silence'), '…and the next move reaches it');

  // ---------- host controls: retire shows "Out", endGame shows the podium with its line ----------
  i = A2.mark(); A2.send({ t: 'retire', target: idB });
  await A2.waitFor((m) => m.t === 'view' && m.state.players[idB].retired, i);
  check(await tv.until(`document.querySelector('.panel[data-id="${idB}"] .done-overlay')?.textContent.includes('Out')`, 'out overlay'),
    'host retires a player → their board shows "🚪 Out" on the TV');
  await tv.shot('retired');
  i = A2.mark(); A2.send({ t: 'endGame' });
  await A2.waitFor((m) => m.t === 'view' && m.state.phase === 'finished', i);
  check(await tv.until(`${tvState}.phase === 'finished' && document.querySelector('.podium-ending')?.textContent === 'Game ended by the host'`, 'podium'),
    'host endGame → TV podium says "Game ended by the host"');
  check(await tv.js(`[...document.querySelectorAll('.rank-row')].some((r) => r.textContent.includes('Sol') && r.querySelector('.out-tag'))`),
    '…and the retired player is ranked with an "out" tag');
  await sleep(4000);
  await tv.shot('podium-host');
  await killAndBack(tv, 'finished', A2);
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

  // ---------- campaign: hub map with doors, combined unlock cutscene, two TVs, chooser walks in ----------
  tv.errors.length = 0;
  const cv = () => [...A2.msgs].reverse().find((m) => m.t === 'view')?.campaign;
  const doorsJs = `JSON.stringify(Object.fromEntries(window.bloko.doors().map((d) => [d.id, d.state])))`;
  i = A2.mark(); A2.send({ t: 'back' });
  const hubView = await A2.waitFor((m) => m.t === 'view' && m.state === null, i);
  check(await tv.until(`window.bloko.state() === null && !!document.querySelector('.map-band') && !document.getElementById('party-bg').hidden && window.bloko.avatars().length === 3`, 'hub map'),
    `back to the hub (state null, at ${hubView.campaign?.at?.node}) → TV shows the map in the party room, every avatar there`);
  const d0 = JSON.parse(await tv.js(doorsJs));
  check(d0['hub.false-start'] === 'open' && d0.childhood === 'locked' && d0.teens === 'locked' && d0.adult === 'locked',
    `hub doors: false start open, the worlds locked (${JSON.stringify(d0)})`);
  check(!!(await tv.js('window.bloko.contentVersion()')), 'TV loaded the content from /api/content (versioned)');
  await tv.shot('hub-map-locked');

  // play the false start until the 3rd game unlocks the worlds; a second TV is open for the last one
  i = A2.mark(); A2.send({ t: 'enter', node: 'hub.false-start' });
  await A2.waitFor((m) => m.t === 'view' && m.state?.phase === 'lobby', i);
  tv2 = await Page.open(`${HTTP}/screen/`, true); // its own window: BOTH TVs visible, both play
  await tv2.until(`window.bloko?.state()?.phase === 'lobby'`, 'tv2');
  check(await tv.visible() && await tv2.visible(), 'two TVs, both visible (separate windows)');
  for (let g = 0; g < 4 && !(cv()?.news ?? []).length; g++) {
    if (A2.lastView().phase === 'finished') { i = A2.mark(); A2.send({ t: 'newGame' }); await A2.waitFor((m) => m.t === 'view' && m.state?.phase === 'lobby', i); }
    i = A2.mark(); A2.send({ t: 'start' }); await A2.waitFor((m) => m.t === 'view' && m.state?.phase === 'playing', i);
    i = A2.mark(); A2.send({ t: 'endGame' }); await A2.waitFor((m) => m.t === 'view' && m.state?.phase === 'finished', i);
  }
  const pending = cv()?.news ?? [];
  check(pending.length > 0 && cv().facts.counters['blocks.played'] === 3, `3rd block game → news queued (${pending.length} entries, seq ${pending[0]?.seq}…${pending.at(-1)?.seq})`);
  check(!(await tv.js('window.bloko.cutscene().playing')), 'cutscene waits for the podium reveal');
  check(await tv.until(`window.bloko.cutscene().playing && /New worlds unlocked/.test(window.bloko.cutscene().text)`, 'cutscene', 12000),
    'podium settled → ONE combined moment: "New worlds unlocked!"');
  const csText = await tv.js('window.bloko.cutscene().text');
  check(csText.includes(C_TITLE('childhood')) && csText.includes(C_TITLE('teens')) && csText.includes('Reward'), `…naming both worlds and the reward (${csText})`);
  await sleep(1500);
  await tv.shot('cutscene');
  for (let k = 0; k < 150 && (cv()?.news ?? []).length; k++) await sleep(100);
  check((cv()?.news ?? []).length === 0, 'after the moment, an ack clears the news on the server');
  await sleep(2500);
  const c1 = await tv.js('window.bloko.cutscene()'), c2 = await tv2.js('window.bloko.cutscene()');
  check(c1.moments === 1 && c2.moments === 1 && !c1.playing && !c2.playing, `both TVs played the moment exactly once, no replay (TV1 ${c1.moments}, TV2 ${c2.moments})`);
  check(c1.acks + c2.acks === 1, `ack sent once across the two TVs (TV1 ${c1.acks}, TV2 ${c2.acks})`);
  check(c1.maxShown === pending.at(-1)?.seq && c2.maxShown === pending.at(-1)?.seq, `both remember the last seq shown (${c1.maxShown}, ${c2.maxShown})`);
  await tv2.close(); tv2 = null;
  await tv.front();

  // back on the hub: the new doors glow
  i = A2.mark(); A2.send({ t: 'back' });
  await A2.waitFor((m) => m.t === 'view' && m.state === null, i);
  check(await tv.until(`${doorsJs} === ${JSON.stringify(JSON.stringify({ 'hub.false-start': 'done', childhood: 'new', teens: 'new', adult: 'locked' }))}`, 'doors after unlock'),
    'hub doors: false start done ★, both worlds NEW (glowing), the third still locked');
  check(await tv.js(`document.querySelector('.map-items')?.textContent.includes('reward-1')`), 'the reward shows in the map band');
  await sleep(600);
  await tv.shot('hub-map-new');

  // the chooser (Élodie) joins and walks into the childhood door → the TV switches to that world
  const E = await device('E'); await tap(E, 'elodie');
  await tv.until('window.bloko.avatars().length === 4', 'elodie avatar');
  E.send({ t: 'pos', x: 8, y: 8, dir: 'up', moving: true });
  await sleep(150);
  const cd = SAMPLE_CONTENT.nodes.childhood.door!;
  E.send({ t: 'pos', x: cd.x + cd.w / 2, y: cd.y + cd.h / 2, dir: 'up', moving: true });
  check(await tv.until(`window.bloko.campaign()?.at.node === 'childhood' && document.querySelector('.map-title')?.textContent === ${JSON.stringify(C_TITLE('childhood'))}`, 'world'),
    'Élodie walks into the childhood door → TV switches to that world');
  const dw = JSON.parse(await tv.js(doorsJs));
  check(dw['childhood.blocks'] === 'new' && dw['childhood.scene'] === 'new', `world doors: its two tableaux, new (${JSON.stringify(dw)})`);
  await sleep(600);
  await tv.shot('world-map');
  check(tv.errors.length === 0, `no page exception through the campaign (${tv.errors.join(' | ') || 'none'})`);

  // ---------- quiz: World 1's block game opens its quiz door; lobby → questions → reveals → podium ----------
  const lastQuiz = (c: Client) => [...c.msgs].reverse().find((m) => m.t === 'view')?.quiz;
  i = A2.mark(); A2.send({ t: 'enter', node: 'childhood.blocks' });
  await A2.waitFor((m) => m.t === 'view' && m.state?.phase === 'lobby', i);
  i = A2.mark(); A2.send({ t: 'start' }); await A2.waitFor((m) => m.t === 'view' && m.state?.phase === 'playing', i);
  i = A2.mark(); A2.send({ t: 'endGame' }); await A2.waitFor((m) => m.t === 'view' && m.state?.phase === 'finished', i);
  i = A2.mark(); A2.send({ t: 'back' }); await A2.waitFor((m) => m.t === 'view' && m.state === null && m.campaign?.at.node === 'childhood', i);
  check(await tv.until(`JSON.parse(${doorsJs})['childhood.quiz'] !== 'locked'`, 'quiz door'), "World 1's block game done → its quiz door opens");
  i = A2.mark(); A2.send({ t: 'enter', node: 'childhood.quiz' });
  const ql = await A2.waitFor((m) => m.t === 'view' && m.quiz?.phase === 'lobby', i);
  check(await tv.until(`!!document.querySelector('.quiz-lobby') && document.querySelectorAll('.quiz-lobby .quiz-chip').length === ${ql.quiz.order.length}`, 'quiz lobby'),
    `quiz lobby on the TV: "Quiz!", the ${ql.quiz.order.length} seated players, settings line`);
  check(/questions · \d+ s each/.test(await tv.js(`document.querySelector('.quiz-lobby .settings-line')?.textContent ?? ''`)), '…with the quiz settings summary');
  if ((ql.quiz.credits ?? []).length) {
    check(await tv.until(`document.querySelector('.quiz-lobby .quiz-credits')?.textContent.includes(${JSON.stringify(String(ql.quiz.credits[0]).slice(0, 16))})`, 'credits'),
      'quiz lobby: dataset credits line (CC BY-SA attribution)');
  }
  await tv.shot('quiz-lobby');

  const phones = [A2, B, N, E];
  const seated: string[] = ql.quiz.order;
  const phoneOf = (id: string) => phones.find((c) => [...c.msgs].some((m) => m.t === 'welcome' && m.playerId === id));
  i = A2.mark(); A2.send({ t: 'start' });
  let qv = (await A2.waitFor((m) => m.t === 'view' && m.quiz?.phase === 'question', i)).quiz;
  let rounds = 0, anecdotes = 0;
  while (qv?.phase === 'question' && rounds < 12) {
    rounds++;
    const choice = !!qv.round.question.choices;
    check(await tv.until(`!!document.querySelector('.quiz-question') && document.querySelector('.quiz-q')?.textContent === ${JSON.stringify(qv.round.question.q)}`, 'question'),
      `Q${rounds}: the question on the TV (${choice ? 'A–D tiles' : 'typed answer'})`);
    if (rounds === 1) {
      check(await tv.js(`!document.querySelector('.is-right') && !document.querySelector('.quiz-anecdote') && !document.querySelector('.quiz-source') && document.querySelectorAll('.quiz-choice').length === ${choice ? qv.round.question.choices.length : 0}`), '…no answer (nor anecdote, nor source) shown before the reveal');
      const n0 = Number(await tv.js(`document.querySelector('.quiz-ring-num')?.textContent`));
      await sleep(1300);
      const n1 = Number(await tv.js(`document.querySelector('.quiz-ring-num')?.textContent`));
      check(n0 > 0 && n1 < n0, `…the countdown ring runs (${n0} → ${n1})`);
      check(!(await tv.js(`!!document.querySelector('.cutscene')`)), '…no unlock cutscene covers the question (interrupted, replayed when calm)');
      await tv.shot('quiz-question');
    }
    // the first seated player answers: only their chip lights up
    const [first, ...rest] = seated;
    phoneOf(first)!.send(choice ? { t: 'answer', choice: 0 } : { t: 'answer', text: 'Victor Hugo' });
    check(await tv.until(`document.querySelector('.quiz-question .quiz-chip[data-id="${first}"]')?.classList.contains('has-answered')
      && [...document.querySelectorAll('.quiz-question .quiz-chip.has-answered')].length === 1`, 'chip'),
      `Q${rounds}: who answered is shown (one chip lit, nothing about what)`);
    i = A2.mark();
    for (const id of rest) phoneOf(id)!.send(choice ? { t: 'answer', choice: 1 } : { t: 'answer', text: 'nope' });
    const rv = (await A2.waitFor((m) => m.t === 'view' && m.quiz?.phase === 'reveal', i, 6000)).quiz;
    check(await tv.until(`document.querySelectorAll('.quiz-reveal .quiz-result').length === ${seated.length}`
      + (choice ? ` && document.querySelectorAll('.quiz-choice.is-right').length === 1` : ` && !!document.querySelector('.quiz-answer')`), 'reveal'),
      `Q${rounds}: reveal: the right answer lit, one result per player`);
    const marks = await tv.js(`JSON.stringify([...document.querySelectorAll('.quiz-result')].map((r) => r.className.replace('quiz-result ', '')))`);
    const want = JSON.stringify(seated.map((id) => `is-${rv.round.answers[id]?.ok === null ? 'pending' : rv.round.answers[id]?.ok ? 'right' : rv.round.answers[id] ? 'wrong' : 'none'}`));
    check(marks === want, `Q${rounds}: ✓/✗ match the server's verdicts (${marks})`);
    const source = rv.round.answer?.source;
    if (source) check(await tv.until(`document.querySelector('.quiz-reveal .quiz-source')?.textContent.includes(${JSON.stringify(String(source).slice(0, 16))})`, 'source'), `Q${rounds}: reveal shows the question's source`);
    const anecdote = rv.round.answer?.anecdote;
    if (anecdote) {
      anecdotes++;
      check(await tv.until(`document.querySelector('.quiz-anecdote')?.textContent.includes(${JSON.stringify(anecdote.slice(0, 20))})`, 'anecdote'),
        `Q${rounds}: the reveal shows the anecdote`);
    }
    if (rounds === 1 || (anecdote && anecdotes === 1)) { await sleep(900); await tv.shot(anecdote ? 'quiz-reveal-anecdote' : 'quiz-reveal'); }
    i = A2.mark(); A2.send({ t: 'next' });
    qv = (await A2.waitFor((m) => m.t === 'view' && (m.quiz?.phase === 'question' || m.quiz?.phase === 'finished'), i)).quiz;
  }
  check(qv?.phase === 'finished', `quiz played through (${rounds} questions, ${anecdotes} with an anecdote)`);
  check(await tv.until(`document.querySelector('.podium .title')?.textContent === 'Quiz podium' && document.querySelectorAll('.rank-row').length === ${seated.length}`, 'quiz podium'),
    'finished → the quiz podium, every player ranked');
  check(await tv.js(`[...document.querySelectorAll('.rank-correct')].every((e) => e.textContent.includes('/') && e.textContent.trim().endsWith('✓'))`), '…with each player\'s right answers');
  if ((qv.credits ?? []).length) check(await tv.js(`!!document.querySelector('.podium .quiz-credits')`), 'quiz podium: dataset credits line');
  await sleep(4500);
  await tv.shot('quiz-podium');
  i = A2.mark(); A2.send({ t: 'back' });
  await A2.waitFor((m) => m.t === 'view' && !m.quiz && m.campaign?.at.node === 'childhood', i);
  check(await tv.until(`!document.querySelector('.quiz') && !!document.querySelector('.map-band') && !document.body.classList.contains('in-quiz')`, 'out of quiz'),
    'host back → the world map again (quiz screen gone)');
  check(tv.errors.length === 0, `no page exception through the quiz (${tv.errors.join(' | ') || 'none'})`);
  E.ws.close();
  for (const c of [A2, B, N]) c.ws.close();
} catch (e) {
  check(false, `crashed: ${(e as Error).stack}\n--- server log ---\n${log}`);
} finally {
  await tv?.close(); await tv2?.close();
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
