// Phone end-to-end (slice 2/2b, phone side): real /play/ pages in headless Chrome (CDP), each phone a
// separate browser context (= a separate device), driven by real taps and navigations, against a real
// server this script kills, freezes and restarts. Checks the session is never lost (reload, back/forward,
// bfcache, QR re-scan, locked phone, server restart, silent dead link), the picker only shows when the
// server does not know us (then preselects "Continue as …"), the podium choices, reclaim from another
// device with no tug of war, the host controls during a game (take a player out, end the game), and the
// campaign screens (hub/world "where we are", game-master panel, the chooser walking into a door).
// Usage: start Chrome with --remote-debugging-port=<CDP>, then
//        PORT=3182 CDP=9222 [LOCK_MS=300000] node scripts/e2e-phone.mts    (never PORT 3131: the live server)
// LOCK_MS is how long the "phone locked" case freezes the page (default 5 min, as in the acceptance list).
// ONLY=3 / ONLY=4 runs just part 3 (campaign screens) / part 4 (quiz), for quick iteration; a full run is the acceptance.
// SHOTS=<dir> saves screenshots of the campaign screens.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, Client, finish, HTTP, sleep, SLOW } from './e2e-lib.mts';

const PORT = process.env.PORT ?? '3141';
if (PORT === '3131') throw new Error('3131 is the live server: pick another PORT');
const CDP = process.env.CDP ?? '9222';
const LOCK_MS = Number(process.env.LOCK_MS ?? 5 * 60_000);
const SHOTS = process.env.SHOTS; // a folder: screenshots of the campaign screens land there
const VAR = mkdtempSync(join(tmpdir(), 'bloko-phone-'));
const MAIN = new URL('../server/main.ts', import.meta.url).pathname;

/** check() with the observed detail appended to the label. */
const expect = (cond: boolean, label: string, note = '') => check(cond, note ? `${label}  — ${note}` : label);

// ---------- server ----------
let server: ChildProcess | null = null;
let log = '';
let room = '';
async function boot(fresh = false): Promise<void> {
  log = '';
  server = spawn(process.execPath, [MAIN, ...(fresh ? ['--new'] : [])], {
    env: { ...process.env, PORT, BLOKO_VAR: VAR, BLOKO_HOST: '127.0.0.1' },
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
  s.kill('SIGCONT'); // in case it was frozen
  s.kill('SIGKILL');
  await gone;
  server = null;
}
const freeze = (on: boolean) => server!.kill(on ? 'SIGSTOP' : 'SIGCONT');
const joinUrl = () => `${HTTP}/play?room=${room}`;

// ---------- hygiene: never share the port, never leave ghost tabs ----------
// A test server must be ours alone; tabs left over from a killed run would keep reconnecting to it as
// ghost clients (extra load, extra broadcasts). Close them by target id (closing a CDP socket does not).
if (await fetch(`${HTTP}/api/join`).then(() => true, () => false)) throw new Error(`port ${PORT} is busy: stop whatever runs there first`);
{
  const tabs: { id: string, url: string }[] = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
  const ghosts = tabs.filter((t) => t.url.includes(`:${PORT}/`));
  for (const t of ghosts) await fetch(`http://127.0.0.1:${CDP}/json/close/${t.id}`).catch(() => {});
  if (ghosts.length) console.log(`  (closed ${ghosts.length} tab(s) left on :${PORT} by an earlier run)`);
}

// ---------- CDP: one browser connection, one flattened session per phone ----------
const version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
const browser = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => { browser.onopen = r; });
let seq = 0;
const waiting = new Map<number, (m: any) => void>();
const events: ((m: any) => void)[] = [];
browser.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); return; }
  for (const f of events) f(m);
};
function cmd(method: string, params: object = {}, sessionId?: string): Promise<any> {
  const id = ++seq;
  browser.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => waiting.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))));
}

// Instrumentation that survives navigations (sessionStorage is per tab): did the picker ever show
// while watched? was the last pageshow a bfcache restore?
const PROBE = `(() => {
  // haptics: record every vibration pattern (headless has no motor) so the tests can check them
  window.__vibes = [];
  navigator.vibrate = (p) => { window.__vibes.push(JSON.stringify(p)); return true; };
  addEventListener('pageshow', (e) => sessionStorage.setItem('t-persisted', String(e.persisted)));
  setInterval(() => {
    const p = document.getElementById('view-pick');
    if (p && !p.hidden && sessionStorage.getItem('t-watch') === '1') sessionStorage.setItem('t-sawPick', '1');
  }, 15);
})();`;

type Snap = { view: string | null, banner: boolean, toast: string | null, id: string | null, sawPick: boolean, persisted: string | null };
const contexts: string[] = [];

