import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { makeAccess } from '../server/access.ts';
import { typedUrl } from '../public/screen/lobby-view.js';

const ROOT = process.env.ITLOE_TEST_ROOT ?? new URL('..', import.meta.url).pathname;
const ORIGIN = 'https://itloe.example.test';
const TOKEN = 'Tq7wZk';
const ADMIN = 'Ad3mN9';

/** @param {import('node:test').TestContext} t @param {Record<string, string>} [env] */
async function server(t, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'itloe-hosting-'));
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = /** @type {import('node:net').AddressInfo} */ (listener.address()).port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, [join(ROOT, 'server/main.ts')], {
    env: { ...process.env, PORT: String(port), BLOKO_BIND: '127.0.0.1', BLOKO_VAR: dir,
      BLOKO_PUBLIC_ORIGIN: ORIGIN, BLOKO_ACCESS_TOKEN: TOKEN, BLOKO_NEW: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (data) => { log += data; });
  child.stderr?.on('data', (data) => { log += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    await rm(dir, { recursive: true, force: true });
  });
  const http = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, log);
    try {
      await fetch(http, { signal: AbortSignal.timeout(200) });
      return { http, ws: `ws://127.0.0.1:${port}/ws`, dir, log: () => log, exited: () => child.exitCode !== null };
    } catch { await delay(30); }
  }
  throw new Error(`Server did not start: ${log}`);
}

/** @param {string} url @param {Record<string, string>} headers */
async function rejectedSocket(url, headers) {
  const socket = new WebSocket(url, { headers });
  socket.on('error', () => {});
  return await new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_req, res) => {
      const status = res.statusCode;
      res.resume();
      socket.terminate();
      resolve(status);
    });
    socket.once('open', () => { socket.terminate(); reject(new Error('Unauthorized socket opened')); });
    socket.once('error', reject);
  });
}

test('public settings fail closed; LAN play remains open', () => {
  assert.throws(() => makeAccess(ORIGIN), /requires/);
  assert.throws(() => makeAccess(undefined, TOKEN), /requires/);
  assert.throws(() => makeAccess(ORIGIN, 'short'), /requires/);
  for (const origin of ['http://example.test', ORIGIN + '/path', ORIGIN + '?token=oops', 'https://user:pass@example.test']) {
    assert.throws(() => makeAccess(origin, TOKEN), /HTTPS origin/);
  }
  assert.throws(() => makeAccess(ORIGIN, TOKEN, 'short'), /ADMIN_TOKEN/);
  assert.throws(() => makeAccess(ORIGIN, TOKEN, TOKEN), /ADMIN_TOKEN/);
  assert.equal(makeAccess().origin, null);
  assert.equal(makeAccess().joinUrl('ABCD', 'http://127.0.0.1:3131'), 'http://127.0.0.1:3131/play?room=ABCD');
});

