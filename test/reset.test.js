// /?reset=1: a confirmation page, then a fresh evening saved and an exit; the restart loads it.
// Real server, scratch data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

test('/?reset=1 asks first, then saves a fresh evening and exits for the restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'itloe-reset-'));
  const port = await new Promise((resolve) => {
    const listener = createServer();
    listener.listen(0, '127.0.0.1', () => {
      const chosen = /** @type {import('node:net').AddressInfo} */ (listener.address()).port;
      listener.close(() => resolve(chosen));
    });
  });
  /** @type {import('node:child_process').ChildProcess[]} */ const servers = [];
  t.after(() => { for (const s of servers) s.kill(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  /** Starts the server (a fresh evening with --new, else the saved one) and resolves with its room code. */
  async function boot(/** @type {string[]} */ args) {
    const server = spawn(process.execPath, [new URL('../server/main.ts', import.meta.url).pathname, ...args], {
      env: { ...process.env, PORT: String(port), BLOKO_VAR: dir, BLOKO_HOST: '127.0.0.1', BLOKO_NEW: '0', ITLOE_CONTENT: 'sample' },
      stdio: 'ignore',
    });
    servers.push(server);
    for (let i = 0; i < 100; i++) {
      try { return { server, room: (await (await fetch(`${base}/api/join`)).json()).code }; }
      catch { await new Promise((r) => setTimeout(r, 30)); }
    }
    assert.fail('server did not start');
  }

  /** @param {string} role @param {string} [code] */
  async function connect(role, code) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    /** @type {any[]} */ const messages = [];
    ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.send(JSON.stringify({ t: 'hello', role, ...(code ? { room: code } : {}) }));
    return { ws, messages, send: (/** @type {object} */ m) => ws.send(JSON.stringify(m)) };
  }
  /** @param {{messages: any[]}} client @param {(m: any) => boolean} predicate */
  async function until(client, predicate) {
    for (let i = 0; i < 250; i++) {
      const found = client.messages.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail(`timed out; received ${client.messages.map((m) => m.t).join(', ')}`);
  }

  const { server, room } = await boot(['--new']);
  const phone = await connect('player', room);
  phone.send({ t: 'join', character: 'pierre' });
  await until(phone, (m) => m.t === 'welcome');
  phone.send({ t: 'start' });
  await until(phone, (m) => m.t === 'view' && m.round?.status === 'running');

  const page = await fetch(`${base}/?reset=1`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<form method="post">/);
  assert.equal((await (await fetch(`${base}/api/join`)).json()).code, room, 'showing the page changes nothing');

  const exited = once(server, 'exit');
  const reset = await fetch(`${base}/?reset=1`, { method: 'POST' });
  assert.equal(reset.status, 200);
  assert.match(await reset.text(), /url=\//);
  const [code] = await exited;
  assert.equal(code, 75, 'a failure exit: the hosted service restarts only after one');

  const restarted = await boot([]);
  assert.notEqual(restarted.room, room);
  const screen = await connect('screen');
  const view = await until(screen, (m) => m.t === 'view');
  assert.equal(view.round, null);
  assert.deepEqual(view.campaign.party.order, []);
  phone.ws.close();
  screen.ws.close();
});