async function phone(label: string) {
  const { browserContextId } = await cmd('Target.createBrowserContext');
  contexts.push(browserContextId);
  const { targetId } = await cmd('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId: s } = await cmd('Target.attachToTarget', { targetId, flatten: true });
  await cmd('Page.enable', {}, s);
  await cmd('Runtime.enable', {}, s);
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, s);
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true }, s); // background tabs stay "focused"
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: PROBE }, s);
  events.push((m) => {
    if (m.sessionId !== s || m.method !== 'Runtime.exceptionThrown') return;
    const text = m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text;
    if (!/sessionStorage/.test(text)) console.log(`[${label}] page exception: ${text}`); // the probe on about:blank
  });

  const ev = async (expr: string): Promise<any> => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, s);
    if (r.exceptionDetails) throw new Error(`${label}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const snap = (): Promise<Snap | null> => ev(`(() => {
    const t = document.getElementById('toast');
    return {
      view: [...document.querySelectorAll('main > section')].find((e) => !e.hidden)?.id ?? null,
      banner: !document.getElementById('conn-banner').hidden,
      toast: t && !t.hidden ? t.textContent : null,
      id: localStorage.getItem('bloko-id'),
      sawPick: sessionStorage.getItem('t-sawPick') === '1',
      persisted: sessionStorage.getItem('t-persisted'),
    };
  })()`).catch(() => null);
  const waitFor = async (pred: (x: Snap) => boolean, ms = 8000): Promise<Snap | null> => {
    const end = Date.now() + ms * SLOW; // E2E_SLOW=n on a loaded machine
    let last: Snap | null = null;
    while (Date.now() < end) {
      last = await snap();
      if (last && pred(last)) return last;
      await sleep(100);
    }
    return last;
  };
  /** A real touch (user activation: arms the back guard). */
  const tap = async (selector: string) => {
    // headless: a background or just-unfrozen tab stays hidden and never acks synthetic input
    await cmd('Page.bringToFront', {}, s);
    const box = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const touched = (async () => {
      await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] }, s);
      await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s);
      return true;
    })();
    // a tab that went through Page.setWebLifecycleState can stop acking synthetic input in headless
    // Chrome: fall back to a DOM click (no user activation, fine for buttons) instead of hanging
    if (!(await Promise.race([touched, sleep(3000).then(() => false)]))) {
      console.log(`  [${label}] synthetic touch not acked (headless lifecycle quirk): clicking ${selector} instead`);
      await ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
    }
    await sleep(150);
  };
  /** Drag the first tray piece onto the lower middle of the board (mouse: pointer events). */
  const placeOne = async () => {
    await cmd('Page.bringToFront', {}, s);
    const r = await ev(`(() => { const s = document.getElementById('slot-0').getBoundingClientRect(); const b = document.getElementById('board').getBoundingClientRect(); return { sx: s.x + s.width / 2, sy: s.y + s.height / 2, bx: b.x + b.width / 2, by: b.y + b.height * 0.75 }; })()`);
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.sx, y: r.sy, button: 'left', clickCount: 1 }, s);
    for (let i = 1; i <= 8; i++) {
      await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.sx + (r.bx - r.sx) * i / 8, y: r.sy + (r.by - r.sy) * i / 8, button: 'left' }, s);
    }
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.bx, y: r.by, button: 'left', clickCount: 1 }, s);
    await sleep(600);
  };
  const watch = (on: boolean) => ev(`sessionStorage.setItem('t-watch', '${on ? 1 : 0}'); sessionStorage.removeItem('t-sawPick')`);
  const navigate = (url: string) => cmd('Page.navigate', { url }, s);
  const history = async (delta: number) => {
    const h = await cmd('Page.getNavigationHistory', {}, s);
    const entry = h.entries[h.currentIndex + delta];
    if (entry) await cmd('Page.navigateToHistoryEntry', { entryId: entry.id }, s);
  };
  // unlocking a real phone makes the page VISIBLE again: bring the tab to the front, or headless Chrome
  // keeps it hidden and (after 5 min) throttles its timers to about one per minute
  const lifecycle = async (state: 'frozen' | 'active') => {
    await cmd('Page.setWebLifecycleState', { state }, s);
    if (state === 'active') await cmd('Page.bringToFront', {}, s);
  };
  const board = (): Promise<string> => ev(`[...document.querySelectorAll('#board .cell')].map((c) => c.className.replace(/ ?(ghost-ok|ghost-bad|clear-preview)/g, '')).join('|') + '#' + document.getElementById('my-score').textContent`);
  const card = (id: string): Promise<{ disabled: boolean, badge: string }> =>
    ev(`(() => { const c = document.querySelector('.pick-card[data-id="${id}"]'); return { disabled: c.disabled, badge: c.querySelector('.pick-badge').textContent }; })()`);
  const continueButton = (): Promise<{ shown: boolean, text: string }> =>
    ev(`(() => { const b = document.getElementById('btn-continue'); return { shown: !b.hidden, text: b.textContent }; })()`);
  const hostButtons = (): Promise<string[]> => ev(`[...document.querySelectorAll('.host-control')].map((e) => e.textContent)`);
  /** Holds the joystick and steers it, closed loop, until `done(pos)` (pos = the server's relay of our avatar). */
  const steer = async (target: { x: number, y: number }, done: () => boolean, where: () => { x: number, y: number } | null, ms = 20_000) => {
    await cmd('Page.bringToFront', {}, s);
    const pad = await ev(`(() => { const r = document.getElementById('stick-pad').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pad.x, y: pad.y }] }, s);
    const end = Date.now() + ms;
    while (Date.now() < end && !done()) {
      const at = where() ?? { x: 8, y: 4.5 };
      const dx = target.x - at.x, dy = target.y - at.y;
      const len = Math.hypot(dx, dy) || 1;
      const push = Math.min(56, 20 + len * 12); // slow down near the target
      await cmd('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pad.x + (dx / len) * push, y: pad.y + (dy / len) * push }] }, s);
      await sleep(80);
    }
    await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s);
  };
  /** Real typing into a field (focus by a tap, then the keyboard's text). */
  const type = async (selector: string, value: string) => {
    await tap(selector);
    await cmd('Input.insertText', { text: value }, s);
    await sleep(100);
  };
  const vibes = (): Promise<string[]> => ev('window.__vibes ?? []');
  const text = (id: string): Promise<string> => ev(`document.getElementById(${JSON.stringify(id)})?.textContent ?? ''`);
  const visible = (id: string): Promise<boolean> => ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && e.offsetParent !== null; })()`);
  const shot = async (name: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await cmd('Page.bringToFront', {}, s);
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' }, s);
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  };
  return { label, ev, snap, waitFor, tap, placeOne, watch, navigate, history, lifecycle, board, card, continueButton, hostButtons, steer, text, visible, shot, type, vibes };
}
type Phone = Awaited<ReturnType<typeof phone>>;

/** Same id, expected view, no banner, picker never shown since the last watch. */
async function resumes(p: Phone, label: string, view: string, id: string | null, ms = 8000): Promise<void> {
  const x = await p.waitFor((y) => y.view === view && !y.banner, ms);
  expect(!!x && x.view === view && !x.banner && x.id === id && !x.sawPick, label,
    x ? `view=${x.view} banner=${x.banner} sameId=${x.id === id} sawPick=${x.sawPick} bfcache=${x.persisted}` : 'no snapshot');
  await p.watch(true);
}

/** Joins a fresh phone as `character`; returns its stored id. */
async function joinAs(p: Phone, character: string): Promise<string | null> {
  await p.navigate(joinUrl());
  await p.waitFor((x) => x.view === 'view-pick');
  await p.tap(`.pick-card[data-id="${character}"]`);
  const x = await p.waitFor((y) => y.view === 'view-lobby');
  await p.watch(true);
  return x?.view === 'view-lobby' ? x.id : null;
}

/** Host settings by tapping the sheet's controls (the sheet stays closed: elements exist anyway). */
const setMode = (p: Phone, mode: 'Timed' | 'Marathon') =>
  p.ev(`document.querySelectorAll('#settings-body .seg button').forEach((b) => { if (b.textContent === '${mode}') b.click(); })`);

const ONLY = process.env.ONLY; // e.g. ONLY=3: just the campaign part (quick iteration)

try {
  await boot(true);
  if (!ONLY || ONLY === '1' || ONLY === '2') {

  // ================= part 1: the session is never lost =================
  console.log('\n— part 1: session continuity —');
  const A = await phone('A');
  const B = await phone('B');
  await A.navigate(joinUrl());
  expect((await A.waitFor((x) => x.view === 'view-pick'))?.view === 'view-pick', 'fresh phone (no stored id) gets the picker');
  await A.tap('.pick-card[data-id="elodie"]');
  const a0 = await A.waitFor((x) => x.view === 'view-lobby');
  expect(a0?.view === 'view-lobby', 'A joins as Élodie (host)');
  await A.watch(true);
  const idA = a0?.id ?? null;
  const idB = await joinAs(B, 'sol');
  expect(idB !== null, 'B joins as Sol');

  await A.ev('location.reload()');
  await resumes(A, 'lobby: reload → silent resume', 'view-lobby', idA);

  // game 1: timed 2:00 (default 3:00, two steps down) so it ends on its own
  await setMode(A, 'Timed');
  await sleep(400);
  for (let i = 0; i < 2; i++) { await A.ev(`document.querySelector('#settings-body [aria-label^="Less"]')?.click()`); await sleep(250); }
  await A.tap('#btn-start');
  await resumes(A, 'host starts game 1 (timed 2:00)', 'view-game', idA);
  await resumes(B, 'guest follows into game 1', 'view-game', idB);

  await A.ev('location.reload()');
  await resumes(A, 'game: reload → silent resume', 'view-game', idA);

  await A.tap('#board'); // a gesture arms the back guard
  await A.history(-1);
  const backed = await A.waitFor((x) => !!x.toast, 3000);
  expect(backed?.view === 'view-game' && /still in the game/i.test(backed?.toast ?? ''), 'game: first back stays in the game (toast)', `toast="${backed?.toast}"`);
  await A.history(+1);
  await resumes(A, 'game: … then forward → still in game', 'view-game', idA);

  await A.navigate('about:blank');
  await sleep(800);
  await A.history(-1);
  await resumes(A, 'game: left the page, back → resume', 'view-game', idA);
  await A.history(+1);
  await sleep(800);
  await A.history(-1);
  await resumes(A, 'game: forward then back again → resume', 'view-game', idA);
  const persisted = (await A.snap())?.persisted;
  expect(persisted === 'true', 'bfcache: the page was restored from the back/forward cache', `pageshow.persisted=${persisted}`);

  await A.navigate(joinUrl());
  await resumes(A, 'game: re-scan join URL → silent resume, no picker', 'view-game', idA);

  // ---- the character is the identity ----
  await A.placeOne();
  const boardA = await A.board();
  expect(/c\d/.test(boardA), 'A placed a piece (a board to carry over)', `score ${boardA.split('#')[1]}`);
  await A.ev(`localStorage.clear(); document.cookie.split(';').forEach((c) => { document.cookie = c.split('=')[0].trim() + '=; max-age=0; path=/'; })`);
  await A.watch(false);
  await A.ev('location.reload()');
  const wiped = await A.waitFor((x) => x.view === 'view-pick', 10000);
  const elodieCard = await A.card('elodie');
  const solCard = await A.card('sol');
  expect(wiped?.view === 'view-pick', 'site data wiped mid-game → picker');
  expect(elodieCard.badge === 'Continue' && !elodieCard.disabled, 'picker: own offline character offered as "Continue"', JSON.stringify(elodieCard));
  expect(solCard.disabled && solCard.badge === 'Taken', 'picker: online-held character greyed', JSON.stringify(solCard));
  await A.tap('.pick-card[data-id="elodie"]');
  const back = await A.waitFor((x) => x.view === 'view-game', 5000);
  expect(back?.view === 'view-game' && back.id === idA && (await A.board()) === boardA, 'tap Élodie → same player id, same board and score');
  await A.watch(true);

  await B.placeOne();
  const boardB = await B.board();
  await B.navigate('about:blank'); // B's phone gone: its socket closes on pagehide
  await sleep(1500);
  const C = await phone('C');
  await C.navigate(joinUrl());
  const cPick = await C.waitFor((x) => x.view === 'view-pick', 8000);
  const solForC = await C.card('sol');
  const elodieForC = await C.card('elodie');
  expect(cPick?.view === 'view-pick' && solForC.badge === 'Continue' && !solForC.disabled && elodieForC.disabled,
    'device C: offline Sol offered as "Continue", online Élodie greyed', JSON.stringify({ solForC, elodieForC }));
  await C.tap('.pick-card[data-id="sol"]');
  const cGame = await C.waitFor((x) => x.view === 'view-game', 5000);
  expect(cGame?.view === 'view-game' && cGame.id === idB && (await C.board()) === boardB, 'device C reclaims Sol: same id, same board and score');
  await B.history(-1); // B's phone comes back with its stored id → the newest socket wins
  await resumes(B, 'B comes back with its stored id → back in the game', 'view-game', idB);
  const bumped = await C.waitFor((x) => x.view === 'view-replaced', 5000);
  expect(bumped?.view === 'view-replaced' && bumped.id === null, 'C shows "Continued on another device" and drops the id', `view=${bumped?.view}`);
  await sleep(6000);
  const bStill = await B.snap();
  const cStill = await C.snap();
  expect(bStill?.view === 'view-game' && !bStill.banner && cStill?.view === 'view-replaced', 'no tug of war: 6 s later B still plays, C still replaced');
  await C.ev('location.reload()');
  await C.waitFor((x) => x.view !== 'view-loading', 5000);
  await sleep(1500);
  expect((await B.snap())?.view === 'view-game' && (await C.snap())?.view !== 'view-game', 'C reloads: does not bump B');

  // ---- podium ----
  const pa = await A.waitFor((x) => x.view === 'view-podium', 130_000);
  const pb = await B.waitFor((x) => x.view === 'view-podium', 5000);
  const hostSees = await A.ev(`[!document.getElementById('podium-actions').hidden, !document.getElementById('btn-again').hidden, !document.getElementById('btn-new-game').hidden]`);
  const guestSees = await B.ev(`[!document.getElementById('podium-actions').hidden, !document.getElementById('podium-hint').hidden]`);
  expect(pa?.view === 'view-podium' && hostSees.every(Boolean), 'podium: host has Play again + Back to the room');
  expect(pb?.view === 'view-podium' && guestSees[0] === false && guestSees[1] === true, 'podium: guest has no buttons, a waiting hint');
  await B.ev('location.reload()');
  await resumes(B, 'podium: guest reload → podium again', 'view-podium', idB);
  await B.navigate(joinUrl());
  await resumes(B, 'podium: guest re-scan → podium again', 'view-podium', idB);

  await A.tap('#btn-again');
  const rematch = await B.waitFor((x) => x.view === 'view-game' && !!x.toast, 5000);
  expect(rematch?.view === 'view-game' && /rematch/i.test(rematch.toast ?? ''), 'Play again: guest follows with a "Rematch" toast', `toast="${rematch?.toast}"`);
  await A.waitFor((x) => x.view === 'view-podium', 130_000);
  await B.waitFor((x) => x.view === 'view-podium', 5000);

  await A.tap('#btn-new-game');
  const room1 = await B.waitFor((x) => x.view === 'view-lobby' && !!x.toast, 5000);
  const hostRoom = await A.waitFor((x) => x.view === 'view-lobby', 5000);
  expect(hostRoom?.view === 'view-lobby' && hostRoom.id === idA, 'Back to the room: host in the lobby, same id');
  expect(room1?.view === 'view-lobby' && /back to the room/i.test(room1.toast ?? '') && room1.id === idB, 'Back to the room: guest follows with a toast, same id', `toast="${room1?.toast}"`);
  expect(!(await A.snap())?.sawPick && !(await B.snap())?.sawPick, 'Back to the room: picker never shown');

  // ---- dead links ----
  freeze(true); // idle lobby, Wi-Fi silently gone: only the liveness watchdog can notice
  let t0 = Date.now();
  const idle = await B.waitFor((x) => x.banner, 40_000);
  expect(idle?.banner === true && idle.view === 'view-lobby' && Date.now() - t0 < 30_000, 'idle lobby, silent dead link (SIGSTOP): banner ≤ ~25 s, stays in the lobby', `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  freeze(false);
  await resumes(B, 'idle lobby: SIGCONT → resumes, same player', 'view-lobby', idB, 15_000);
  await resumes(A, 'idle lobby: host resumes too', 'view-lobby', idA, 15_000);

  await setMode(A, 'Marathon');
  await sleep(400);
  await A.tap('#btn-start');
  await resumes(A, 'game 3 started (marathon)', 'view-game', idA);

  freeze(true);
  t0 = Date.now();
  const dead = await A.waitFor((x) => x.banner, 40_000);
  expect(dead?.banner === true && dead.view === 'view-game' && Date.now() - t0 < 30_000, 'mid-game silent dead link (SIGSTOP): banner ≤ ~25 s, still on the game', `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  freeze(false);
  await resumes(A, 'mid-game silent dead link: heals by itself, same game', 'view-game', idA, 15_000);

  console.log(`  (locking A for ${LOCK_MS / 1000} s: frozen page, the server restarts meanwhile so its socket is dead)`);
  await A.lifecycle('frozen');
  const restartAt = Math.min(5000, LOCK_MS / 2);
  await sleep(restartAt);
  await kill9();
  await boot();
  await sleep(Math.max(0, LOCK_MS - restartAt));
  await A.lifecycle('active');
  await resumes(A, `phone locked ${(LOCK_MS / 60_000).toFixed(1)} min mid-game → unlock resumes`, 'view-game', idA, 10_000);

  await kill9();
  const down = await A.waitFor((x) => x.banner, 5000);
  expect(down?.banner === true && down.view === 'view-game', 'server down: banner, never dumped to a menu', `view=${down?.view}`);
  await sleep(2000);
  await boot();
  await resumes(A, 'server back: phone A in the same game', 'view-game', idA, 10_000);
  await resumes(B, 'server back: phone B in the same game', 'view-game', idB, 10_000);

  // the server forgets everybody: the picker, preselecting each phone's own character
  await kill9();
  await boot(true);
  for (const [p, name] of [[A, 'Élodie'], [B, 'Sol']] as const) {
    await p.watch(false);
    await p.navigate(joinUrl()); // the new room code, as from the TV's new QR
    const x = await p.waitFor((y) => y.view === 'view-pick', 10_000);
    const cont = await p.continueButton();
    expect(x?.view === 'view-pick' && cont.shown && cont.text === `Continue as ${name}`, `unknown stored id → picker preselects "Continue as ${name}"`, JSON.stringify(cont));
  }
  await A.tap('#btn-continue');
  expect((await A.waitFor((x) => x.view === 'view-lobby'))?.view === 'view-lobby', '"Continue as Élodie" joins in one tap');

  // ================= part 2: host controls during a game =================
  console.log('\n— part 2: host controls —');
  await kill9();
  await boot(true);
  const H = await phone('H'), G = await phone('G'), R = await phone('R');
  await joinAs(H, 'elodie');
  await joinAs(G, 'sol');
  await joinAs(R, 'anna');
  await setMode(H, 'Marathon');
  await sleep(400);
  await H.tap('#btn-start');
  for (const p of [H, G, R]) await p.waitFor((x) => x.view === 'view-game');
  expect((await R.snap())?.view === 'view-game', '3 players in a marathon game');
  expect((await G.hostButtons()).length === 0, 'guest menu has no host controls');

  await R.navigate('about:blank'); // Anna's phone dies
  await sleep(1500);
  const annaChip = (): Promise<{ text: string, opens: string | null } | null> => H.ev(`(() => { const c = [...document.querySelectorAll('#opponents .opp')].find((e) => e.textContent.includes('Anna')); return c ? { text: c.textContent, opens: c.dataset.open ?? null } : null; })()`);
  let chip = await annaChip();
  expect(!!chip && chip.text.includes('📴') && chip.opens === 'menu', 'host bar: offline Anna flagged 📴, tapping opens the menu', JSON.stringify(chip));
  await H.tap('#opponents .opp.offline');
  let hb = await H.hostButtons();
  expect(!(await H.ev(`document.getElementById('sheet-menu').hidden`)) && /Take Anna out \(offline\)/.test(hb[1]) && /End game/.test(hb[hb.length - 1]),
    'menu: offline Anna listed first, End game last', JSON.stringify(hb));
  await H.tap('[data-retire]');
  hb = await H.hostButtons();
  chip = await annaChip();
  expect(/Tap again: take Anna out/.test(hb.join()) && !chip?.text.includes('👋'), 'first tap only arms, Anna still playing');
  await H.tap('[data-retire]');
  await sleep(500);
  chip = await annaChip();
  expect(!!chip?.text.includes('👋'), 'second tap: Anna taken out (👋)', chip?.text);
  await H.ev(`document.querySelector('#sheet-menu [data-close]').click()`);

  await R.history(-1); // Anna's phone comes back
  const over = await R.waitFor((x) => x.view === 'view-over', 8000);
  const overTitle: string = await R.ev(`document.getElementById('over-title').textContent`);
  expect(over?.view === 'view-over' && /took you out.*score counts/.test(overTitle), 'retired phone: calm "taken out" screen, no board', overTitle);

  await H.tap('#btn-menu');
  await H.tap('#btn-end-game');
  const armed: string = await H.ev(`document.getElementById('btn-end-game').textContent`);
  expect(/Tap again/.test(armed) && (await G.snap())?.view === 'view-game', 'End game: first tap arms, nothing ends yet', armed);
  await H.tap('#btn-end-game');
  const ends = await Promise.all([H, G, R].map((p) => p.waitFor((x) => x.view === 'view-podium', 5000)));
  const kicker: string = await G.ev(`document.getElementById('podium-kicker').hidden ? '' : document.getElementById('podium-kicker').textContent`);
  expect(ends.every((x) => x?.view === 'view-podium') && kicker === 'The host ended the game.', 'End game: all phones (retired one too) on the podium, "The host ended the game."', `kicker="${kicker}"`);
  expect((await H.hostButtons()).length === 0, 'podium: no in-game host controls left');
  const ranks: string[] = await H.ev(`[...document.querySelectorAll('#podium-list li')].map((e) => e.textContent)`);
  expect(ranks.length === 3 && ranks.some((t) => t.includes('Anna')), 'podium ranks all 3, Anna included', JSON.stringify(ranks));

  } // parts 1–2

  if (!ONLY || ONLY === '3') {
  // ================= part 3: the campaign on the phone =================
  console.log('\n— part 3: campaign (hub, game master, doors) —');
  await kill9();
  await boot(true);
  const content = await (await fetch(`${HTTP}/api/content`)).json();
  const title = (id: string): string => content.nodes[id].title;
  const childOf = (parent: string) => Object.values<any>(content.nodes).filter((n) => n.parent === parent);
  // a world below the hub, locked at the start, with a door: the one we unlock and walk into
  const world = childOf('hub').find((n) => n.kind === 'world' && n.door)!;
  const P3 = await phone('P3'), E3 = await phone('E3');
  await joinAs(P3, 'pierre'); // first in: the party host (game master)
  await joinAs(E3, content.chooser); // the chooser walks into doors
  // a screen socket watches the relayed avatar positions (closed-loop steering)
  const tv = new Client('tv'); await tv.open(); tv.send({ t: 'hello', role: 'screen' });
  await tv.waitFor((m) => m.t === 'view');
  const idE3 = (await E3.snap())?.id;
  const lastPos = () => { const m = [...tv.msgs].reverse().find((x) => x.t === 'pos' && x.playerId === idE3); return m ? { x: m.x, y: m.y } : null; };
  const node = () => [...tv.msgs].reverse().find((m) => m.t === 'view')?.campaign?.at.node;

  await E3.tap('#btn-menu');
  expect(!(await E3.visible('btn-gm')), 'only the party host has the Game master entry');
  await E3.ev(`document.querySelector('#sheet-menu [data-close]').click()`);
  await P3.tap('#btn-menu');
  expect(await P3.visible('btn-gm'), 'host menu: 🎲 Game master entry');
  await P3.tap('#btn-gm');
  expect(await P3.visible('gm-back') && /Back to/.test(await P3.text('gm-back')), 'game master: Back is offered from the false start', await P3.text('gm-back'));
  await P3.tap('#gm-back');
  const hubP = await P3.waitFor((x) => x.view === 'view-place', 5000);
  const hubE = await E3.waitFor((x) => x.view === 'view-place', 5000);
  expect(hubP?.view === 'view-place' && hubE?.view === 'view-place' && (await E3.text('place-title')) === title('hub'),
    'Back → both phones show the hub screen (never "Connecting…")', await E3.text('place-title'));
  const list0 = await E3.text('place-children');
  expect(list0.includes(title(content.start)) && /more to discover/.test(list0) && !list0.includes(world.title),
    'hub screen: open places listed, locked ones only counted (no spoilers)', list0);
  expect(await E3.visible('place-hint') && !(await P3.visible('place-hint')), 'chooser sees "Walk into a door to enter"; the host does not');
  expect(await E3.visible('stick-pad') && await P3.visible('stick-pad'), 'joystick available on the hub');
  await E3.shot('phone-hub-chooser');
  await P3.shot('phone-hub-host');

  await P3.tap('#btn-menu');
  await P3.tap('#btn-gm');
  await P3.ev(`(() => { const s = document.getElementById('gm-node'); s.value = ${JSON.stringify(world.id)}; s.dispatchEvent(new Event('input')); })()`);
  const why: string = await P3.text('gm-node-why');
  expect(/locked/.test(why) && /✗/.test(why), 'progress: why the world is locked (condition with ✗)', why);
  await P3.tap('[data-gm="unlock"]');
  const armedUnlock: string = await P3.ev(`document.querySelector('[data-gm="unlock"]').textContent`);
  expect(/Tap again/.test(armedUnlock) && !(await E3.text('place-children')).includes(world.title), 'gm unlock: first tap only arms', armedUnlock);
  await P3.tap('[data-gm="unlock"]');
  let unlockedSeen = false;
  for (let k = 0; k < 30 && !unlockedSeen; k++) { unlockedSeen = (await E3.text('place-children')).includes(world.title); if (!unlockedSeen) await sleep(100); }
  expect(unlockedSeen && (await E3.text('place-children')).includes('✨'), 'gm unlock reflected on the phones (new ✨)', await E3.text('place-children'));
  expect(/flags:|counters:/.test(await P3.text('gm-progress')), 'progress readout shows counters and flags');
  await P3.shot('phone-gm-panel');
  await P3.ev(`document.querySelector('#sheet-gm .sheet-panel').scrollTop = 9999`);
  await P3.shot('phone-gm-panel-bottom');

  await P3.tap(`#gm-enter [data-enter="${world.id}"]`);
  for (let k = 0; k < 30 && node() !== world.id; k++) await sleep(100);
  await sleep(300);
  expect(node() === world.id && (await E3.text('place-title')) === world.title && (await P3.text('place-title')) === world.title,
    'host enters the world from the panel → everyone is there', await E3.text('place-title'));
  await P3.tap('#btn-menu');
  await P3.tap('#btn-gm');
  await P3.tap('#gm-back');
  for (let k = 0; k < 30 && node() !== 'hub'; k++) await sleep(100);
  await P3.ev(`document.querySelector('#sheet-gm [data-close]').click()`);
  expect(node() === 'hub', 'host Back → hub again');

  // Élodie walks into the world's door (relayed pos → steer until inside; the server's edge enters)
  const door = world.door;
  const target = { x: door.x + door.w / 2, y: door.y + door.h / 2 };
  await E3.steer({ x: 8, y: 7.5 }, () => { const p = lastPos(); return !!p && Math.hypot(p.x - 8, p.y - 7.5) < 0.6; }, lastPos, 8000); // open floor first
  await E3.steer(target, () => node() === world.id, lastPos);
  await sleep(400);
  expect(node() === world.id && (await P3.text('place-title')) === world.title && (await E3.text('place-title')) === world.title,
    'the chooser walks into the door → everyone moves into the world', `at ${node()}, last pos ${JSON.stringify(lastPos())}`);
  const toast: string = await P3.ev(`document.getElementById('toast').textContent`);
  expect(toast.includes(world.title), 'the other phones get a "→ <world>" toast', toast);
  tv.ws.close();
  } // part 3

  if (!ONLY || ONLY === '4') {
  // ================= part 4: the quiz on the phone =================
  console.log('\n— part 4: quiz (choices, typed answers, reveal, override, finished) —');
  await kill9();
  await boot(true);
  const bank: { id: string, q: string, choices?: string[], answer: string | number, accept?: string[] }[] =
    JSON.parse(readFileSync(new URL('../data/quiz/placeholder.json', import.meta.url), 'utf8')).questions;
  // the phone sets French typography (narrow no-break space before ? ! : ;): compare whitespace-normalized
  const plain = (t: string) => t.replace(/\s+/gu, ' ').trim();
  const byQ = new Map(bank.map((x) => [plain(x.q), x]));
  const rightText = (x: typeof bank[number]) => (typeof x.answer === 'number' ? x.choices![x.answer] : x.answer);
  const H = await phone('H'), Q = await phone('Q'); // H: the host; Q: Élodie
  await joinAs(H, 'pierre');
  await joinAs(Q, 'elodie');
  const idQ = (await Q.snap())?.id;
  const quizNode = 'childhood.quiz';
  // the game master takes the party to the quiz (Go there: no unlock needed)
  await H.tap('#btn-menu');
  await H.tap('#btn-gm');
  await H.ev(`(() => { const s = document.getElementById('gm-node'); s.value = ${JSON.stringify(quizNode)}; s.dispatchEvent(new Event('input')); })()`);
  await H.tap('[data-gm="goto"]');
  await H.tap('[data-gm="goto"]');
  await H.ev(`document.querySelector('#sheet-gm [data-close]').click()`);
  const inQuiz = async (p: Phone) => { for (let k = 0; k < 40; k++) { if ((await p.snap())?.view === 'view-quiz') return true; await sleep(100); } return false; };
  expect(await inQuiz(H) && await inQuiz(Q), 'Go there → both phones on the quiz screen');
  expect(await Q.visible('quiz-lobby') && /Waiting for the host/.test(await Q.text('quiz-lobby-hint')) && !(await Q.visible('quiz-start')),
    'guest: "Quiz! Waiting for the host…", no Start', await Q.text('quiz-lobby-hint'));
  expect(await H.visible('quiz-start') && await H.visible('btn-settings-quiz'), 'host: Start + ⚙ Settings');
  await H.shot('quiz-lobby-host');

  /** Host settings through the real sheet (data-driven from QUIZ_SETTINGS_SCHEMA). */
  const setQuiz = async (count: number, mode: 'Choices' | 'Typed') => {
    await H.tap('#btn-settings-quiz');
    const labels: string = await H.ev(`[...document.querySelectorAll('#settings-body .setting-label')].map((e) => e.textContent).join('|')`);
    for (let k = 0; k < 30; k++) {
      const now = Number(/\d+/.exec(await H.ev(`document.querySelector('#settings-body .stepper output').textContent`))?.[0]);
      if (now === count) break;
      await H.tap(`#settings-body [aria-label="${now > count ? 'Less' : 'More'} questions"]`);
      await sleep(150);
    }
    await H.ev(`[...document.querySelectorAll('#settings-body .seg button')].find((b) => b.textContent === ${JSON.stringify(mode)})?.click()`);
    await sleep(300);
    await H.ev(`document.querySelector('#sheet-settings [data-close]').click()`);
    return labels;
  };
  const labels = await setQuiz(3, 'Choices');
  expect(labels === 'Questions|Time per question|Answers', 'quiz settings sheet from the quiz schema', labels);
  expect(/^3 questions .* multiple choice$/.test(await Q.text('quiz-summary')), 'guests see the settings summary', await Q.text('quiz-summary'));

  const phaseIs = async (p: Phone, id: string) => { for (let k = 0; k < 60; k++) { if (await p.visible(id)) return true; await sleep(100); } return false; };
  await H.tap('#quiz-start');
  expect(await phaseIs(H, 'quiz-question') && await phaseIs(Q, 'quiz-question'), 'Start → the first question on both phones');
  expect(/\d:\d\d/.test(await Q.text('quiz-clock')), 'countdown shown', await Q.text('quiz-clock'));

  // ---- quiz 1: choices. H taps the right one, Élodie a wrong one; override on the first reveal ----
  for (let round = 0; round < 3; round++) {
    const qText = plain(await H.text('quiz-q'));
    const bq = byQ.get(qText)!;
    const choices: string[] = await H.ev(`[...document.querySelectorAll('#quiz-choices button')].map((b) => b.textContent)`);
    const right = choices.indexOf(rightText(bq));
    if (round === 0) { expect(choices.length === 4 && right >= 0, '4 big choices, in the displayed order', choices.join(' | ')); await Q.shot('quiz-question-choices'); }
    await H.tap(`#quiz-choices [data-choice="${right}"]`);
    if (round === 0) {
      expect(await H.visible('quiz-sent') && await H.ev(`[...document.querySelectorAll('#quiz-choices button')].every((b) => b.disabled)`),
        'after answering: "Answer sent ✓", no change possible');
      let chip = false;
      for (let k = 0; k < 30 && !chip; k++) { chip = /✓ Pierre/.test(await Q.text('quiz-answered')); if (!chip) await sleep(100); }
      expect(chip, 'who answered: the other phone shows ✓ Pierre (never what)', await Q.text('quiz-answered'));
    }
    await Q.tap(`#quiz-choices [data-choice="${(right + 1) % 4}"]`);
    expect(await phaseIs(H, 'quiz-reveal') && await phaseIs(Q, 'quiz-reveal'), `round ${round + 1}: everyone answered → reveal`);
    if (round === 0) {
      const hv = await H.text('quiz-verdict'), qvd = await Q.text('quiz-verdict');
      expect(/^✓ Right! \+1[0-5]\d/.test(hv) && /^✗ Wrong/.test(qvd), 'reveal: right with points for me, wrong for Élodie', `${hv} / ${qvd}`);
      expect((await Q.text('quiz-answer')) === rightText(bq), 'reveal: the correct answer', await Q.text('quiz-answer'));
      expect(!(await Q.visible('quiz-next')) && await H.visible('quiz-next'), 'Next: host only');
      await H.shot('quiz-reveal-host');
      await Q.shot('quiz-reveal-guest');
      await H.tap(`[data-override="${idQ}"]`);
      expect((await H.ev(`document.querySelector('[data-override="${idQ}"]').textContent`)) === 'Tap again', 'override: first tap arms');
      await H.tap(`[data-override="${idQ}"]`);
      let fixed = '';
      for (let k = 0; k < 30; k++) { fixed = await Q.text('quiz-verdict'); if (/Right/.test(fixed)) break; await sleep(100); }
      expect(/^✓ Right!/.test(fixed), 'host override → Élodie\'s phone now says right', fixed);
      const v = await H.vibes(), w = await Q.vibes();
      expect(v.includes('[25]') && v.includes('[30,50,30]') && w.includes('[160]'), 'haptics: send, right, wrong', `${v.join(' ')} / ${w.join(' ')}`);
    }
    await H.tap('#quiz-next');
    if (round < 2) expect(await phaseIs(Q, 'quiz-question'), `Next → question ${round + 2}`);
  }
  expect(await phaseIs(H, 'quiz-finished') && await phaseIs(Q, 'quiz-finished'), 'after the last question: finished on both phones');
  const rank: string = await Q.text('quiz-ranking');
  expect(/🥇 Pierre/.test(rank) && /Élodie/.test(rank), 'mini ranking', rank);
  await H.shot('quiz-finished-host');
  expect(await H.visible('quiz-again') && await H.visible('quiz-back') && !(await Q.visible('quiz-again')), 'host: Play again / Back; guests wait');

  // ---- quiz 2 (Play again): typed answers, really typed ----
  await H.tap('#quiz-again');
  expect(await phaseIs(H, 'quiz-lobby'), 'Play again → the quiz lobby');
  await setQuiz(3, 'Typed');
  await H.tap('#quiz-start');
  expect(await phaseIs(Q, 'quiz-question') && await Q.visible('quiz-text-form') && !(await Q.visible('quiz-choices')), 'typed round: a text field, no choices');
  const attrs = await Q.ev(`(() => { const i = document.getElementById('quiz-text'); return [i.getAttribute('autocorrect'), i.getAttribute('autocapitalize'), i.spellcheck, i.lang].join(','); })()`);
  expect(attrs === 'off,off,false,fr', 'the field never "fixes" names (autocorrect/autocapitalize/spellcheck off, French)', attrs);
  const top0: number = await Q.ev(`document.getElementById('quiz-q').getBoundingClientRect().top`);
  await Q.tap('#quiz-text');
  const top1: number = await Q.ev(`document.getElementById('quiz-q').getBoundingClientRect().top`);
  expect(top0 === top1, 'focusing the field does not move the question', `${top0} → ${top1}`);
  for (let round = 0; round < 3; round++) {
    const bq = byQ.get(plain(await H.text('quiz-q')))!;
    // a name typed in lower case, without accents: the server's French matcher accepts it
    const typed = rightText(bq).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    await H.type('#quiz-text', typed);
    if (round === 0) await H.shot('quiz-question-typed');
    await H.tap('#quiz-send');
    await Q.type('#quiz-text', 'zzz');
    await Q.tap('#quiz-send');
    expect(await phaseIs(H, 'quiz-reveal'), `typed round ${round + 1}: reveal`);
    const hv = await H.text('quiz-verdict');
    expect(/^✓ Right!/.test(hv) && /^✗ Wrong/.test(await Q.text('quiz-verdict')), `"${typed}" judged right on the server; "zzz" wrong`, hv);
    const results: string = await Q.text('quiz-results');
    expect(results.includes(typed) && results.includes('zzz'), 'the reveal lists what everyone typed', results);
    await H.tap('#quiz-next');
  }
  expect(await phaseIs(H, 'quiz-finished'), 'typed quiz finished');
  await H.tap('#quiz-back');
  let back = false;
  for (let k = 0; k < 40 && !back; k++) { back = (await H.snap())?.view === 'view-place'; if (!back) await sleep(100); }
  expect(back && (await H.text('place-title')).length > 0, 'host Back → the world screen', await H.text('place-title'));
  } // part 4
} catch (e) {
  check(false, `crashed: ${(e as Error).stack ?? e}`);
  if (log) console.log(`--- server log ---\n${log}`);
} finally {
  for (const id of contexts) await cmd('Target.disposeBrowserContext', { browserContextId: id }).catch(() => {});
  browser.close();
  if (server) await kill9();
  rmSync(VAR, { recursive: true, force: true });
}
finish();
