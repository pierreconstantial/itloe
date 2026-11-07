// Shared e2e helpers: WebSocket test client, PASS/FAIL tally, legal-move search, play-to-done; and for the
// suites, the runner (e2e-run.mts), the driver (drive.mts) and the unit tests that start a real server: free
// ports, a server and headless Chrome started and stopped, a CDP connection.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { canPlace } from '../shared/board.js';
import { PIECES } from '../shared/pieces.js';
import { gameMasterId } from '../shared/campaign/index.js';

export const URL_WS = `ws://localhost:${process.env.PORT ?? 3141}/ws`;
/** Timeout multiplier for a loaded machine: E2E_SLOW=3 triples every wait (default 1). */
export const SLOW = Math.max(1, Number(process.env.E2E_SLOW ?? 1) || 1);
export const HTTP = URL_WS.replace(/^ws/, 'http').replace(/\/ws$/, '');
let failures = 0;
export function check(cond: boolean, label: string): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
}
/** Every page a suite opened (openPage), with the uncaught exceptions it threw. */
const opened: { label: string, errors: string[] }[] = [];
/** Prints the verdict and exits 1 on any failure; a browser suite fails on any page's uncaught exception. */
export function finish(): never {
  if (opened.length) {
    const errors = opened.flatMap((p) => p.errors.map((e) => `${p.label}: ${e}`));
    check(errors.length === 0, `no page threw${errors.length ? ` (${errors.length}): ${errors.map((e) => e.split('\n')[0]).join(' | ')}` : ''}`);
    for (const e of errors) console.log(`      ${e}`); // with its stack
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The suites' one wait: polls `get` until it gives a truthy value and returns it; after `ms` (× E2E_SLOW) it
 *  throws, with `why()` saying what it waited for and what it saw. */
export async function waitUntil<T>(get: () => T | Promise<T>, ms: number, why: () => string | Promise<string>, every = 50): Promise<T> {
  const end = Date.now() + ms * SLOW;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) throw new Error(await why());
    await sleep(every);
  }
}
/** The part ONLY names (one of a suite's `parts`), or undefined for a full run. An unknown part exits 2 with
 *  the list: a suite would otherwise run nothing of it, and pass. */
export function onlyPart(parts: string[]): string | undefined {
  const only = process.env.ONLY;
  if (only === undefined || only === '' || parts.includes(only)) return only || undefined;
  console.log(`ONLY=${only}: no such part; the parts: ${parts.join(' ')}`);
  process.exit(2);
}

/**
 * Test-only, injected into a page before its scripts, like TEARDOWN_PROBE: keeps the page's latest socket and what it sends (`window.__sent`, parsed), so a test can see what the page
 * told the server and hand the page a message as if the server sent it (`window.__receive(msg)`).
 */
export const SOCKET_PROBE = `(() => {
  const W = window.WebSocket;
  window.__sent = [];
  window.WebSocket = class extends W {
    constructor(...a) { super(...a); window.__ws = this; }
    send(data) { try { window.__sent.push(JSON.parse(data)); } catch {} return super.send(data); }
  };
  window.__receive = (m) => window.__ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(m) }));
})()`;

/**
 * Test-only, injected into a page before its scripts (Page.addScriptToEvaluateOnNewDocument): records every
 * timer, interval and animation frame still pending, and every listener on window or document still
 * attached, each with the page's modules on the stack that made it. window.__live(files) lists the ones a
 * module in `files` (file names, e.g. 'blocks-ui.js') made: what a minigame's screens left running.
 */
