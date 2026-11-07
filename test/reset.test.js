// /?reset=1: a confirmation page, then a fresh evening saved and an exit; the restart loads it.
// Real server, scratch data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, player, roomCode, screen, startServer, stop } from '../scripts/e2e-lib.mts';

test('/?reset=1 asks first, then saves a fresh evening and exits for the restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'itloe-reset-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const url = `ws://127.0.0.1:${port}/ws`;
  /** @type {import('node:child_process').ChildProcess[]} */ const servers = [];
  t.after(async () => { for (const s of servers) await stop(s); rmSync(dir, { recursive: true, force: true }); });
  /** Starts the server (a fresh evening, else the saved one) and resolves with it and its room code. @param {boolean} fresh */
  async function boot(fresh) {
    const { proc } = await startServer(port, dir, 'sample', { fresh, stdio: 'pipe', env: { ...process.env, BLOKO_NEW: '0' } });
    servers.push(proc);
    return { server: proc, room: await roomCode(base) };
  }

  const { server, room } = await boot(true);
  const { c: phone } = await player('phone', 'pierre', room, url);
  phone.send({ t: 'startMinigame' });
  await phone.waitFor((m) => m.t === 'view' && m.minigame?.status === 'lobby');

  const page = await fetch(`${base}/?reset=1`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<form method="post">/);
  assert.equal(await roomCode(base), room, 'showing the page changes nothing');

  const exited = once(server, 'exit');
  const reset = await fetch(`${base}/?reset=1`, { method: 'POST' });
  assert.equal(reset.status, 200);
  assert.match(await reset.text(), /url=\//);
  const [code] = await exited;
  assert.equal(code, 75, 'a failure exit: the hosted service restarts only after one');

  const restarted = await boot(false);
  assert.notEqual(restarted.room, room);
  const tv = await screen('tv', url);
  const view = tv.last();
  assert.equal(view.minigame, null);
  assert.deepEqual(view.campaign.party.order, []);
  phone.ws.close();
  tv.ws.close();
});