test('public hosting gates HTTP and sockets, and invites a fresh browser', { timeout: 15_000 }, async (t) => {
  const app = await server(t);
  for (const path of ['/', '/screen/', '/play/', '/sim/', '/shared/game.js', '/commun/base.css', '/api/join', '/api/content', '/api/join-qr.svg']) {
    assert.equal((await fetch(app.http + path)).status, 401, path);
  }
  const bad = await fetch(app.http + '/?token=wrong', { redirect: 'manual' });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);

  const login = await fetch(app.http + '/play?room=ABCD&token=' + TOKEN, { redirect: 'manual' });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), ORIGIN + '/play?room=ABCD');
  assert.equal(login.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const setCookie = login.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.match(setCookie, /^__Host-itloe_access=[a-f0-9]{64}; Path=\/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax$/);
  assert.ok(!setCookie.includes(TOKEN));
  const cookie = setCookie.split(';')[0];
  const headers = { Cookie: cookie };
  const screen = await fetch(app.http + '/screen/', { headers });
  assert.equal(screen.status, 200);
  assert.equal(screen.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(app.http + '/api/content', { headers })).status, 200);
  const info = await (await fetch(app.http + '/api/join', { headers })).json();
  const invitation = new URL(info.url);
  assert.equal(invitation.origin, ORIGIN);
  assert.equal(invitation.searchParams.get('token'), TOKEN);
  assert.equal(invitation.searchParams.get('room'), info.code);
  assert.ok(typedUrl(info.url).includes('token=' + TOKEN), 'the displayed invitation also works without a cookie');
  assert.equal((await fetch(app.http + '/api/join-qr.svg', { headers })).status, 200);
  // Without an admin token, a public server lets nobody reset.
  assert.equal((await fetch(app.http + '/?reset=1', { method: 'POST', headers })).status, 401);
  // A new phone has no cookies: the invitation itself must authorize it.
  assert.equal((await fetch(app.http + invitation.pathname + invitation.search, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(app.http + '/api/join', { headers: { Cookie: cookie + 'x' } })).status, 401);
  assert.equal((await fetch(app.http + '/?token=wrong', { headers, redirect: 'manual' })).status, 401);
  assert.equal(await rejectedSocket(app.ws, { Origin: ORIGIN }), 401);
  assert.equal(await rejectedSocket(app.ws, headers), 401);
  assert.equal(await rejectedSocket(app.ws, { ...headers, Origin: 'https://other.example.test' }), 401);
  assert.equal(await rejectedSocket(app.ws + '?token=' + TOKEN, { Origin: ORIGIN }), 401);

  const socket = new WebSocket(app.ws, { headers: { ...headers, Origin: ORIGIN } });
  t.after(() => socket.terminate());
  const firstMessage = once(socket, 'message');
  await once(socket, 'open');
  const [message] = await firstMessage;
  assert.equal(JSON.parse(String(message)).t, 'view');
  // Public message limits reject oversized input without taking down the shared game.
  const closed = once(socket, 'close');
  socket.send('x'.repeat(17 * 1024));
  assert.equal((await closed)[0], 1009);
  assert.equal((await fetch(app.http + '/api/join', { headers })).status, 200);
  const saved = JSON.parse(await readFile(join(app.dir, 'bloko.state.json'), 'utf8'));
  assert.equal(saved.room, info.code);
  assert.ok(!app.log().includes(TOKEN), 'service logs must not expose the invitation');
});

test('invalid public configuration exits before creating saves', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'itloe-invalid-hosting-'));
  try {
    const child = spawn(process.execPath, [join(ROOT, 'server/main.ts')], {
      env: { ...process.env, BLOKO_VAR: dir, BLOKO_PUBLIC_ORIGIN: ORIGIN, BLOKO_ACCESS_TOKEN: '' },
      stdio: 'ignore',
    });
    const [code] = await once(child, 'exit');
    assert.notEqual(code, 0);
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the reset needs the admin token', { timeout: 15_000 }, async (t) => {
  const app = await server(t, { BLOKO_ADMIN_TOKEN: ADMIN });
  const login = await fetch(app.http + '/play?token=' + TOKEN, { redirect: 'manual' });
  const guest = { Cookie: String(login.headers.get('set-cookie')).split(';')[0] };

  // A guest with the invitation: no reset, also when posting the confirmation.
  assert.equal((await fetch(app.http + '/?reset=1', { headers: guest })).status, 401);
  assert.equal((await fetch(app.http + '/?reset=1', { method: 'POST', headers: guest })).status, 401);
  assert.equal((await fetch(app.http + '/admin/?admin=wrong1', { headers: guest, redirect: 'manual' })).status, 401);
  assert.ok(!app.exited(), 'a guest cannot reset the evening');

  // The admin token, once, gives the cookie; the page reloads without it.
  const admin = await fetch(app.http + '/admin/?admin=' + ADMIN, { headers: guest, redirect: 'manual' });
  assert.equal(admin.status, 302);
  assert.equal(admin.headers.get('location'), ORIGIN + '/admin/');
  const adminCookie = String(admin.headers.get('set-cookie'));
  assert.match(adminCookie, /^__Host-itloe_admin=[a-f0-9]{64}; Path=\/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax$/);
  const headers = { Cookie: `${guest.Cookie}; ${adminCookie.split(';')[0]}` };
  assert.equal((await fetch(app.http + '/?reset=1', { headers })).status, 200);
  assert.ok(!app.log().includes(ADMIN), 'service logs must not expose the admin token');
});