export const TEARDOWN_PROBE = `(() => {
  const live = new Map();
  Error.stackTraceLimit = 40;
  const files = () => (new Error().stack || '').split('\\n').slice(2)
    .map((l) => (/\\/([\\w-]+\\.js):\\d+:\\d+/.exec(l) || [])[1]).filter(Boolean);
  const track = (kind, id) => { live.set(kind + ':' + id, { kind, files: files() }); return id; };
  const W = window, st = W.setTimeout, ct = W.clearTimeout, si = W.setInterval, ci = W.clearInterval;
  const raf = W.requestAnimationFrame, caf = W.cancelAnimationFrame;
  W.setTimeout = function (fn, ms, ...a) {
    const id = st.call(W, (...b) => { live.delete('timeout:' + id); if (typeof fn === 'function') fn(...b); }, ms, ...a);
    return track('timeout', id);
  };
  W.clearTimeout = (id) => { live.delete('timeout:' + id); ct.call(W, id); };
  W.setInterval = function (fn, ms, ...a) { return track('interval', si.call(W, fn, ms, ...a)); };
  W.clearInterval = (id) => { live.delete('interval:' + id); ci.call(W, id); };
  W.requestAnimationFrame = (fn) => { const id = raf.call(W, (t) => { live.delete('frame:' + id); fn(t); }); return track('frame', id); };
  W.cancelAnimationFrame = (id) => { live.delete('frame:' + id); caf.call(W, id); };
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const listeners = [];
  const capture = (o) => (typeof o === 'boolean' ? o : !!(o && o.capture));
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if ((this === W || this === document) && !(opts && opts.once)) listeners.push({ target: this, type, fn, capture: capture(opts), files: files() });
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const i = listeners.findIndex((l) => l.target === this && l.type === type && l.fn === fn && l.capture === capture(opts));
    if (i >= 0) listeners.splice(i, 1);
    return remove.call(this, type, fn, opts);
  };
  W.__live = (names) => [
    ...[...live.values()].filter((v) => v.files.some((f) => names.includes(f))).map((v) => v.kind + ' from ' + v.files.join(' < ')),
    ...listeners.filter((l) => l.files.some((f) => names.includes(f))).map((l) => 'listener ' + l.type + ' from ' + l.files.join(' < ')),
  ];
})();`;
/** A view's block round (running, or finished on its podium), else null. */
export const blocksOf = (v: any): any => (v?.minigame?.kind === 'blocks' ? v.minigame.view.round ?? null : null);
/** A view's quiz round (running, or finished on its podium: the public projection), else null. */
export const quizOf = (v: any): any => (v?.minigame?.kind === 'quiz' ? v.minigame.view.round ?? null : null);
/** A view's Pyramide round (running, or finished on its podium: the round without the words still drawable), else null. */
export const pyramideOf = (v: any): any => (v?.minigame?.kind === 'pyramide' ? v.minigame.view.round ?? null : null);
/** A view's backgammon round (the group phase, without its seed and rolls), else null. */
export const backgammonOf = (v: any): any => (v?.minigame?.kind === 'backgammon' ? v.minigame.view.round ?? null : null);
/** A view's minigame in its lobby (the plain lobby's view: stage, settings, players, ready, round), else null. */
export const lobbyOf = (v: any): any => (v?.minigame?.status === 'lobby' ? v.minigame.view : null);
/** Who is in the room at a tableau while no minigame runs (the party members who haven't left), in a round's
 *  { order, players } shape; null while a minigame runs or away from a minigame's tableau. */
export const roomOf = (v: any): any => {
  if (!v?.campaign?.at.kind || v.minigame) return null;
  const party = v.campaign.party;
  const order = party.order.filter((id: string) => !party.players[id].left);
  return { order, players: Object.fromEntries(order.map((id: string) => [id, party.players[id]])) };
};
/** A view's minigame settings (the running minigame keeps them), else null. */
export const settingsOf = (v: any): any => v?.minigame?.view.settings ?? null;
/** A view's game master: whoever holds Pierre, the game master of every content (shared/campaign gameMasterId). */
export const gmOf = (v: any): string | null => (v?.campaign ? gameMasterId(v.campaign.party, { gameMaster: 'pierre' } as any) : null);

