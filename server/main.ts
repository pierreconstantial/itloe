// Bloko server: HTTP static + WebSocket on one port, PROTOCOL.md over the shared pure reducer.
// Every state change goes through apply() → solo best, save to disk, remember settings, arm the timed-mode clock, broadcast.
// Run: npm start          (resumes the saved game in any phase; a timed clock keeps its remaining time)
//      npm start -- --new (or BLOKO_NEW=1: always a fresh game)
// Env: PORT (3131), BLOKO_HOST (LAN interface or address), BLOKO_VAR (data dir, default var/)

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import qrcodeTerminal from 'qrcode-terminal';
import { WebSocketServer, WebSocket } from 'ws';
import { makeStaticHandler } from './static.ts';
import { makeApiHandler } from './http-api.ts';
import { pickLan } from './lan.ts';
import { makeClock } from './clock.ts';
import { shiftDeadline } from './resume.ts';
import { makeBests } from './bests.ts';
import { freeCharacters, isCharacterId } from '../shared/characters.js';
import { canMove, makePositions, parsePos, posMsg, type Pos } from './pos.ts';
import { loadGame, saveGame, saveSettings, STATE_FILE, type Game } from './store.ts';
import { reduce, type ServerAction, type Settings, type State } from './rules.ts';

type ErrCode = 'full' | 'bad-place' | 'not-host' | 'not-playing' | 'unknown-player' | 'locked' | 'bad-room' | 'taken';

const PORT = Number(process.env.PORT ?? 3131);
const ROOT = new URL('..', import.meta.url).pathname;
const FORCE_NEW = process.argv.includes('--new') || process.env.BLOKO_NEW === '1';

// ---------- game state + change hooks (wrap reduce, never inside it) ----------

const loaded = loadGame(FORCE_NEW);
const game: Game = { state: loaded.state, room: loaded.room, bestPrevious: loaded.bestPrevious ?? null };

const bests = makeBests(game);

// beat() first: after a suspend, the overdue bell may run before the heartbeat; the beat shifts the
// deadline, so this timeUp no longer matches it and the reducer ignores it (the new one is armed).
const clock = makeClock((deadline) => { beat(); apply({ t: 'timeUp', deadline }); });

/** Avatar positions: in memory only, outside the reducer (see pos.ts). */
const positions = makePositions<WebSocket>();

const onChange: ((prev: State, next: State) => void)[] = [
  (prev, next) => bests.onChange(prev, next), // before saveGame: it sets game.bestPrevious
  () => saveGame(game),
  (prev, next) => { if (next.settings && next.settings !== prev?.settings) saveSettings(next.settings); },
  (prev, next) => clock.onChange(prev, next),
  (_prev, next) => positions.prune(next),
  () => broadcast(),
];

/** Runs an action through the reducer; returns false when it was refused (state unchanged). */
function apply(action: ServerAction): boolean {
  return commit(reduce(game.state, action));
}

/** Installs a new state and runs every change hook; false when nothing changed. */
function commit(next: State): boolean {
  const prev = game.state;
  if (next === prev) return false;
  game.state = next;
  for (const hook of onChange) hook(prev, next);
  return true;
}

// ---------- timed-pause heartbeat ----------
// While a timed game runs, re-save every second so savedAt is never more than ~1 s older than a
// kill -9 (the resume shift then gives back at most ~1 s too much). The same beat notices a
// suspended process (laptop lid closed: timers stop, wall time does not) and pauses the clock by
// the gap — the deadline is a server-owned input, like `now`, so shifting it here keeps reduce pure.
const BEAT_MS = 1000;
const SUSPEND_GAP_MS = 3000;
let lastBeat = Date.now();
function beat(): void {
  const now = Date.now();
  const gap = now - lastBeat;
  lastBeat = now;
  const s = game.state;
  if (s.phase !== 'playing' || s.deadline === null) return;
  if (gap > SUSPEND_GAP_MS && commit(shiftDeadline(s, now - gap + BEAT_MS, now))) {
    console.log(`[bloko] process was suspended ${Math.round(gap / 1000)} s — timed clock paused for that long`);
    return; // commit saved + broadcast
  }
  saveGame(game);
}
setInterval(beat, BEAT_MS).unref();

// ---------- HTTP ----------

const lan = await pickLan();
const serveStatic = makeStaticHandler(ROOT);
/** The address phones open (the QR's content); without a LAN IP, the host the request came in on. */
const joinUrl = (hostHeader?: string): string =>
  `http://${lan ? `${lan.address}:${PORT}` : (hostHeader ?? `localhost:${PORT}`)}/play?room=${game.room}`;
const serveApi = makeApiHandler((req) => ({ url: joinUrl(req?.headers.host), code: game.room }));

