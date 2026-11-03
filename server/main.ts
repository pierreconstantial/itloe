// Bloko server: HTTP static + WebSocket on one port, PROTOCOL.md over the shared pure reducer.
// Every state change goes through apply() → solo best, save to disk, remember settings, arm the timed-mode clock, broadcast.
// Run: npm start          (resumes a saved game in phase playing/finished)
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
import { makeBests } from './bests.ts';
import { loadGame, saveGame, saveSettings, STATE_FILE, type Game } from './store.ts';
import { reduce, type ServerAction, type Settings, type State } from './rules.ts';

type ErrCode = 'full' | 'bad-place' | 'not-host' | 'not-playing' | 'unknown-player' | 'locked' | 'bad-room';

const PORT = Number(process.env.PORT ?? 3131);
const ROOT = new URL('..', import.meta.url).pathname;
const FORCE_NEW = process.argv.includes('--new') || process.env.BLOKO_NEW === '1';

// ---------- game state + change hooks (wrap reduce, never inside it) ----------

const loaded = loadGame(FORCE_NEW);
const game: Game = { state: loaded.state, room: loaded.room, bestPrevious: loaded.bestPrevious ?? null };

const bests = makeBests(game);

const clock = makeClock((deadline) => apply({ t: 'timeUp', deadline }));

const onChange: ((prev: State, next: State) => void)[] = [
  (prev, next) => bests.onChange(prev, next), // before saveGame: it sets game.bestPrevious
  () => saveGame(game),
  (prev, next) => { if (next.settings && next.settings !== prev?.settings) saveSettings(next.settings); },
  (prev, next) => clock.onChange(prev, next),
  () => broadcast(),
];

/** Runs an action through the reducer; returns false when it was refused (state unchanged). */
function apply(action: ServerAction): boolean {
  const prev = game.state;
  const next = reduce(prev, action);
  if (next === prev) return false;
  game.state = next;
  for (const hook of onChange) hook(prev, next);
  return true;
}

// ---------- HTTP ----------

const lan = await pickLan();
const serveStatic = makeStaticHandler(ROOT);
const serveApi = makeApiHandler((req) => ({
  url: `http://${lan ? `${lan.address}:${PORT}` : (req?.headers.host ?? `localhost:${PORT}`)}/play?room=${game.room}`,
  code: game.room,
}));

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

const viewMsg = () => JSON.stringify({ t: 'view', state: game.state, now: Date.now(), best: bests.view(game.state) });

function send(ws: WebSocket, data: string | object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(typeof data === 'string' ? data : JSON.stringify(data));
}

function broadcast(): void {
  const msg = viewMsg();
  for (const c of wss.clients) send(c, msg);
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

/** Attach a socket to a playerId, closing any previous socket of that player. */
function attach(ws: WebSocket, playerId: string): void {
  const old = sockets.get(playerId);
  if (old && old !== ws) {
    who.delete(old);
    old.close();
  }
  sockets.set(playerId, ws);
  who.set(ws, playerId);
}

const isPlainObject = (x: unknown): x is Settings => !!x && typeof x === 'object' && !Array.isArray(x);

function handleMessage(ws: WebSocket, m: any): void {
  if (m.t === 'hello') {
    if (m.role === 'player' && typeof m.playerId === 'string' && game.state.players[m.playerId]) {
      attach(ws, m.playerId); // rejoin: re-attach, welcome + view (no room check: stored ids outlive a code)
      send(ws, { t: 'welcome', playerId: m.playerId });
    }
    if (String(m.room ?? '').trim().toUpperCase() === game.room) roomOk.add(ws);
    else roomOk.delete(ws);
    send(ws, viewMsg()); // screen, fresh player and rejoin all get the current view
    return;
  }

  if (m.t === 'join') {
    if (!roomOk.has(ws)) { sendErr(ws, 'bad-room'); return; }
    const id = `p-${randomUUID().slice(0, 8)}`;
    if (!apply({ t: 'join', id, name: String(m.name ?? 'Player') })) { sendErr(ws, 'full'); return; }
    attach(ws, id);
    send(ws, { t: 'welcome', playerId: id });
    return;
  }

  // everything below needs an identified player; actions are rebuilt field by field,
  // so server-only inputs (now, deadline, timeUp) can never come from the wire
  if (!['start', 'again', 'place', 'config', 'leave'].includes(m.t)) return;
  const id = who.get(ws);
  if (!id) { sendErr(ws, 'unknown-player'); return; }
  const phase = game.state.phase;

  switch (m.t) {
    case 'start':
    case 'again':
      if (!apply({ t: m.t, id, now: Date.now() })) sendErr(ws, 'not-host');
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

wss.on('connection', (ws) => {
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
    const id = who.get(ws);
    who.delete(ws);
    if (id && sockets.get(id) === ws) sockets.delete(id);
    // player stays in the game: phones rejoin via hello + playerId
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
  const url = `http://${lan.address}:${PORT}/play`;
  qrcodeTerminal.generate(url, { small: true }, (qr) => {
    console.log(qr);
    console.log(`[bloko] phones → ${url}   room ${game.room}   (via ${lan.iface})`);
  });
});