export class Client {
  ws!: WebSocket;
  msgs: any[] = [];
  /** every frame as received, unparsed (the quiz's leak grep) */
  frames: string[] = [];
  /** liveness ticks, kept apart so "no broadcast" checks never trip on one */
  ticks: any[] = [];
  closed = false;
  label: string;
  url: string;
  /** The player id of the last welcome, if any. */
  id: string | null = null;
  /** @param url the server's socket (default: the suite's PORT) */
  constructor(label: string, url = URL_WS) { this.label = label; this.url = url; }
  open(): Promise<void> {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e) => {
      this.frames.push(String(e.data));
      const m = JSON.parse(String(e.data));
      if (m.t === 'welcome') this.id = m.playerId;
      (m.t === 'tick' ? this.ticks : this.msgs).push(m);
    };
    this.ws.onclose = () => { this.closed = true; };
    return new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = rej; });
  }
  send(m: unknown): void { this.ws.send(JSON.stringify(m)); }
  mark(): number { return this.msgs.length; }
  since(i: number): any[] { return this.msgs.slice(i); }
  /** The last view message, or undefined. */
  last(): any { return [...this.msgs].reverse().find((m) => m.t === 'view'); }
  /** The block round in the last view, or null. */
  lastView(): any { return blocksOf(this.last()); }
  /** The running minigame in the last view (kind, status, view, shows, required), or null. */
  lastMinigame(): any { return this.last()?.minigame ?? null; }
  /** The minigame's lobby in the last view, or null. */
  lastLobby(): any { return lobbyOf(this.last()); }
  /** Who is in the room in the last view (between rounds), or null. */
  lastRoom(): any { return roomOf([...this.msgs].reverse().find((m) => m.t === 'view')); }
  /** The tableau's settings in the last view, or null. */
  lastSettings(): any { return settingsOf([...this.msgs].reverse().find((m) => m.t === 'view')); }
  /** The game master in the last view. */
  lastGm(): string | null { return gmOf([...this.msgs].reverse().find((m) => m.t === 'view')); }
  waitFor(pred: (m: any) => boolean, from = 0, ms = 2000): Promise<any> {
    return waitUntil(() => this.msgs.slice(from).find(pred), ms,
      () => `${this.label}: timeout waiting (from ${from}); got ${JSON.stringify(this.since(from).map((m) => m.t))}`, 10);
  }
}

/** A phone opening the join URL: hello with the room code, no stored id; resolves once it has a view. */
export async function device(label: string, room: string, url = URL_WS): Promise<Client> {
  const c = new Client(label, url); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'player', room });
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}
/** Taps a character on phone `c`: the welcome's player id, or the err code. */
export async function tap(c: Client, character: string): Promise<{ id?: string, err?: string }> {
  const i = c.mark();
  c.send({ t: 'join', character });
  const r = await c.waitFor((m) => m.t === 'welcome' || m.t === 'err', i);
  return r.t === 'welcome' ? { id: r.playerId } : { err: r.code };
}
/** A new phone joined as `character` (an err throws). */
export async function player(label: string, character: string, room: string, url = URL_WS): Promise<{ c: Client, id: string }> {
  const c = await device(label, room, url);
  const r = await tap(c, character);
  if (!r.id) throw new Error(`${label}: join as ${character} → err ${r.err}`);
  return { c, id: r.id };
}
/** A phone with a stored id (and the room code, when given): hello → welcome + view. */
export async function rejoin(label: string, playerId: string, room?: string, url = URL_WS): Promise<Client> {
  const c = new Client(label, url); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'player', playerId, ...(room ? { room } : {}) });
  await c.waitFor((m) => m.t === 'welcome' && m.playerId === playerId, i);
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}
/** A TV's socket: hello as a screen; resolves once it has a view. */
export async function screen(label: string, url = URL_WS): Promise<Client> {
  const c = new Client(label, url); await c.open();
  const i = c.mark();
  c.send({ t: 'hello', role: 'screen' });
  await c.waitFor((m) => m.t === 'view', i);
  return c;
}
/** The err code `msg` is answered with, or null for none (no fixed wait: a round trip follows it). */
export async function errOf(c: Client, msg: object): Promise<string | null> {
  const i = c.mark();
  c.send(msg);
  const probe = await roundTrip(c);
  return c.since(i).slice(0, c.since(i).indexOf(probe)).find((m) => m.t === 'err')?.code ?? null;
}
/** The room code the server hands out now. */
export const roomCode = async (http = HTTP): Promise<string> => (await (await fetch(`${http}/api/join`)).json()).code;

/** The game master `gm` starts the tableau's minigame (unless one runs), each of `ready` who isn't ready yet
 *  taps "I'm ready", and `gm` starts a round; resolves with gm's first view of the running round. */
