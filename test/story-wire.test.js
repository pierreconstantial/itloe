import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { OPENING_PLAYERS, INTRO_KEY, PORTAL, INTRO_KEY_SPOT } from '../shared/campaign/story.js';

test('wire: all four can leave the opening podium, rejoin, and Elo can reach the key', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'itloe-story-'));
  const port = await new Promise((resolve) => {
    const listener = createServer();
    listener.listen(0, '127.0.0.1', () => {
      const chosen = /** @type {import('node:net').AddressInfo} */ (listener.address()).port;
      listener.close(() => resolve(chosen));
    });
  });
  const server = spawn(process.execPath, [new URL('../server/main.ts', import.meta.url).pathname, '--new'], {
    env: { ...process.env, PORT: String(port), BLOKO_VAR: dir, BLOKO_HOST: '127.0.0.1' }, stdio: 'ignore',
  });
  /** @type {WebSocket[]} */ const sockets = [];
  t.after(() => { for (const ws of sockets) ws.close(); server.kill(); rmSync(dir, { recursive: true, force: true }); });
  let room;
  for (let i = 0; i < 100; i++) {
    try { room = (await (await fetch(`http://127.0.0.1:${port}/api/join`)).json()).code; break; }
    catch { await new Promise((r) => setTimeout(r, 30)); }
  }
  assert.ok(room);

  /** @param {string} role @param {string | undefined} [code] */
  async function connect(role, code) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    /** @type {any[]} */ const messages = [];
    ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.send(JSON.stringify({ t: 'hello', role, ...(code ? { room: code } : {}) }));
    return { ws, messages, send: (/** @type {object} */ m) => ws.send(JSON.stringify(m)) };
  }
  /** @param {{messages: any[]}} client @param {(m: any) => boolean} predicate @param {number} [from] */
  async function until(client, predicate, from = 0) {
    for (let i = 0; i < 250; i++) {
      const found = client.messages.slice(from).find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail(`timed out; received ${client.messages.slice(from).map((m) => m.t).join(', ')}`);
  }
  const screen = await connect('screen');
  const phones = new Map();
  for (const character of OPENING_PLAYERS) {
    const phone = await connect('player', room);
    phone.send({ t: 'join', character });
    const welcome = await until(phone, (m) => m.t === 'welcome');
    phones.set(character, { ...phone, id: welcome.playerId });
  }
  const host = phones.get('pierre');
  assert.ok(host);
  host.send({ t: 'start' });
  await until(host, (m) => m.t === 'view' && m.round?.status === 'running');
  host.send({ t: 'endGame' });
  const finished = await until(host, (m) => m.t === 'view' && m.round?.status === 'finished');
  assert.ok(finished.campaign.facts.flags.includes('portal.ready'));
  for (const character of OPENING_PLAYERS.filter((character) => character !== 'pierre')) {
    phones.get(character).send({ t: 'leave' });
    await until(screen, (m) => m.t === 'view' && m.campaign.party.players[phones.get(character).id]?.left);
  }
  host.send({ t: 'leave' });
  await until(screen, (m) => m.t === 'view' && m.round === null && m.campaign.facts.flags.includes('portal.ready'));
  for (const character of OPENING_PLAYERS) {
    const phone = phones.get(character);
    const fromWelcome = phone.messages.length;
    phone.send({ t: 'join', character });
    const welcome = await until(phone, (m) => m.t === 'welcome' && m.playerId !== phone.id, fromWelcome);
    phones.set(character, { ...phone, id: welcome.playerId });
  }
  const elo = phones.get('elodie');
  assert.ok(elo);
  const from = screen.messages.length;
  elo.send({ t: 'pos', x: 6.4, y: 7.6, dir: 'right', moving: false });
  await until(screen, (m) => m.t === 'pos' && m.playerId === elo.id, from);
  elo.send({ t: 'pos', x: PORTAL.x, y: PORTAL.y, dir: 'up', moving: false });
  const hub = await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'hub');
  assert.equal(hub.campaign.party.order.filter((/** @type {string} */ id) => !hub.campaign.party.players[id].left).length, 4);
  assert.equal(hub.campaign.facts.flags.includes('apparition.seen'), false);
  const apparition = hub.campaign.news.find((/** @type {any} */ n) => n.t === 'apparition');
  assert.ok(apparition);
  screen.send({ t: 'ack', upTo: apparition.seq });
  await until(elo, (m) => m.t === 'view' && m.campaign?.facts.flags.includes('apparition.seen'));
  elo.send({ t: 'pos', x: INTRO_KEY_SPOT.x, y: INTRO_KEY_SPOT.y, dir: 'up', moving: false });
  elo.send({ t: 'interact', object: INTRO_KEY });
  const key = await until(elo, (m) => m.t === 'view' && m.campaign?.facts.inventory.elodie?.[INTRO_KEY] === 1);
  assert.equal(key.campaign.facts.unlocked.includes('hub.door4'), true);
  elo.send({ t: 'enter', node: 'hub.door4' });
  await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'hub.door4');
  elo.send({ t: 'back' });
  const returned = await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'hub'
    && m.campaign?.facts.inventory.elodie?.[INTRO_KEY] === 1);
  assert.equal(returned.campaign.news.some((/** @type {any} */ n) => n.t === 'apparition'), false);
});
