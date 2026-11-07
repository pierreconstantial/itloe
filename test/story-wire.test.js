import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPENING_PLAYERS, INTRO_KEY, STORY_CONTENT } from '../shared/campaign/story/index.js';
import { gameMasterId } from '../shared/campaign/index.js';
import { Client, freePort, player, roomCode, screen as screenOf, settled, startServer, stop } from '../scripts/e2e-lib.mts';

const OPENING = /** @type {NonNullable<typeof STORY_CONTENT.machines>} */ (STORY_CONTENT.machines).opening.states;
const PORTAL = /** @type {NonNullable<typeof OPENING['portal-open']['zones']>} */ (OPENING['portal-open'].zones)[0];
const KEY_SPOT = /** @type {NonNullable<typeof OPENING['key-on-floor']['pickups']>} */ (OPENING['key-on-floor'].pickups)[0];
/** @param {any} view @param {string} machine */
const stateIn = (view, machine) => view.campaign?.facts.machines[machine]?.state;

test('wire: all four can leave the opening podium and rejoin, Pierre ends the block game, Elo reaches the key, Toni leaves on time, the tram takes her home, and she talks to Pierre there and hugs him', { timeout: 30_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'itloe-story-'));
  const port = await freePort();
  const url = `ws://127.0.0.1:${port}/ws`;
  const { proc } = await startServer(port, dir, '', { stdio: 'pipe' }).catch((e) => { rmSync(dir, { recursive: true, force: true }); throw e; });
  /** @type {Client[]} */ const sockets = [];
  t.after(async () => { for (const c of sockets) c.ws.close(); await stop(proc); rmSync(dir, { recursive: true, force: true }); });
  const room = await roomCode(`http://127.0.0.1:${port}`);

  /** @param {Client} client @param {(m: any) => boolean} predicate @param {number} [from] @param {number} [ms] */
  const until = (client, predicate, from = 0, ms = 2500) => client.waitFor(predicate, from, ms);
  const screen = await screenOf('tv', url);
  sockets.push(screen);
  const phones = new Map();
  for (const character of OPENING_PLAYERS) {
    const { c } = await player(character, character, room, url);
    sockets.push(c);
    phones.set(character, c);
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
    const left = phone.id;
    const fromWelcome = phone.mark();
    phone.send({ t: 'join', character });
    await until(phone, (m) => m.t === 'welcome' && m.playerId !== left, fromWelcome);
  }
  // Pierre, rejoined, is the game master again: he ends the block game, and the portal appears
  const rejoined = phones.get('pierre');
  const fromLobby = rejoined.mark();
  rejoined.send({ t: 'lobby' });
  await until(rejoined, (m) => m.t === 'view' && m.minigame?.status === 'lobby', fromLobby);
  rejoined.send({ t: 'endMinigame' });
  await until(screen, (m) => m.t === 'view' && m.minigame === null && stateIn(m, 'opening') === 'portal-open');
  const elo = phones.get('elodie');
  assert.ok(elo);
  const from = screen.mark();
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
  const refusedFrom = elo.mark();
  elo.send({ t: 'gm', op: { op: 'setFlag', flag: 'gm.pierre.checked', on: true } });
  assert.equal((await until(elo, (m) => m.t === 'err', refusedFrom)).code, 'not-gm');
  const gmFrom = pierre.mark();
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
  const givenFrom = elo.mark();
  elo.send({ t: 'interact', object: 'tram-5-weird-man' });
  const thanked = await until(elo, (m) => m.t === 'view' && stateIn(m, 'toni') === 'thanked', givenFrom);
  const gone = await until(elo, (m) => m.t === 'view' && stateIn(m, 'toni') === 'gone', givenFrom, 6000);
  const waited = gone.campaign.facts.machines.toni.since - thanked.campaign.facts.machines.toni.since;
  assert.ok(waited >= 3000 && waited < 4500, `Toni leaves about three seconds later (${waited} ms)`);

  // the tram: its quiz, then Élodie chooses where it goes (here the game master ends the quiz in its lobby)
  elo.send({ t: 'pos', x: 7.5, y: 6.8, dir: 'up', moving: false });
  const rideFrom = elo.mark();
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
  const reachFrom = elo.mark();
  // open floor, away from the flat's story objects (a story action hides the group actions)
  elo.send({ t: 'pos', x: 8, y: 8.2, dir: 'right', moving: false });
  me.send({ t: 'pos', x: 8.5, y: 8.2, dir: 'left', moving: false });
  await until(elo, (m) => m.t === 'reach' && m.characters.includes('pierre'), reachFrom);
  const talkFrom = screen.mark(), eloTalkFrom = elo.mark();
  elo.send({ t: 'interact', character: 'pierre' });
  const said = await until(screen, (m) => m.t === 'interact' && m.character === 'pierre', talkFrom);
  assert.deepEqual([said.playerId, said.target, said.speaker], [elo.id, me.id, 'target'], 'Pierre answers');
  await until(elo, (m) => m.t === 'view' && stateIn(m, 'pierre-visit') === 'invites', eloTalkFrom);
  // a group hug: refused while a story action on Pierre is available, then with everyone in reach
  await new Promise((r) => setTimeout(r, 750)); // interact's rate limit
  const hugFrom = screen.mark();
  elo.send({ t: 'interact', group: 'hug' });
  await settled([elo], [screen]);
  assert.equal(screen.since(hugFrom).some((m) => m.t === 'interact' && m.group), false, 'the story action hides the hug');
  const doneFrom = elo.mark();
  pierre.send({ t: 'gm', op: { op: 'machine', machine: 'pierre-visit', state: 'done' } });
  await until(elo, (m) => m.t === 'view' && stateIn(m, 'pierre-visit') === 'done', doneFrom);
  elo.send({ t: 'interact', group: 'hug' });
  const hug = await until(screen, (m) => m.t === 'interact' && m.group === 'hug', hugFrom);
  assert.deepEqual([hug.playerId, hug.with], [elo.id, [me.id]]);
  // out of reach again: the phone is told
  me.send({ t: 'pos', x: 12, y: 7.6, dir: 'left', moving: false });
  await until(elo, (m) => m.t === 'reach' && m.characters.length === 0, reachFrom + 1);
});