export async function startRound(gm: Client, ready: Client[]): Promise<any> {
  let i = gm.mark();
  if (!gm.lastMinigame()) {
    gm.send({ t: 'startMinigame' });
    await gm.waitFor((m) => m.t === 'view' && m.minigame?.status === 'lobby', i);
  }
  const already: string[] = gm.lastLobby()?.ready ?? [];
  const tapping = ready.filter((c) => !c.id || !already.includes(c.id));
  for (const c of tapping) c.send({ t: 'ready', on: true });
  await settled(tapping, [gm]);
  i = gm.mark();
  gm.send({ t: 'start' });
  return gm.waitFor((m) => (m.t === 'view' && m.minigame?.status === 'running') || m.t === 'err', i)
    .then((m) => { if (m.t === 'err') throw new Error(`${gm.label}: start refused (${m.code})`); return m; });
}
/** The game master `gm`, on the podium, takes everyone back to the lobby; resolves with gm's view of it. */
export async function backToLobby(gm: Client): Promise<any> {
  const i = gm.mark();
  gm.send({ t: 'lobby' });
  return gm.waitFor((m) => m.t === 'view' && m.minigame?.status === 'lobby', i);
}
/** The game master `gm`, in the lobby, ends the minigame; resolves with gm's view of the room. */
export async function endMinigame(gm: Client): Promise<any> {
  const i = gm.mark();
  gm.send({ t: 'endMinigame' });
  return gm.waitFor((m) => m.t === 'view' && m.minigame === null, i);
}

/** The codes a join of no character is answered with: nothing else sends them to a joined phone or a TV. */
const PROBE_ERRS = ['bad-room', 'taken', 'full'];
/** A round trip on one socket: a join of no character changes nothing and is answered with an err, after
 *  everything the server sent this socket before; resolves with that err. */
export async function roundTrip(c: Client): Promise<any> {
  const i = c.mark();
  c.send({ t: 'join', character: '' });
  return c.waitFor((m) => m.t === 'err' && PROBE_ERRS.includes(m.code), i, 5000);
}
/** Everything the senders sent has been handled, and the receivers have got whatever it caused: what a
 *  check reads then is final, with no fixed wait (a round trip per sender, then per receiver). */
export async function settled(senders: Client[], receivers: Client[]): Promise<void> {
  await Promise.all(senders.map(roundTrip));
  await Promise.all(receivers.filter((c) => !senders.includes(c)).map(roundTrip));
}

export function legalMoves(state: any, id: string): { piece: number; x: number; y: number }[] {
  const p = state.players[id];
  const out: { piece: number; x: number; y: number }[] = [];
  p.hand.forEach((pid: string | null, piece: number) => {
    if (pid === null) return;
    for (let y = 0; y < state.size; y++)
      for (let x = 0; x < state.size; x++)
        if (canPlace(p.board, state.size, PIECES[pid].cells, x, y)) out.push({ piece, x, y });
  });
  return out;
}
export function illegalMove(state: any, id: string): { piece: number; x: number; y: number } {
  const p = state.players[id];
  const piece = p.hand.findIndex((h: string | null) => h !== null);
  return { piece, x: state.size, y: state.size }; // out of bounds origin
}

/** Plays `c` (player `id`) until done, random legal moves; every move must be broadcast to `other`. */
export async function playToDone(c: Client, id: string, other: Client, rnd: () => number): Promise<number> {
  let n = 0;
  while (!c.lastView().players[id].done && c.lastView().phase === 'playing') {
    const moves = legalMoves(c.lastView(), id);
    const mv = moves[Math.floor(rnd() * moves.length)];
    const a = c.mark(), b = other.mark();
    c.send({ t: 'place', ...mv });
    await c.waitFor((m) => m.t === 'view' || m.t === 'err', a);
    await other.waitFor((m) => m.t === 'view', b);
    if (c.since(a).some((m) => m.t === 'err')) throw new Error(`legal move refused: ${JSON.stringify(mv)}`);
    if (++n > 2000) throw new Error('never got stuck');
  }
  return n;
}

// ---------- processes: ports, a server, Chrome, process groups ----------
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const MAIN = new URL('../server/main.ts', import.meta.url).pathname;

/** A free TCP port on loopback (never 3131: the OS hands out ephemeral ports). */
export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer().once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); });
  });
}

/** Resolves once `url` answers; kills `proc` and throws if it exits first or after 30 s. */
async function waitHttp(url: string, what: string, proc: ChildProcess): Promise<void> {
  for (let k = 0; k < 600; k++) {
    if (proc.exitCode !== null) throw new Error(`${what} exited (${proc.exitCode}) before answering`);
    if (await fetch(url).then(() => true, () => false)) return;
    await sleep(50);
  }
  proc.kill('SIGKILL');
  throw new Error(`${what} did not answer on ${url} within 30 s`);
}

