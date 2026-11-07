import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORY_CONTENT } from '../shared/campaign/story/index.js';
import { freePort, rejoin, roomCode, roundTrip, startServer, stop } from '../scripts/e2e-lib.mts';

const NIGHT = /** @type {NonNullable<typeof STORY_CONTENT.machines>} */ (STORY_CONTENT.machines).exits.states.night;
const zone = (/** @type {string} */ id) => /** @type {NonNullable<typeof NIGHT.zones>} */ (NIGHT.zones).find((z) => z.id === id) ?? assert.fail(id);
const ENTRANCE = zone('shelter-entrance'), EXIT = zone('shelter-exit');

test('wire: a door\'s way back stays shut until Élodie steps away from where she arrived (no bouncing with the stick held)', { timeout: 20_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'itloe-doors-'));
  const port = await freePort();
  const http = `http://127.0.0.1:${port}`;
  const { proc } = await startServer(port, dir, '', { stdio: 'pipe', env: { ...process.env, BLOKO_BIND: '127.0.0.1' } })
    .catch((e) => { rmSync(dir, { recursive: true, force: true }); throw e; });
  /** @type {import('../scripts/e2e-lib.mts').Client | null} */ let elo = null;
  t.after(async () => { elo?.ws.close(); await stop(proc); rmSync(dir, { recursive: true, force: true }); });

  // Tram 5 at night, as the story gets there; Élodie's phone takes the seat the scene prepared
  const page = await (await fetch(`${http}/test/young-adult/tram-5/night`)).text();
  const slots = JSON.parse(/const slots = (\[.*?\]);/.exec(page)?.[1] ?? '[]');
  const eloId = slots.find((/** @type {any} */ s) => s.character === 'elodie')?.id;
  assert.ok(eloId, 'the scene seats Élodie');
  const phone = await rejoin('elo', eloId, await roomCode(http), `ws://127.0.0.1:${port}/ws`);
  elo = phone;
  /** @param {number} x @param {number} y @param {boolean} [moving] */
  const step = async (x, y, moving = true) => { phone.send({ t: 'pos', x, y, dir: 'up', moving }); await roundTrip(phone); };
  const node = async () => { await roundTrip(phone); return phone.last()?.campaign?.at.node; };

  await step(ENTRANCE.x, ENTRANCE.y + 1.2, false); // in front of the entrance
  const from = phone.mark();
  await step(ENTRANCE.x, ENTRANCE.y); // up into it
  const arrived = await phone.waitFor((m) => m.t === 'pos' && m.playerId === eloId, from);
  assert.equal(await node(), 'young-adult/shelter');

  // the stick still held up: from the foot of the stair straight into its exit, which stays shut
  await step(arrived.x, arrived.y - 0.3);
  await step(EXIT.x, EXIT.y);
  assert.equal(await node(), 'young-adult/shelter', 'no bounce back to Tram 5');

  // stepping away and back in leads out
  await step(arrived.x, arrived.y + ARRIVAL_AWAY);
  const out = phone.mark();
  await step(EXIT.x, EXIT.y);
  await phone.waitFor((m) => m.t === 'view' && m.campaign?.at.node === 'young-adult/tram-5', out);
});

/** Far enough from an arrival spot to open its doors again (the server's ARRIVAL_CLEAR is 1.5). */
const ARRIVAL_AWAY = 1.8;
