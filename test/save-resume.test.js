// A save whose minigame this release does not have stops the boot and is left untouched, and a save it
// cannot resume starts a fresh evening and is quarantined. Real server, scratch data.
// test/fixtures/save-v2-blocks.json is a save as the server writes it, in a timed block game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'test', 'fixtures');

async function freePort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = /** @type {import('node:net').AddressInfo} */ (listener.address()).port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

/**
 * Starts the server on a scratch data folder holding `save` as its saved evening.
 * @param {import('node:test').TestContext} t @param {string} save the save file's text
 */
async function boot(t, save) {
  const dir = await mkdtemp(join(tmpdir(), 'itloe-save-'));
  const quizDir = join(dir, 'quiz');
  await mkdir(quizDir);
  await copyFile(join(ROOT, 'data', 'quiz', 'placeholder.json'), join(quizDir, 'placeholder.json'));
  const varDir = join(dir, 'var');
  await mkdir(varDir);
  await writeFile(join(varDir, 'bloko.state.json'), save);
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, 'server/main.ts')], {
    env: { ...process.env, PORT: String(port), BLOKO_BIND: '127.0.0.1', BLOKO_HOST: '127.0.0.1',
      BLOKO_VAR: varDir, BLOKO_QUIZ_DIR: quizDir, BLOKO_NEW: '0', ITLOE_CONTENT: 'sample' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (data) => { log += data; });
  child.stderr?.on('data', (data) => { log += data; });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  });
  return { port, varDir, exited, log: () => log, running: () => child.exitCode === null };
}

/** The first message on a socket (the deploy check expects a view), as the server sends it. */
async function firstView(/** @type {number} */ port, /** @type {() => boolean} */ running, /** @type {() => string} */ log) {
  for (let i = 0; ; i++) {
    assert.ok(running(), log());
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) });
      break;
    } catch {
      if (i > 200) throw new Error(`server did not start: ${log()}`);
      await delay(50);
    }
  }
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  try {
    const [message] = await once(socket, 'message');
    return JSON.parse(String(message));
  } finally {
    socket.terminate();
  }
}

const fixture = (/** @type {string} */ name) => readFile(join(FIXTURES, name), 'utf8');

/** Remaining time of a deadline, as the view tells it. @param {any} view @param {number} deadline */
const left = (view, deadline) => deadline - view.now;

test('a save with a minigame this release does not have stops the boot and is left byte-identical', { timeout: 20_000 }, async (t) => {
  const v2 = JSON.parse(await fixture('save-v2-blocks.json'));
  const stored = structuredClone(v2);
  stored.campaign.at.kind = 'darts';
  for (const [label, save] of [['stored kind', stored]]) {
    const text = JSON.stringify(save);
    const app = await boot(t, text);
    const timeout = new AbortController();
    const [code] = await Promise.race([app.exited, delay(10_000, [null], { signal: timeout.signal })])
      .finally(() => timeout.abort());
    assert.notEqual(code, null, `${label}: the server must stop at boot\n${app.log()}`);
    assert.notEqual(code, 0, label);
    assert.match(app.log(), /"darts"/, `${label}: the error names the kind`);
    assert.equal(await readFile(join(app.varDir, 'bloko.state.json'), 'utf8'), text, `${label}: the save is untouched`);
    assert.deepEqual(await readdir(app.varDir), ['bloko.state.json'], `${label}: nothing quarantined or written next to it`);
  }
});

test('a save holding a round in a lobby starts a fresh evening and is quarantined, not deleted', { timeout: 20_000 }, async (t) => {
  const v2 = JSON.parse(await fixture('save-v2-blocks.json'));
  v2.campaign.at.activity.phase = 'lobby';
  const text = JSON.stringify(v2);
  const app = await boot(t, text);
  const view = await firstView(app.port, app.running, app.log);
  assert.equal(view.round, null, 'a fresh evening: the room at the start, no round');
  assert.deepEqual(view.campaign.party.order, [], '…with nobody in it yet');
  assert.match(app.log(), /new evening \(save could not be loaded: the saved round is not one this release can resume/);
  const files = await readdir(app.varDir);
  const kept = files.filter((f) => f.startsWith('bloko.state.json.corrupt-'));
  assert.equal(kept.length, 1, `the old save is quarantined next to the new one (${files.join(', ')})`);
  assert.equal(await readFile(join(app.varDir, kept[0]), 'utf8'), text, 'byte-identical');
});

test('a save with missing or removed characters starts fresh and keeps the old file', { timeout: 30_000 }, async (t) => {
  for (const file of ['save-v2-blocks.json']) {
    for (const character of [null, undefined, 'konz']) {
      await t.test(`${file}: ${String(character)}`, async (t) => {
        const save = JSON.parse(await fixture(file));
        const players = save.campaign.party.players;
        players[Object.keys(players)[0]].character = character;
        const text = JSON.stringify(save);
        const app = await boot(t, text);
        const view = await firstView(app.port, app.running, app.log);
        assert.equal(view.round, null);
        assert.deepEqual(view.campaign.party.order, []);
        assert.match(app.log(), /save could not be loaded: party member .*not a character of the roster/);
        const kept = (await readdir(app.varDir)).filter((f) => f.startsWith('bloko.state.json.corrupt-'));
        assert.equal(kept.length, 1);
        assert.equal(await readFile(join(app.varDir, kept[0]), 'utf8'), text);
      });
    }
  }
});
