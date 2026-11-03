// P2 — real server: HTTP static + WebSocket on one port, PROTOCOL.md over shared/game.js reduce().
// Run: npm start   (PORT=3132 npm start for another instance)

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { makeStaticHandler } from './static.ts';
import { initState, reduce } from '../shared/game.js';

type State = ReturnType<typeof initState>;
type Action = Parameters<typeof reduce>[1];
type ErrCode = 'full' | 'bad-place' | 'not-host' | 'not-playing' | 'unknown-player';

const PORT = Number(process.env.PORT ?? 3131);
const ROOT = new URL('..', import.meta.url).pathname;

let state: State = initState(Date.now() >>> 0);

const httpServer = createServer(makeStaticHandler(ROOT));
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

/** playerId of each identified jouer socket */
const who = new Map<WebSocket, string>();
/** live socket of each player (rejoin replaces it) */
const sockets = new Map<string, WebSocket>();

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function broadcast(): void {
  const msg = JSON.stringify({ t: 'view', state });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

function sendErr(ws: WebSocket, code: ErrCode): void {
  send(ws, { t: 'err', code });
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

/** Run an action through the reducer; broadcast on change, err to sender otherwise. */
function dispatch(ws: WebSocket, action: Action, errCode: ErrCode): boolean {
  const next = reduce(state, action);
  if (next === state) {
    sendErr(ws, errCode);
    return false;
  }
  state = next;
  broadcast();
  return true;
}

function handleMessage(ws: WebSocket, m: any): void {
  if (m.t === 'hello') {
    if (m.role === 'jouer' && typeof m.playerId === 'string' && state.players[m.playerId]) {
      attach(ws, m.playerId); // rejoin: re-attach, welcome + view
      send(ws, { t: 'welcome', playerId: m.playerId });
    }
    send(ws, { t: 'view', state }); // ecran, fresh jouer and rejoin all get the current view
    return;
  }

  if (m.t === 'join') {
    const id = `p-${randomUUID().slice(0, 8)}`;
    const ok = dispatch(ws, { t: 'join', id, name: String(m.name ?? 'Joueur') }, 'full');
    if (ok) {
      attach(ws, id);
      send(ws, { t: 'welcome', playerId: id });
    }
    return;
  }

  // start / again / place need an identified player
  const id = who.get(ws);
  if (m.t === 'start' || m.t === 'again' || m.t === 'place') {
    if (!id) { sendErr(ws, 'unknown-player'); return; }
  }

  if (m.t === 'start' && id) {
    dispatch(ws, { t: 'start', id }, 'not-host');
    return;
  }

  if (m.t === 'again' && id) {
    dispatch(ws, { t: 'again', id }, 'not-host');
    return;
  }

  if (m.t === 'place' && id) {
    if (m.piece !== 0 && m.piece !== 1 && m.piece !== 2) { sendErr(ws, 'bad-place'); return; }
    if (typeof m.x !== 'number' || typeof m.y !== 'number') { sendErr(ws, 'bad-place'); return; }
    const code: ErrCode = state.phase !== 'playing' ? 'not-playing' : 'bad-place';
    dispatch(ws, { t: 'place', id, piece: m.piece, x: m.x, y: m.y }, code);
    return;
  }
}

wss.on('connection', (ws) => {
  send(ws, { t: 'view', state }); // ecran gets a view immediately on connect

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

function lanIPv4(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

httpServer.listen(PORT, () => {
  const ip = lanIPv4();
  console.log(`[bloko] serveur → http://localhost:${PORT}/  (ecran: /ecran/, jouer: /jouer/, sim: /sim/)`);
  if (ip) console.log(`[bloko] téléphones → http://${ip}:${PORT}/jouer`);
  else console.log('[bloko] pas d’IPv4 LAN détectée (interfaces internes uniquement)');
});
