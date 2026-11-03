// P0 — mock server for client development (P3 /jouer, P4 /ecran).
// Near-real rules without shared/game.js reduce(). Throwaway: replaced by main.ts at integration.
// Run: npm run mock   (PORT=3132 npm run mock for a second instance)

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { makeStaticHandler } from './static.ts';
import { initState, newPlayer, placementScore } from '../shared/game.js';
import { PIECES, handAt } from '../shared/pieces.js';
import { canPlace, place, findClears, applyClears, anyFit, emptyBoard } from '../shared/board.js';

const PORT = Number(process.env.PORT ?? 3131);
const ROOT = new URL('..', import.meta.url).pathname;

let state = initState(Date.now() >>> 0);

const httpServer = createServer(makeStaticHandler(ROOT));
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

/** playerId per socket (jouer only) */
const who = new Map<WebSocket, string>();

function broadcast(): void {
  const msg = JSON.stringify({ t: 'view', state });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

function send(ws: WebSocket, data: unknown): void {
  ws.send(JSON.stringify(data));
}

function dealAll(): void {
  for (const p of Object.values(state.players)) {
    p.hand = [...handAt(state.seed, p.handIndex)];
  }
}

wss.on('connection', (ws) => {
  send(ws, { t: 'view', state });

  ws.on('message', (raw) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }

    if (m.t === 'hello') {
      if (m.role === 'jouer' && typeof m.playerId === 'string' && state.players[m.playerId]) {
        who.set(ws, m.playerId);
        send(ws, { t: 'welcome', playerId: m.playerId });
      }
      send(ws, { t: 'view', state });
      return;
    }

    if (m.t === 'join') {
      if (state.phase !== 'lobby' || state.order.length >= 4) { send(ws, { t: 'err', code: 'full' }); return; }
      const id = `p-${Math.random().toString(36).slice(2, 8)}`;
      const color = state.order.length + 1;
      state.players[id] = newPlayer(id, String(m.name ?? 'Joueur'), color, state.size);
      state.order.push(id);
      if (!state.hostId) state.hostId = id;
      who.set(ws, id);
      send(ws, { t: 'welcome', playerId: id });
      broadcast();
      return;
    }

    if (m.t === 'start') {
      if (state.phase !== 'lobby' || state.order.length === 0) return;
      state.phase = 'playing';
      dealAll();
      broadcast();
      return;
    }

    if (m.t === 'place') {
      const id = who.get(ws);
      const p = id ? state.players[id] : undefined;
      if (!p || state.phase !== 'playing' || p.done) { send(ws, { t: 'err', code: 'not-playing' }); return; }
      const pieceId = p.hand[m.piece];
      if (pieceId == null || !canPlace(p.board, state.size, PIECES[pieceId].cells, m.x, m.y)) {
        send(ws, { t: 'err', code: 'bad-place' });
        return;
      }
      const cells = PIECES[pieceId].cells;
      let board = place(p.board, state.size, cells, m.x, m.y, p.color);
      const clears = findClears(board, state.size);
      const lines = clears.rows.length + clears.cols.length;
      board = applyClears(board, state.size, clears);
      const emptied = lines > 0 && board.every((c) => c === 0);
      p.score += placementScore(cells.length, lines, p.streak, emptied);
      if (lines > 0) { p.streak += 1; p.graceLeft = 1; }
      else if (p.graceLeft > 0) p.graceLeft -= 1;
      else p.streak = 0;
      p.board = board;
      p.hand[m.piece] = null;
      if (p.hand.every((h) => h === null)) {
        p.handIndex += 1;
        p.hand = [...handAt(state.seed, p.handIndex)];
      }
      if (!anyFit(p.board, state.size, p.hand)) p.done = true;
      if (state.order.every((pid) => state.players[pid].done)) state.phase = 'finished';
      broadcast();
      return;
    }

    if (m.t === 'again') {
      state.seed = Date.now() >>> 0;
      state.phase = 'playing';
      for (const p of Object.values(state.players)) {
        p.board = emptyBoard(state.size);
        p.handIndex = 0; p.score = 0; p.streak = 0; p.graceLeft = 1; p.done = false;
      }
      dealAll();
      broadcast();
      return;
    }

    if (m.t === 'debug') {
      const names = ['Léa', 'Tom', 'Inès', 'Max'];
      state = initState(42);
      names.forEach((name, i) => {
        const id = `p-mock${i + 1}`;
        const p = newPlayer(id, name, i + 1, state.size);
        state.players[id] = p;
        state.order.push(id);
      });
      state.hostId = state.order[0];
      if (m.scenario === 'midgame' || m.scenario === 'finished') {
        state.phase = 'playing';
        dealAll();
        state.order.forEach((id, i) => {
          const p = state.players[id];
          // deterministic half-filled board: diagonal-ish noise, distinct per player
          for (let c = 0; c < p.board.length; c++) {
            if ((c * 7 + i * 13) % 3 === 0 && (c + i) % 11 !== 0) p.board[c] = ((c + i) % 4) + 1;
          }
          p.score = 120 + i * 173;
          p.streak = i % 3;
        });
      }
      if (m.scenario === 'finished') {
        state.phase = 'finished';
        for (const id of state.order) state.players[id].done = true;
      }
      broadcast();
      return;
    }
  });

  ws.on('close', () => who.delete(ws));
});

httpServer.listen(PORT, () => {
  console.log(`[mock] Bloko mock server → http://localhost:${PORT}/  (ecran: /ecran/, jouer: /jouer/, sim: /sim/)`);
});
