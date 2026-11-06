// Shared e2e helpers: WebSocket test client, PASS/FAIL tally, legal-move search, play-to-done; and for the
// runner (e2e-run.mts) and the driver (drive.mts): free ports, a server and headless Chrome started and
// stopped, a CDP connection.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
/** Prints the verdict and exits 1 on any failure. */
export function finish(): never {
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
  /** liveness ticks, kept apart so "no broadcast" checks never trip on one */
  ticks: any[] = [];
  closed = false;
  label: string;
  /** The player id of the last welcome, if any. */
  id: string | null = null;
  constructor(label: string) { this.label = label; }
  open(): Promise<void> {
    this.ws = new WebSocket(URL_WS);
    this.ws.onmessage = (e) => {
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
  async waitFor(pred: (m: any) => boolean, from = 0, ms = 2000): Promise<any> {
    const end = Date.now() + ms * SLOW;
    while (Date.now() < end) {
      const hit = this.msgs.slice(from).find(pred);
      if (hit) return hit;
      await sleep(10);
    }
    throw new Error(`${this.label}: timeout waiting (from ${from}); got ${JSON.stringify(this.since(from).map((m) => m.t))}`);
  }
}

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

/** A round trip on one socket: an `enter` of no node changes nothing and is answered with an err, after
 *  everything the server sent this socket before. */
export async function roundTrip(c: Client): Promise<void> {
  const i = c.mark();
  c.send({ t: 'enter', node: '' });
  await c.waitFor((m) => m.t === 'err', i, 5000);
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
const CHROME = '/usr/bin/google-chrome';
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
  for (let k = 0; k < 300; k++) {
    if (proc.exitCode !== null) throw new Error(`${what} exited (${proc.exitCode}) before answering`);
    if (await fetch(url).then(() => true, () => false)) return;
    await sleep(100);
  }
  proc.kill('SIGKILL');
  throw new Error(`${what} did not answer on ${url} within 30 s`);
}

/** The real server on `port`: a fresh evening of `content` (ITLOE_CONTENT), saved in `dataDir`. In its own
 *  process group when `detached`; output to the caller's unless `stdio: 'pipe'`. Resolves once it answers. */
export async function startServer(port: string | number, dataDir: string, content: string,
  opts: { detached?: boolean, stdio?: 'inherit' | 'pipe', env?: NodeJS.ProcessEnv } = {}): Promise<ChildProcess> {
  const proc = spawn(process.execPath, [MAIN, '--new'], {
    env: { ...(opts.env ?? process.env), PORT: String(port), BLOKO_VAR: dataDir, BLOKO_HOST: '127.0.0.1', ITLOE_CONTENT: content },
    stdio: ['ignore', opts.stdio ?? 'inherit', opts.stdio ?? 'inherit'], detached: opts.detached,
  });
  await waitHttp(`http://127.0.0.1:${port}/api/join`, 'the server', proc);
  return proc;
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
