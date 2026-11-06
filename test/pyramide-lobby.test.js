// Pyramide's walkable lobby on a real server (its development start, scratch data, its real word list):
// the walkers start on the start positions, an eligible player walks onto a spot and off it, a wisp on a spot
// counts for nothing, a phone takes a spot, and after a kill -9 restart a holder's character stands on its spot
// again and everyone else on a start position.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PYRAMIDE_SPOTS, PYRAMIDE_START_POSITIONS } from '../shared/pyramide.js';

const MAIN = new URL('../server/main.ts', import.meta.url).pathname;

/** The centre of a spot, where takeSpot and a restart put a character. @param {string} id */
const centre = (id) => {
  const s = /** @type {typeof PYRAMIDE_SPOTS[number]} */ (PYRAMIDE_SPOTS.find((x) => x.id === id));
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
};
const AWAY = { x: 8, y: 4 }; // on no spot

test('pyramide lobby over sockets: walking onto and off a spot, a wisp on one, takeSpot, a holder back on its spot after kill -9', { timeout: 20_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'itloe-pyramide-'));
  const port = await new Promise((resolve) => {
    const listener = createServer();
    listener.listen(0, '127.0.0.1', () => {
      const chosen = /** @type {import('node:net').AddressInfo} */ (listener.address()).port;
      listener.close(() => resolve(chosen));
    });
  });
  /** @type {import('node:child_process').ChildProcess | null} */ let server = null;
  /** @type {WebSocket[]} */ const sockets = [];
  /** @param {string[]} args */
  async function boot(args) {
    server = spawn(process.execPath, [MAIN, ...args], {
      env: { ...process.env, PORT: String(port), BLOKO_VAR: dir, BLOKO_BIND: '127.0.0.1', BLOKO_HOST: '127.0.0.1', ITLOE_CONTENT: 'minigame:pyramide' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 200; i++) {
      try { return (await (await fetch(`http://127.0.0.1:${port}/api/join`)).json()).code; }
      catch { await new Promise((r) => setTimeout(r, 30)); }
    }
    assert.fail('the server did not start');
  }
  async function kill9() {
    const child = /** @type {import('node:child_process').ChildProcess} */ (server);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  t.after(async () => {
    for (const ws of sockets) ws.close();
    if (server && server.exitCode === null && server.signalCode === null) await kill9();
    rmSync(dir, { recursive: true, force: true });
  });

  /** @param {object} hello */
  async function connect(hello) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    /** @type {any[]} */ const messages = [];
    ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.send(JSON.stringify(hello));
    return { messages, send: (/** @type {object} */ m) => ws.send(JSON.stringify(m)) };
  }
  /** @param {{ messages: any[] }} client @param {(m: any) => boolean} predicate @param {number} [from] */
  async function until(client, predicate, from = 0) {
    for (let i = 0; i < 300; i++) {
      const found = client.messages.slice(from).find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail(`timed out; received ${client.messages.slice(from).map((m) => m.t).join(', ')}`);
  }
  /** The holder of each spot in a view. @param {any} view */
  const holders = (view) => Object.fromEntries(view.minigame.spots.map((/** @type {any} */ s) => [s.id, s.holder]));
  /** A view whose spots match. @param {(h: Record<string, string | null>) => boolean} predicate */
  const spotsWhere = (/** @type {(h: Record<string, string | null>) => boolean} */ predicate) =>
    (/** @type {any} */ m) => m.t === 'view' && m.minigame?.spots && predicate(holders(m));
  /** A pos of this player on the screen or its phone. @param {string} id @param {{ x: number, y: number }} at */
  const posAt = (id, at) => (/** @type {any} */ m) => m.t === 'pos' && m.playerId === id && m.x === at.x && m.y === at.y;
  /** A pos of this player on one of the start positions. @param {string} id */
  const posAtStart = (id) => (/** @type {any} */ m) => m.t === 'pos' && m.playerId === id
    && PYRAMIDE_START_POSITIONS.some((p) => m.x === p.x && m.y === p.y);

  const room = await boot(['--new']);
  const screen = await connect({ t: 'hello', role: 'screen' });
  /** @type {Record<string, { id: string, messages: any[], send: (m: object) => void }>} */
  const phones = {};
  for (const character of ['pierre', 'elodie', 'nico', 'sol', 'anna']) {
    const phone = await connect({ t: 'hello', role: 'player', room });
    phone.send({ t: 'join', character });
    phones[character] = { ...phone, id: (await until(phone, (m) => m.t === 'welcome')).playerId };
  }
  const { pierre, elodie, nico, anna } = phones;
  pierre.send({ t: 'gm', op: { op: 'wisp', character: 'anna', on: true } });
  await until(screen, (m) => m.t === 'view' && m.campaign.party.players[anna.id]?.statuses.includes('wisp'));
  pierre.send({ t: 'startMinigame' });
  const lobby = await until(screen, (m) => m.t === 'view' && m.minigame?.status === 'lobby');
  assert.ok(lobby.minigame.shows.includes(elodie.id) && !lobby.minigame.shows.includes(anna.id), 'Anna is a wisp here');
  assert.deepEqual(Object.values(holders(lobby)), [null, null, null, null]);
  await until(elodie, posAtStart(elodie.id)); // every walker starts on a start position, on its phone and the TV
  await until(screen, posAtStart(pierre.id));

  // Élodie walks onto team 1's clue spot, off it, and back
  const onClue = { x: 1.5, y: 6.5 };
  elodie.send({ t: 'pos', ...AWAY, dir: 'left', moving: true });
  await until(screen, posAt(elodie.id, AWAY));
  elodie.send({ t: 'pos', ...onClue, dir: 'left', moving: false });
  await until(screen, spotsWhere((h) => h['team1-clue'] === elodie.id));
  elodie.send({ t: 'pos', ...AWAY, dir: 'right', moving: false });
  await until(screen, spotsWhere((h) => h['team1-clue'] === null));
  elodie.send({ t: 'pos', ...onClue, dir: 'left', moving: false });
  await until(screen, spotsWhere((h) => h['team1-clue'] === elodie.id));

  // Anna's wisp walks onto team 2's clue spot: relayed, but it holds nothing
  const onTeam2 = centre('team2-clue');
  anna.send({ t: 'pos', ...AWAY, dir: 'right', moving: true });
  await until(screen, posAt(anna.id, AWAY));
  anna.send({ t: 'pos', ...onTeam2, dir: 'right', moving: false });
  await until(screen, posAt(anna.id, onTeam2));

  // Nico takes team 1's guesser spot from his phone: his character moves onto it, on his phone and the TV
  const nicoFrom = nico.messages.length;
  nico.send({ t: 'takeSpot', spot: 'team1-guess' });
  await until(nico, posAt(nico.id, centre('team1-guess')), nicoFrom);
  await until(screen, posAt(nico.id, centre('team1-guess')));
  const taken = await until(screen, spotsWhere((h) => h['team1-guess'] === nico.id));
  assert.equal(holders(taken)['team2-clue'], null, 'the wisp on team 2\'s spot counted for nothing');

  // kill -9: positions are gone, the holders aren't; each stands on its spot again, on the TV and its phone
  await kill9();
  await boot([]);
  const tv = await connect({ t: 'hello', role: 'screen' });
  const resumed = await until(tv, spotsWhere((h) => h['team1-clue'] === elodie.id && h['team1-guess'] === nico.id));
  assert.equal(resumed.minigame.status, 'lobby');
  await until(tv, posAt(elodie.id, centre('team1-clue')));
  await until(tv, posAt(nico.id, centre('team1-guess')));
  const back = await connect({ t: 'hello', role: 'player', playerId: elodie.id });
  await until(back, (m) => m.t === 'welcome' && m.playerId === elodie.id);
  await until(back, posAt(elodie.id, centre('team1-clue')));
  await until(tv, posAtStart(pierre.id));
});