export type Server = { proc: ChildProcess, log: () => string };
/** The real server on `port`: `content` (ITLOE_CONTENT; '' the story) saved in `dataDir`, a fresh evening unless
 *  `fresh` is false (then the saved one). In its own process group when `detached`; output to the caller's,
 *  unless `stdio: 'pipe'`: then kept, as `log()`. Resolves once it answers; throws, with the exit code and
 *  the output kept, if it exits first. */
export async function startServer(port: string | number, dataDir: string, content: string,
  opts: { fresh?: boolean, detached?: boolean, stdio?: 'inherit' | 'pipe', env?: NodeJS.ProcessEnv } = {}): Promise<Server> {
  if (String(port) === '3131') throw new Error('3131 is the live server: pick another PORT');
  // a server left over from an aborted run would answer instead of this one
  if (await fetch(`http://127.0.0.1:${port}/api/join`).then(() => true, () => false)) throw new Error(`port ${port} is busy: fuser -k ${port}/tcp`);
  const proc = spawn(process.execPath, [MAIN, ...(opts.fresh === false ? [] : ['--new'])], {
    env: { ...(opts.env ?? process.env), PORT: String(port), BLOKO_VAR: dataDir, BLOKO_HOST: '127.0.0.1', ITLOE_CONTENT: content },
    stdio: ['ignore', opts.stdio ?? 'inherit', opts.stdio ?? 'inherit'], detached: opts.detached,
  });
  let log = '';
  proc.stdout?.on('data', (d) => { log += d; });
  proc.stderr?.on('data', (d) => { log += d; });
  const exited = new Promise((r) => proc.once('close', r)); // its output read to the end
  try {
    await waitHttp(`http://127.0.0.1:${port}/api/join`, 'the server', proc);
  } catch (e) {
    await exited;
    throw new Error(`${(e as Error).message}${log ? `\n${log}` : ''}`);
  }
  return { proc, log: () => log };
}

/** Sends `signal` to a process (a SIGKILL: kill -9, no last save) and resolves once it has exited. */
export function stop(proc: ChildProcess | null, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  const gone = new Promise<void>((r) => proc.once('exit', () => r()));
  proc.kill('SIGCONT'); // a frozen (SIGSTOP) server never handles a SIGTERM
  proc.kill(signal);
  return gone;
}

/** Headless Chrome on a scratch profile, in its own process group when `detached`; resolves once CDP answers. */
export async function startChrome(profile: string, detached = false): Promise<{ proc: ChildProcess, cdp: string }> {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', detached });
  // with port 0 Chrome picks a free port itself and writes it to DevToolsActivePort
  const portFile = join(profile, 'DevToolsActivePort');
  for (let k = 0; k < 300 && !existsSync(portFile) && proc.exitCode === null; k++) await sleep(100);
  if (!existsSync(portFile)) { proc.kill('SIGKILL'); throw new Error(`Chrome did not start (${CHROME})`); }
  const cdp = readFileSync(portFile, 'utf8').split('\n')[0];
  await waitHttp(`http://127.0.0.1:${cdp}/json/version`, 'Chrome', proc);
  return { proc, cdp };
}

/** Sends `sig` to a whole process group; false once it's empty. */
export function signalGroup(pgid: number, sig: NodeJS.Signals | 0): boolean {
  try { process.kill(-pgid, sig); return true; } catch { return false; }
}

/** Stops process groups: SIGTERM, then SIGKILL for what's left after 3 s. Resolves once all are gone, so
 *  nothing (Chrome shutting down, a server saving) still writes to a scratch folder about to be removed. */
export async function killGroups(pgids: number[]): Promise<void> {
  for (const g of pgids) signalGroup(g, 'SIGTERM');
  for (let k = 0; k < 30 && pgids.some((g) => signalGroup(g, 0)); k++) await sleep(100);
  for (const g of pgids) signalGroup(g, 'SIGKILL');
  for (let k = 0; k < 50 && pgids.some((g) => signalGroup(g, 0)); k++) await sleep(100);
}

