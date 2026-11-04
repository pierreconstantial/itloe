import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { cleanSpeech, isEmote } from '../shared/social.js';
import { CHARACTERS } from '../shared/characters.js';

test('speech is short and printable; only known reactions are accepted', () => {
  assert.equal(cleanSpeech('  Hello\n room!  '), 'Hello room!');
  assert.equal(cleanSpeech(' '.repeat(10)), null);
  assert.equal(cleanSpeech('x'.repeat(101)), null);
  assert.equal(cleanSpeech('<script>'), '<script>'); // clients render this as text, never HTML
  assert.equal(isEmote('victory'), true);
  assert.equal(isEmote('dance'), false);
});

test('joined speech reaches the screen and a reconnecting phone gets history', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'itloe-social-'));
  const port = await new Promise((resolve) => {
    const listener = createServer();
    listener.listen(0, '127.0.0.1', () => {
      const chosen = /** @type {import('node:net').AddressInfo} */ (listener.address()).port;
      listener.close(() => resolve(chosen));
    });
  });
  const server = spawn(process.execPath, [new URL('../server/main.ts', import.meta.url).pathname, '--new'], {
    env: { ...process.env, PORT: String(port), BLOKO_VAR: dir, BLOKO_HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  /** @type {WebSocket[]} */
  const sockets = [];
  t.after(() => {
    for (const ws of sockets) ws.close();
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  let room;
  for (let i = 0; i < 100; i++) {
    try {
      room = (await (await fetch(`http://127.0.0.1:${port}/api/join`)).json()).code;
      break;
    } catch { await new Promise((r) => setTimeout(r, 30)); }
  }
  assert.ok(room, 'server started');

  /** @param {string} role @param {string | undefined} [code] */
  async function connect(role, code) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    /** @type {any[]} */
    const messages = [];
    ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.send(JSON.stringify({ t: 'hello', role, ...(code ? { room: code } : {}) }));
    return { ws, messages };
  }
  /** @param {{messages: any[]}} client @param {(message: any) => boolean} predicate */
  async function until(client, predicate) {
    for (let i = 0; i < 200; i++) {
      const found = client.messages.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail(`timed out; received ${client.messages.map((m) => m.t).join(', ')}`);
  }

  const screen = await connect('screen');
  const phone = await connect('player', room);
  phone.ws.send(JSON.stringify({ t: 'join', character: Object.keys(CHARACTERS)[0] }));
  const welcome = await until(phone, (m) => m.t === 'welcome');
  phone.ws.send(JSON.stringify({ t: 'say', text: 'Hello room!' }));
  const speech = await until(screen, (m) => m.t === 'say');
  assert.equal(speech.playerId, welcome.playerId);
  assert.equal(speech.text, 'Hello room!');

  const latePhone = await connect('player', room);
  const history = await until(latePhone, (m) => m.t === 'chatHistory' && m.messages.some((/** @type {any} */ item) => item.text === 'Hello room!'));
  assert.equal(history.messages.at(-1).playerId, welcome.playerId);

  await new Promise((r) => setTimeout(r, 700));
  phone.ws.send(JSON.stringify({ t: 'emote', kind: 'victory' }));
  const emote = await until(screen, (m) => m.t === 'emote');
  assert.equal(emote.kind, 'victory');

  phone.ws.send(JSON.stringify({ t: 'pos', x: 11.1, y: 7.7, dir: 'up', moving: false }));
  await until(screen, (m) => m.t === 'pos' && m.playerId === welcome.playerId);
  phone.ws.send(JSON.stringify({ t: 'interact', object: 'table' }));
  const interaction = await until(screen, (m) => m.t === 'interact');
  assert.equal(interaction.playerId, welcome.playerId);
  assert.equal(interaction.object, 'table');
});
