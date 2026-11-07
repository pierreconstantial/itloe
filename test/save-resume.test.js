// A save whose minigame this release does not have stops the boot and is left untouched, and a save whose
// minigame it cannot resume keeps the evening with that minigame ended. Real server, scratch data.
// test/fixtures/save-v2-blocks.json is a save as the server wrote it before minigame lobbies, in a timed block game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, freePort, startServer, stop } from '../scripts/e2e-lib.mts';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'test', 'fixtures');

/**
 * A scratch data folder holding `save` as its saved evening, and the server started on it (or the error it
 * stopped at its boot with: its exit code and output).
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
  const started = await startServer(port, varDir, 'sample', { fresh: false, stdio: 'pipe',
    env: { ...process.env, BLOKO_BIND: '127.0.0.1', BLOKO_QUIZ_DIR: quizDir, BLOKO_NEW: '0' } }).catch((/** @type {Error} */ e) => e);
  t.after(async () => {
    if (!(started instanceof Error)) await stop(started.proc);
    await rm(dir, { recursive: true, force: true });
  });
  return { port, varDir, started };
}

/** The first message on a socket (the deploy check expects a view), as the server sends it. @param {number} port */
async function firstView(port) {
  const c = new Client('tv', `ws://127.0.0.1:${port}/ws`);
  await c.open();
  try {
    return await c.waitFor(() => true);
  } finally {
    c.ws.close();
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
    assert.ok(app.started instanceof Error, `${label}: the server must stop at boot`);
    assert.match(app.started.message, /exited \([1-9]\d*\) before answering/, label);
    assert.match(app.started.message, /"darts"/, `${label}: the error names the kind`);
    assert.equal(await readFile(join(app.varDir, 'bloko.state.json'), 'utf8'), text, `${label}: the save is untouched`);
    assert.deepEqual(await readdir(app.varDir), ['bloko.state.json'], `${label}: nothing quarantined or written next to it`);
  }
});

test('a save whose minigame this release cannot resume keeps the evening: the minigame ends, the party stays', { timeout: 20_000 }, async (t) => {
  const text = await fixture('save-v2-blocks.json'); // a round from before minigame lobbies: a fix deployed mid-round
  const saved = JSON.parse(text);
  const app = await boot(t, text);
  if (app.started instanceof Error) throw app.started;
  const view = await firstView(app.port);
  assert.equal(view.minigame, null, 'the minigame ended…');
  assert.equal(view.campaign.at.node, saved.campaign.at.node, '…in the room at its tableau');
  assert.deepEqual(view.campaign.party.order, saved.campaign.party.order, 'the same party');
  assert.equal((await (await fetch(`http://127.0.0.1:${app.port}/api/join`)).json()).code, saved.room, 'the same room code');
  assert.match(app.started.log(), /RESUMED .*its blocks could not be resumed, so it was ended/);
  assert.deepEqual(await readdir(app.varDir), ['bloko.state.json'], 'nothing quarantined');
});

test('a save with missing or removed characters starts fresh and keeps the old file', { timeout: 30_000 }, async (t) => {
  for (const file of ['save-v2-blocks.json']) {
    for (const character of [null, undefined, 'bowser']) {
      await t.test(`${file}: ${String(character)}`, async (t) => {
        const save = JSON.parse(await fixture(file));
        const players = save.campaign.party.players;
        players[Object.keys(players)[0]].character = character;
        const text = JSON.stringify(save);
        const app = await boot(t, text);
        if (app.started instanceof Error) throw app.started;
        const view = await firstView(app.port);
        assert.equal(view.minigame, null);
        assert.deepEqual(view.campaign.party.order, []);
        assert.match(app.started.log(), /save could not be loaded: party member .*not a character of the roster/);
        const kept = (await readdir(app.varDir)).filter((f) => f.startsWith('bloko.state.json.corrupt-'));
        assert.equal(kept.length, 1);
        assert.equal(await readFile(join(app.varDir, kept[0]), 'utf8'), text);
      });
    }
  }
});