/** One connection to the Chrome on port `cdp`: cmd() sends a command (to a page's flattened session when
 *  `sessionId` is given), `events` gets every event. */
export async function cdpConnect(cdp: string) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${cdp}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const waiting = new Map<number, (m: any) => void>();
  const events: ((m: any) => void)[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); return; }
    for (const f of events) f(m);
  };
  const cmd = (method: string, params: object = {}, sessionId?: string): Promise<any> => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => waiting.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))));
  };
  return { cmd, events, close: () => ws.close() };
}

// ---------- pages: a TV or a phone in Chrome, driven like a person (used by drive.mts and the suites) ----------
/** In the page: the visible element a target names, scrolled into view, and its centre. A CSS selector,
 *  else visible text (or a field's placeholder or label): an exact match first, then a containing one, the
 *  smallest element that matches. */
const FIND = `(target) => {
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; };
  let hit = null;
  try { hit = [...document.querySelectorAll(target)].find(shown) ?? null; } catch { /* not a selector */ }
  if (!hit) {
    const norm = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const want = norm(target);
    const words = (e) => [e.innerText, e.placeholder, e.getAttribute('aria-label'), e.value].map(norm);
    const all = [...document.body.querySelectorAll('*')].filter(shown);
    const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    const pick = (ok) => all.filter((e) => words(e).some(ok)).sort((x, y) => area(x) - area(y))[0] ?? null;
    hit = pick((w) => w === want) ?? pick((w) => w.includes(want));
  }
  if (!hit) return null;
  hit.scrollIntoView({ block: 'center', inline: 'center' });
  const r = hit.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}`;

export type Page = Awaited<ReturnType<typeof openPage>>;

/** A TV or a phone, each its own device (a browser context). `shots`: the folder screenshots go to, or
 *  undefined to take none. `probes`: test-only scripts the page runs before its own (e.g. SOCKET_PROBE). Its
 *  uncaught exceptions fail the suite at finish(). */
