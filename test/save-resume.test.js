// Saves written before the minigame kind was stored next to the round still resume, and a save whose
// minigame this release does not have stops the boot and is left untouched. Real server, scratch data.
// The fixtures in test/fixtures/ are saves as the server wrote them before the kind was stored.
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

test('a v1 save (bare block game) is migrated and resumes', { timeout: 20_000 }, async (t) => {
  const save = await fixture('save-v1.json');
  const app = await boot(t, save);
  const view = await firstView(app.port, app.running, app.log);
  const old = JSON.parse(save).state;
  assert.equal(view.t, 'view');
  assert.equal(view.round.kind, 'blocks');
  assert.equal(view.round.status, 'running');
  const s = view.round.view;
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.order, old.order);
  assert.equal(s.players['p-anna'].score, old.players['p-anna'].score);
  assert.equal(view.campaign.party.hostId, old.hostId);
  assert.ok(Math.abs(left(view, s.deadline) - 40_000) < 3000, `the timed game keeps its 40 s (${left(view, s.deadline)} ms)`);
  assert.match(app.log(), /MIGRATED a v1 save/);
  const saved = JSON.parse(await readFile(join(app.varDir, 'bloko.state.json'), 'utf8'));
  assert.equal(saved.v, 2);
  assert.equal(saved.room, 'KDZT');
  assert.equal(saved.campaign.at.kind, 'blocks');
});

test('a v2 save in a block game, from before the kind was stored, resumes as blocks', { timeout: 20_000 }, async (t) => {
  const save = await fixture('save-v2-blocks.json');
  const app = await boot(t, save);
  const view = await firstView(app.port, app.running, app.log);
  const old = JSON.parse(save).campaign.at.activity;
  assert.equal(view.round.kind, 'blocks');
  const s = view.round.view;
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.players['p-anna'].board, old.players['p-anna'].board);
  assert.ok(Math.abs(left(view, s.deadline) - 40_000) < 3000, `the timed game keeps its 40 s (${left(view, s.deadline)} ms)`);
  const saved = JSON.parse(await readFile(join(app.varDir, 'bloko.state.json'), 'utf8'));
  assert.equal(saved.room, 'KDZT');
  assert.equal(saved.campaign.at.kind, 'blocks');
});

test('a v2 save mid-question, from before the kind was stored, resumes as a quiz', { timeout: 20_000 }, async (t) => {
  const save = await fixture('save-v2-quiz.json');
  const app = await boot(t, save);
  const view = await firstView(app.port, app.running, app.log);
  assert.equal(view.round.kind, 'quiz');
  assert.equal(view.round.status, 'running');
  const q = view.round.view;
  assert.equal(q.phase, 'question');
  assert.equal(q.round.index, 1);
  assert.deepEqual(q.round.answered, ['p-bob']);
  assert.equal(q.round.answers, null, 'no answer on the wire before the reveal');
  assert.equal(view.campaign.at.activity, undefined, 'the campaign on the wire carries no raw round state');
  assert.ok(Math.abs(left(view, q.round.deadline) - 15_000) < 3000, `the question keeps its 15 s (${left(view, q.round.deadline)} ms)`);
  const saved = JSON.parse(await readFile(join(app.varDir, 'bloko.state.json'), 'utf8'));
  assert.equal(saved.campaign.at.kind, 'quiz');
});

test('a save with a minigame this release does not have stops the boot and is left byte-identical', { timeout: 20_000 }, async (t) => {
  const v2 = JSON.parse(await fixture('save-v2-blocks.json'));
  const stored = structuredClone(v2);
  stored.campaign.at.kind = 'darts';
  const derived = structuredClone(v2);
  derived.campaign.at.activity.kind = 'darts';
  for (const [label, save] of [['stored kind', stored], ['kind derived from the round', derived]]) {
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
