import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { OPENING_PLAYERS, INTRO_KEY, STORY_CONTENT } from '../shared/campaign/story/index.js';
import { gameMasterId } from '../shared/campaign/index.js';

const OPENING = /** @type {NonNullable<typeof STORY_CONTENT.machines>} */ (STORY_CONTENT.machines).opening.states;
const PORTAL = /** @type {NonNullable<typeof OPENING['portal-open']['zones']>} */ (OPENING['portal-open'].zones)[0];
const KEY_SPOT = /** @type {NonNullable<typeof OPENING['key-on-floor']['pickups']>} */ (OPENING['key-on-floor'].pickups)[0];
/** @param {any} view @param {string} machine */
const stateIn = (view, machine) => view.campaign?.facts.machines[machine]?.state;

test('wire: all four can leave the opening podium and rejoin, Pierre ends the block game, Elo reaches the key, Toni leaves on time, the tram takes her home, and she talks to Pierre there', { timeout: 30_000 }, async (t) => {
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
  /** @param {{messages: any[]}} client @param {(m: any) => boolean} predicate @param {number} [from] @param {number} [ms] */
  async function until(client, predicate, from = 0, ms = 2500) {
    for (let i = 0; i < ms / 10; i++) {
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
  const pierre = phones.get('pierre');
  assert.ok(pierre);
  pierre.send({ t: 'startMinigame' });
  await until(pierre, (m) => m.t === 'view' && m.minigame?.status === 'lobby');
  for (const character of OPENING_PLAYERS) phones.get(character).send({ t: 'ready', on: true });
  await until(pierre, (m) => m.t === 'view' && m.minigame?.view.ready.length === 4);
  pierre.send({ t: 'start' });
  await until(pierre, (m) => m.t === 'view' && m.minigame?.status === 'running');
  pierre.send({ t: 'endGame' });
  const finished = await until(pierre, (m) => m.t === 'view' && m.minigame?.status === 'podium');
  assert.equal(stateIn(finished, 'opening'), 'false-start', 'no portal before Pierre ends the block game');
  for (const character of OPENING_PLAYERS) {
    phones.get(character).send({ t: 'leave' });
    await until(screen, (m) => m.t === 'view' && m.campaign.party.players[phones.get(character).id]?.left);
  }
  for (const character of OPENING_PLAYERS) {
    const phone = phones.get(character);
    const fromWelcome = phone.messages.length;
    phone.send({ t: 'join', character });
    const welcome = await until(phone, (m) => m.t === 'welcome' && m.playerId !== phone.id, fromWelcome);
    phones.set(character, { ...phone, id: welcome.playerId });
  }
  // Pierre, rejoined, is the game master again: he ends the block game, and the portal appears
  const rejoined = phones.get('pierre');
  const fromLobby = rejoined.messages.length;
  rejoined.send({ t: 'lobby' });
  await until(rejoined, (m) => m.t === 'view' && m.minigame?.status === 'lobby', fromLobby);
  rejoined.send({ t: 'endMinigame' });
  await until(screen, (m) => m.t === 'view' && m.minigame === null && stateIn(m, 'opening') === 'portal-open');
  const elo = phones.get('elodie');
  assert.ok(elo);
  const from = screen.messages.length;
  elo.send({ t: 'pos', x: 6.4, y: 7.6, dir: 'right', moving: false });
  await until(screen, (m) => m.t === 'pos' && m.playerId === elo.id, from);
  elo.send({ t: 'pos', x: PORTAL.x, y: PORTAL.y, dir: 'up', moving: false });
  const hub = await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'hub');
  assert.equal(hub.campaign.party.order.filter((/** @type {string} */ id) => !hub.campaign.party.players[id].left).length, 4);
  assert.equal(stateIn(hub, 'opening'), 'apparition');
  const apparition = hub.campaign.news.find((/** @type {any} */ n) => n.t === 'cutscene' && n.id === 'apparition');
  assert.ok(apparition);
  screen.send({ t: 'ack', upTo: apparition.seq });
  await until(elo, (m) => m.t === 'view' && stateIn(m, 'opening') === 'key-on-floor');
  elo.send({ t: 'pos', x: KEY_SPOT.x, y: KEY_SPOT.y, dir: 'up', moving: false });
  elo.send({ t: 'interact', object: INTRO_KEY });
  const key = await until(elo, (m) => m.t === 'view' && m.campaign?.facts.inventory.elodie?.[INTRO_KEY] === 1);
  assert.equal(key.campaign.facts.unlocked.includes('young-adult'), true);
  elo.send({ t: 'enter', node: 'young-adult' });
  await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'young-adult');
  elo.send({ t: 'back' });
  const returned = await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'hub'
    && m.campaign?.facts.inventory.elodie?.[INTRO_KEY] === 1);
  assert.equal(returned.campaign.news.some((/** @type {any} */ n) => n.t === 'cutscene'), false);
  assert.equal(gameMasterId(returned.campaign.party, STORY_CONTENT), phones.get('pierre').id, 'Pierre, rejoined, stays the game master after the portal');
  assert.deepEqual(returned.campaign.party.players[phones.get('pierre').id].statuses, ['wisp'], 'the rejoined Pierre is a wisp');
  const refusedFrom = elo.messages.length;
  elo.send({ t: 'gm', op: { op: 'setFlag', flag: 'gm.pierre.checked', on: true } });
  assert.equal((await until(elo, (m) => m.t === 'err', refusedFrom)).code, 'not-gm');
  const gmFrom = pierre.messages.length;
  pierre.send({ t: 'gm', op: { op: 'setFlag', flag: 'gm.pierre.checked', on: true } });
  await until(pierre, (m) => m.t === 'view' && m.campaign?.facts.flags.includes('gm.pierre.checked'), gmFrom);

  // Tram 5: Élodie gives Toni a cigarette from the pack Pierre hands her; the server's timer makes him leave
  elo.send({ t: 'enter', node: 'young-adult' });
  await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'young-adult');
  elo.send({ t: 'enter', node: 'young-adult/tram-5' });
  await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'young-adult/tram-5');
  pierre.send({ t: 'gm', op: { op: 'give', item: 'cigarette-pack', to: 'elodie' } });
  await until(elo, (m) => m.t === 'view' && m.campaign?.facts.inventory.elodie?.['cigarette-pack'] === 1);
  elo.send({ t: 'pos', x: 10.5, y: 8, dir: 'right', moving: false });
  const givenFrom = elo.messages.length;
  elo.send({ t: 'interact', object: 'tram-5-weird-man' });
  const thanked = await until(elo, (m) => m.t === 'view' && stateIn(m, 'toni') === 'thanked', givenFrom);
  const gone = await until(elo, (m) => m.t === 'view' && stateIn(m, 'toni') === 'gone', givenFrom, 6000);
  const waited = gone.campaign.facts.machines.toni.since - thanked.campaign.facts.machines.toni.since;
  assert.ok(waited >= 3000 && waited < 4500, `Toni leaves about three seconds later (${waited} ms)`);

  // the tram: its quiz, then Élodie chooses where it goes (here the game master ends the quiz in its lobby)
  elo.send({ t: 'pos', x: 7.5, y: 6.8, dir: 'up', moving: false });
  const rideFrom = elo.messages.length;
  elo.send({ t: 'interact', object: 'tram-5-tram' });
  await until(elo, (m) => m.t === 'view' && stateIn(m, 'tram') === 'offered', rideFrom);
  elo.send({ t: 'enter', node: 'young-adult/tram-5/quiz' });
  await until(elo, (m) => m.t === 'view' && m.minigame?.status === 'lobby', rideFrom);
  pierre.send({ t: 'endMinigame' });
  await until(elo, (m) => m.t === 'view' && m.minigame === null && stateIn(m, 'tram') === 'riding', rideFrom);
  elo.send({ t: 'choose', option: 'flat' });
  await until(elo, (m) => m.t === 'view' && m.campaign?.at.node === 'young-adult/appart-elo-1', rideFrom);

  // Pierre arrives (three in-game hours), becomes himself; standing next to him, Élodie's phone is told he is in
  // reach, and talking to him reaches the story and the TV
  const me = phones.get('pierre');
  pierre.send({ t: 'gm', op: { op: 'count', counter: 'young-adult.clock.hours', set: 3 } });
  await until(elo, (m) => m.t === 'view' && m.campaign?.party.players[me.id]?.statuses.length === 0, rideFrom, 6000);
  const reachFrom = elo.messages.length;
  elo.send({ t: 'pos', x: 5, y: 7.6, dir: 'right', moving: false });
  me.send({ t: 'pos', x: 5.5, y: 7.6, dir: 'left', moving: false });
  await until(elo, (m) => m.t === 'reach' && m.characters.includes('pierre'), reachFrom);
  const talkFrom = screen.messages.length, eloTalkFrom = elo.messages.length;
  elo.send({ t: 'interact', character: 'pierre' });
  const said = await until(screen, (m) => m.t === 'interact' && m.character === 'pierre', talkFrom);
  assert.deepEqual([said.playerId, said.target, said.speaker], [elo.id, me.id, 'target'], 'Pierre answers');
  await until(elo, (m) => m.t === 'view' && stateIn(m, 'pierre-visit') === 'invites', eloTalkFrom);
  // out of reach again: the phone is told
  me.send({ t: 'pos', x: 12, y: 7.6, dir: 'left', moving: false });
  await until(elo, (m) => m.t === 'reach' && m.characters.length === 0, reachFrom + 1);
});