export async function openPage(cdp: Awaited<ReturnType<typeof cdpConnect>>, label: string, phone: boolean, shots: () => string | undefined, probes: string[] = []) {
  const { cmd, events } = cdp;
  const { browserContextId } = await cmd('Target.createBrowserContext');
  const { targetId } = await cmd('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId: s } = await cmd('Target.attachToTarget', { targetId, flatten: true });
  await cmd('Page.enable', {}, s);
  await cmd('Runtime.enable', {}, s);
  await cmd('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, s);
  if (phone) await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true }, s); // pages in the background stay "focused"
  for (const source of probes) await cmd('Page.addScriptToEvaluateOnNewDocument', { source }, s);
  /** The page's uncaught exceptions, as they happened. */
  const errors: string[] = [];
  opened.push({ label, errors });
  events.push((m) => {
    if (m.sessionId === s && m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });
  /** A CDP command to this page, for what the helpers below don't do (reload, lifecycle, history, keys). */
  const command = (method: string, params: object = {}): Promise<any> => cmd(method, params, s);

  /** Evaluates an expression in the page (promises awaited) and returns its value. */
  const ev = async (expr: string): Promise<any> => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, s);
    if (r.exceptionDetails) throw new Error(`${label}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  /** The visible text of the page. */
  const text = (): Promise<string> => ev('document.body?.innerText ?? ""');
  /** Waits until the expression is truthy and returns its value; throws with the page's text after `ms`, and
   *  with the value of `show` when given (e.g. what is still left). */
  const waitFor = (expr: string, ms = 8000, show?: string): Promise<any> => waitUntil(() => ev(expr).catch(() => null), ms, async () =>
    `${label}: timed out waiting for ${expr}${show ? `\n--- ${show}: ${JSON.stringify(await ev(show).catch((e) => String(e)))}` : ''}\n--- ${label}'s text ---\n${await text().catch(() => '')}`, 100);
  /** Waits until the visible text contains `want`. */
  const waitText = async (want: string | RegExp, ms = 8000): Promise<void> => {
    let now = '';
    await waitUntil(async () => { now = await text().catch(() => ''); return typeof want === 'string' ? now.includes(want) : want.test(now); }, ms,
      () => `${label}: timed out waiting for the text ${want}\n--- ${label}'s text ---\n${now}`, 100);
  };
  const find = (target: string, ms: number): Promise<{ x: number, y: number }> => waitUntil(() => ev(`(${FIND})(${JSON.stringify(target)})`), ms,
    async () => `${label}: nothing visible matches ${JSON.stringify(target)}\n--- ${label}'s text ---\n${await text().catch(() => '')}`, 100);
  /** A real tap on a phone, a real click on the TV, on what `target` names (see FIND); waits for it to show. */
  const tap = async (target: string, ms = 8000): Promise<void> => {
    await cmd('Page.bringToFront', {}, s); // headless: a background page never acks synthetic input
    const { x, y } = await find(target, ms);
    const touched = (async () => {
      if (phone) {
        await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }, s);
        await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s);
      } else {
        for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, s);
      }
      return true;
    })();
    // a page that went through Page.setWebLifecycleState can stop acking synthetic input in headless Chrome:
    // a DOM click on the element at that point instead (no user activation, fine for buttons) rather than hang
    if (!(await Promise.race([touched, sleep(3000).then(() => false)]))) {
      console.log(`  [${label}] synthetic input not acked (headless lifecycle quirk): clicking ${target} instead`);
      await ev(`document.elementFromPoint(${x}, ${y})?.click()`);
    }
    await sleep(150);
  };
  /** Taps the field `target` names, then types `words` into it. */
  const type = async (target: string, words: string): Promise<void> => {
    await tap(target);
    await cmd('Input.insertText', { text: words }, s);
  };
  /** Saves <shots>/<name>.png and the visible text as <name>.txt; returns the PNG's path (none without a folder). */
  const shot = async (name: string): Promise<string | undefined> => {
    const dir = shots();
    if (!dir) return undefined;
    mkdirSync(dir, { recursive: true });
    await cmd('Page.bringToFront', {}, s);
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' }, s);
    const file = join(dir, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    writeFileSync(join(dir, `${name}.txt`), await text());
    return file;
  };
  /** The screen as a JPEG (base64), scaled: a phone's 2× pixels at 0.5 come out at its CSS size. */
  const capture = async (scale = 0.5, quality = 80): Promise<string> => {
    await cmd('Page.bringToFront', {}, s);
    const size = await ev('({ w: innerWidth, h: innerHeight })');
    const { data } = await cmd('Page.captureScreenshot', { format: 'jpeg', quality, clip: { x: 0, y: 0, width: size.w, height: size.h, scale } }, s);
    return data;
  };
  /**
   * Holds a phone's joystick and steers, closed loop, towards `target` (world units) until `done()`;
   * `where()` is the avatar's position as the TV shows it. Gives up after `ms`.
   */
  const steer = async (target: { x: number, y: number }, done: () => Promise<boolean>,
    where: () => Promise<{ x: number, y: number } | null>, ms = 15_000): Promise<void> => {
    await cmd('Page.bringToFront', {}, s);
    const pad = await ev(`(() => { const r = document.getElementById('stick-pad').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pad] }, s);
    const end = Date.now() + ms * SLOW;
    while (Date.now() < end && !(await done())) {
      const at = (await where()) ?? { x: 8, y: 4.5 };
      const dx = target.x - at.x, dy = target.y - at.y;
      const len = Math.hypot(dx, dy) || 1;
      const push = Math.min(56, 20 + len * 12); // slow down near the target
      await cmd('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pad.x + (dx / len) * push, y: pad.y + (dy / len) * push }] }, s);
      await sleep(80);
    }
    await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s);
  };
  const goto = async (url: string): Promise<void> => { await cmd('Page.navigate', { url }, s); await waitFor('document.readyState === "complete"'); };
  /** The innermost screen showing (the frame's view, or a minigame's screen inside it), e.g. 'view-lobby'. */
  const view = (): Promise<string | null> => ev(`[...document.querySelectorAll('main section[id^="view-"]')].filter((e) => !e.closest('[hidden]')).pop()?.id ?? null`);
  /** Closes the page and its browser context (the device), for a suite on a Chrome that outlives it. */
  const close = async (): Promise<void> => { await cmd('Target.disposeBrowserContext', { browserContextId }).catch(() => undefined); };
  return { label, errors, command, ev, text, waitFor, waitText, tap, type, shot, capture, steer, goto, view, close };
}