const httpServer = createServer((req, res) => {
  serveApi(req, res)
    .then((handled) => (handled ? undefined : serveStatic(req, res)))
    .catch((e) => {
      console.error('[bloko] http error:', e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
});

// ---------- WebSocket protocol ----------

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

/** playerId of each identified player socket */
const who = new Map<WebSocket, string>();
/** live socket of each player (rejoin replaces it) */
const sockets = new Map<string, WebSocket>();
/** sockets whose hello carried the right room code (allowed to join) */
const roomOk = new WeakSet<WebSocket>();
/** sockets that said hello as a screen: the only receivers of pos */
const screens = new Set<WebSocket>();

/** Presence (ephemeral, never in State or on disk): players with a live socket, in seat order. */
const online = (): string[] => game.state.order.filter((id) => sockets.get(id)?.readyState === WebSocket.OPEN);

const viewMsg = () => JSON.stringify({ t: 'view', state: game.state, online: online(), now: Date.now(), best: bests.view(game.state) });

function send(ws: WebSocket, data: string | object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(typeof data === 'string' ? data : JSON.stringify(data));
}

function broadcast(): void {
  const msg = viewMsg();
  for (const c of wss.clients) send(c, msg);
}

function relayPos(playerId: string, pos: Pos): void {
  const msg = posMsg(playerId, pos);
  for (const c of screens) send(c, msg);
}

/** welcome, then the player's own last pos (the one pos a phone receives) so it resumes where its avatar stands. */
function welcome(ws: WebSocket, playerId: string): void {
  send(ws, { t: 'welcome', playerId });
  const pos = positions.get(playerId);
  if (pos) send(ws, posMsg(playerId, pos));
}

function sendErr(ws: WebSocket, code: ErrCode): void {
  send(ws, { t: 'err', code });
}

/** Forget a player's socket binding (the socket stays open as a fresh client). */
function detach(playerId: string): void {
  const ws = sockets.get(playerId);
  if (ws) who.delete(ws);
  sockets.delete(playerId);
}

/** Close code sent with `replaced` (4000–4999: application range). */
const CLOSE_REPLACED = 4001;

/**
 * Attach a socket to a playerId. Newest socket wins: a previous socket of that player (old device
 * after a reclaim, second tab) gets `replaced` and is closed. A socket that held another id lets it go.
 * Callers broadcast afterwards: presence changed.
 */
function attach(ws: WebSocket, playerId: string): void {
  const old = sockets.get(playerId);
  if (old && old !== ws) {
    who.delete(old);
    send(old, { t: 'replaced' });
    old.close(CLOSE_REPLACED, 'replaced');
  }
  const prevId = who.get(ws);
  if (prevId && prevId !== playerId && sockets.get(prevId) === ws) sockets.delete(prevId);
  sockets.set(playerId, ws);
  who.set(ws, playerId);
}

/** The non-left player holding a character, if any (left players' characters are free, never reclaimable). */
function holderOf(character: string): string | undefined {
  const s = game.state;
  return s.order.find((id) => !s.players[id].left && s.players[id].character === character);
}

const isOnline = (playerId: string): boolean => sockets.get(playerId)?.readyState === WebSocket.OPEN;

/** Why a (non-reclaim) join was refused, unchanged by reclaim: game under way or roster exhausted → full;
 *  otherwise the pick itself (held by an online player, or not a character) → taken. */
function joinRefusal(): ErrCode {
  const s = game.state;
  return s.phase !== 'lobby' || freeCharacters(s).length === 0 ? 'full' : 'taken';
}

const isPlainObject = (x: unknown): x is Settings => !!x && typeof x === 'object' && !Array.isArray(x);

function handleMessage(ws: WebSocket, m: any): void {
  if (m.t === 'hello') {
    const rejoin = m.role === 'player' && typeof m.playerId === 'string' && !!game.state.players[m.playerId];
    if (rejoin) {
      attach(ws, m.playerId); // rejoin: re-attach, welcome + view (no room check: stored ids outlive a code)
      welcome(ws, m.playerId);
    }
    if (String(m.room ?? '').trim().toUpperCase() === game.room) roomOk.add(ws);
    else roomOk.delete(ws);
    // screen and fresh player get the current view; a rejoin changes presence, so everyone gets it
    if (rejoin) broadcast(); else send(ws, viewMsg());
    if (m.role === 'screen') {
      screens.add(ws);
      for (const [playerId, pos] of positions.entries()) send(ws, posMsg(playerId, pos));
    } else {
      screens.delete(ws);
    }
    return;
  }

  if (m.t === 'pos') {
    // ephemeral avatar movement: bypasses the reducer; malformed, unjoined or flooding senders dropped silently
    const id = who.get(ws);
    if (!id || !canMove(game.state, id) || !positions.allow(ws)) return;
    const pos = parsePos(m);
    if (!pos) return;
    positions.set(id, pos);
    relayPos(id, pos);
    return;
  }

  if (m.t === 'join') {
    if (!roomOk.has(ws)) { sendErr(ws, 'bad-room'); return; }
    const character = m.character;
    // reclaim ("tap your character"): a character held by an OFFLINE player is taken back by this
    // socket, in any phase — same playerId, so board, score, hand and host role come along
    const holder = isCharacterId(character) ? holderOf(character) : undefined;
    if (holder && !isOnline(holder)) {
      attach(ws, holder);
      welcome(ws, holder);
      broadcast();
      return;
    }
    const id = `p-${randomUUID().slice(0, 8)}`;
    if (!isCharacterId(character) || !apply({ t: 'join', id, character })) { sendErr(ws, joinRefusal()); return; }
    attach(ws, id);
    welcome(ws, id);
    broadcast(); // the join's own broadcast ran before the socket was attached: presence now includes it
    return;
  }

  // everything below needs an identified player; actions are rebuilt field by field,
  // so server-only inputs (now, deadline, timeUp) can never come from the wire
  if (!['start', 'again', 'newGame', 'place', 'config', 'leave'].includes(m.t)) return;
  const id = who.get(ws);
  if (!id) { sendErr(ws, 'unknown-player'); return; }
  const phase = game.state.phase;

  switch (m.t) {
    case 'start':
    case 'again':
      if (!apply({ t: m.t, id, now: Date.now() })) sendErr(ws, 'not-host');
      return;

    case 'newGame':
      // podium → lobby (same players, room code kept); refused (non-host or not finished) → not-host, like again
      if (!apply({ t: 'newGame', id })) sendErr(ws, 'not-host');
      return;

    case 'place':
      if ((m.piece !== 0 && m.piece !== 1 && m.piece !== 2) || typeof m.x !== 'number' || typeof m.y !== 'number') {
        sendErr(ws, 'bad-place');
        return;
      }
      if (!apply({ t: 'place', id, piece: m.piece, x: m.x, y: m.y })) {
        sendErr(ws, phase === 'playing' ? 'bad-place' : 'not-playing');
      }
      return;

    case 'config':
      if (!isPlainObject(m.patch)) return;
      if (!apply({ t: 'config', id, patch: m.patch })) {
        // a host's no-op patch (unknown keys/values, same settings) is not an error
        if (id !== game.state.hostId) sendErr(ws, 'not-host');
        else if (phase === 'playing') sendErr(ws, 'locked');
      }
      return;

    case 'leave':
      // lobby/finished: the player is removed, so its stored id must not rejoin; playing: marked done, stays bound
      if (apply({ t: 'leave', id }) && !game.state.players[id]) detach(id);
      return;
  }
}

// Dead-socket sweep: a phone that vanished (battery, Wi-Fi, lid) often never sends a TCP close, and
// would stay "online" — blocking its character's reclaim. Ping every PING_MS; no pong by the next
// sweep → terminate (close handler then broadcasts it offline). Browsers answer pings natively.
const PING_MS = 5000;
const alive = new WeakSet<WebSocket>();
setInterval(() => {
  for (const c of wss.clients) {
    if (!alive.has(c)) { c.terminate(); continue; }
    alive.delete(c);
    c.ping();
  }
}, PING_MS).unref();

// Liveness tick: every open socket hears from the server at least every TICK_MS, so a client
// that hears NOTHING for 25 s knows its socket is half-open and reconnects (public/commun/liveness.js).
// It carries `now`, refreshing every client's clock skew for free.
const TICK_MS = 10_000;
setInterval(() => {
  const msg = JSON.stringify({ t: 'tick', now: Date.now() });
  for (const c of wss.clients) send(c, msg);
}, TICK_MS).unref();

wss.on('connection', (ws) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  send(ws, viewMsg()); // screen gets a view immediately on connect

  ws.on('message', (raw) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m === null || typeof m !== 'object') return;
    try {
      handleMessage(ws, m);
    } catch (e) {
      // a bad message or a reducer bug must not kill the game for everyone
      console.error('[bloko] message handling failed:', e);
    }
  });

  ws.on('close', () => {
    screens.delete(ws);
    const id = who.get(ws);
    who.delete(ws);
    if (id && sockets.get(id) === ws) {
      sockets.delete(id);
      broadcast(); // presence: this player is offline now (its character becomes reclaimable)
    }
    // player stays in the game: phones rejoin via hello + playerId.
    // A phone that drops mid-walk must not leave its avatar walking on the TV forever.
    const pos = id ? positions.get(id) : undefined;
    if (id && pos?.moving) {
      const stopped = { ...pos, moving: false };
      positions.set(id, stopped);
      relayPos(id, stopped);
    }
  });
});

// ---------- start ----------

saveGame(game); // a --new start must not let the next plain start resume the old game
clock.onChange(null, game.state); // resumed timed game: re-arm (fires at once if the deadline passed while down)

httpServer.listen(PORT, () => {
  console.log(`[bloko] ${loaded.how}`);
  console.log(`[bloko] saving to ${STATE_FILE}`);
  console.log(`[bloko] server → http://localhost:${PORT}/  (screen: /screen/, play: /play/, sim: /sim/)`);
  if (!lan) {
    console.log('[bloko] no LAN IPv4 detected (internal interfaces only) — set BLOKO_HOST to the address phones reach');
    return;
  }
  const url = joinUrl();
  qrcodeTerminal.generate(url, { small: true }, (qr) => {
    console.log(qr);
    console.log(`[bloko] phones → ${url}   room ${game.room}   (via ${lan.iface})`);
  });
});
