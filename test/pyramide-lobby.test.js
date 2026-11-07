// Pyramide's walkable lobby on a real server (its development start, scratch data, its real word list):
// the walkers start on the start positions, an eligible player walks onto a spot and off it, a wisp on a spot
// counts for nothing, a phone takes a spot, and after a kill -9 restart a holder's character stands on its spot
// again and everyone else on a start position.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PYRAMIDE_SPOTS, PYRAMIDE_START_POSITIONS } from '../shared/pyramide.js';
import { Client, freePort, player, rejoin, roomCode, screen, startServer, stop } from '../scripts/e2e-lib.mts';

/** The centre of a spot, where takeSpot and a restart put a character. @param {string} id */
const centre = (id) => {
  const s = /** @type {typeof PYRAMIDE_SPOTS[number]} */ (PYRAMIDE_SPOTS.find((x) => x.id === id));
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
};
const AWAY = { x: 8, y: 4 }; // on no spot

test('pyramide lobby over sockets: walking onto and off a spot, a wisp on one, takeSpot, a holder back on its spot after kill -9', { timeout: 20_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'itloe-pyramide-'));
  const port = await freePort();
  const url = `ws://127.0.0.1:${port}/ws`;
  /** @type {import('node:child_process').ChildProcess | null} */ let server = null;
  /** @type {Client[]} */ const sockets = [];
  /** @param {boolean} fresh */
  const boot = async (fresh) => { server = (await startServer(port, dir, 'minigame:pyramide', { fresh, stdio: 'pipe', env: { ...process.env, BLOKO_BIND: '127.0.0.1' } })).proc; };
  const kill9 = () => stop(server, 'SIGKILL');
  t.after(async () => {
    for (const c of sockets) c.ws.close();
    await kill9();
    rmSync(dir, { recursive: true, force: true });
  });
  /** @param {Client} c */
  const keep = (c) => { sockets.push(c); return c; };
  /** @param {Client} client @param {(m: any) => boolean} predicate @param {number} [from] */
  const until = (client, predicate, from = 0) => client.waitFor(predicate, from, 3000);
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

  await boot(true);
  const room = await roomCode(`http://127.0.0.1:${port}`);
  const tv1 = keep(await screen('tv', url));
  /** @type {Record<string, { c: Client, id: string }>} */
  const phones = {};
  for (const character of ['pierre', 'elodie', 'nico', 'sol', 'anna']) {
    phones[character] = await player(character, character, room, url);
    keep(phones[character].c);
  }
  const { pierre, elodie, nico, anna } = phones;
  pierre.c.send({ t: 'gm', op: { op: 'wisp', character: 'anna', on: true } });
  await until(tv1, (m) => m.t === 'view' && m.campaign.party.players[anna.id]?.statuses.includes('wisp'));
  pierre.c.send({ t: 'startMinigame' });
  const lobby = await until(tv1, (m) => m.t === 'view' && m.minigame?.status === 'lobby');
  assert.ok(lobby.minigame.shows.includes(elodie.id) && !lobby.minigame.shows.includes(anna.id), 'Anna is a wisp here');
  assert.deepEqual(Object.values(holders(lobby)), [null, null, null, null]);
  await until(elodie.c, posAtStart(elodie.id)); // every walker starts on a start position, on its phone and the TV
  await until(tv1, posAtStart(pierre.id));

  // Élodie walks onto team 1's clue spot, off it, and back
  const onClue = { x: 1.5, y: 6.5 };
  elodie.c.send({ t: 'pos', ...AWAY, dir: 'left', moving: true });
  await until(tv1, posAt(elodie.id, AWAY));
  elodie.c.send({ t: 'pos', ...onClue, dir: 'left', moving: false });
  await until(tv1, spotsWhere((h) => h['team1-clue'] === elodie.id));
  elodie.c.send({ t: 'pos', ...AWAY, dir: 'right', moving: false });
  await until(tv1, spotsWhere((h) => h['team1-clue'] === null));
  elodie.c.send({ t: 'pos', ...onClue, dir: 'left', moving: false });
  await until(tv1, spotsWhere((h) => h['team1-clue'] === elodie.id));

  // Anna's wisp walks onto team 2's clue spot: relayed, but it holds nothing
  const onTeam2 = centre('team2-clue');
  anna.c.send({ t: 'pos', ...AWAY, dir: 'right', moving: true });
  await until(tv1, posAt(anna.id, AWAY));
  anna.c.send({ t: 'pos', ...onTeam2, dir: 'right', moving: false });
  await until(tv1, posAt(anna.id, onTeam2));

  // Nico takes team 1's guesser spot from his phone: his character moves onto it, on his phone and the TV
  const nicoFrom = nico.c.mark();
  nico.c.send({ t: 'takeSpot', spot: 'team1-guess' });
  await until(nico.c, posAt(nico.id, centre('team1-guess')), nicoFrom);
  await until(tv1, posAt(nico.id, centre('team1-guess')));
  const taken = await until(tv1, spotsWhere((h) => h['team1-guess'] === nico.id));
  assert.equal(holders(taken)['team2-clue'], null, 'the wisp on team 2\'s spot counted for nothing');

  // kill -9: positions are gone, the holders aren't; each stands on its spot again, on the TV and its phone
  await kill9();
  await boot(false);
  const tv = keep(await screen('tv2', url));
  const resumed = await until(tv, spotsWhere((h) => h['team1-clue'] === elodie.id && h['team1-guess'] === nico.id));
  assert.equal(resumed.minigame.status, 'lobby');
  await until(tv, posAt(elodie.id, centre('team1-clue')));
  await until(tv, posAt(nico.id, centre('team1-guess')));
  const back = keep(await rejoin('elodie-back', elodie.id, undefined, url));
  await until(back, posAt(elodie.id, centre('team1-clue')));
  await until(tv, posAtStart(pierre.id));
});
