import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { newCampaign, reduceCampaign } from '../shared/campaign/index.js';
import { STORY_CONTENT } from '../shared/campaign/story/index.js';

test('a pending Wisp incarnation survives a server restart and finishes after its countdown', { timeout: 12_000 }, async (t) => {
  let campaign = newCampaign(STORY_CONTENT, 7);
  campaign = reduceCampaign(campaign, { t: 'join', id: 'elo', character: 'elodie' }, STORY_CONTENT);
  campaign = reduceCampaign(campaign, { t: 'join', id: 'pierre', character: 'pierre' }, STORY_CONTENT);
  campaign = reduceCampaign(campaign, { t: 'join', id: 'nico', character: 'nico' }, STORY_CONTENT);
  campaign = reduceCampaign(campaign, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'person.nico.unlocked', on: true } }, STORY_CONTENT);
  assert.deepEqual(campaign.party.players.nico.statuses, ['wisp', 'incarnating']);

  const dir = mkdtempSync(join(tmpdir(), 'itloe-incarnate-'));
  writeFileSync(join(dir, 'bloko.state.json'), JSON.stringify({ v: 2, campaign, room: 'WISP', savedAt: Date.now() }));
  const port = await new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const value = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      server.close(() => resolve(value));
    });
  });
  const child = spawn(process.execPath, [new URL('../server/main.ts', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), BLOKO_VAR: dir, BLOKO_BIND: '127.0.0.1', BLOKO_HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  /** @type {WebSocket | null} */ let ws = null;
  t.after(async () => {
    ws?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/api/join`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 30)); }
  }
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  /** @type {any[]} */ const messages = [];
  ws.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({ t: 'hello', role: 'screen' }));
  /** @param {(message: any) => boolean} predicate */
  const until = async (predicate) => {
    for (let i = 0; i < 500; i++) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('expected incarnation message');
  };
  const pending = await until((m) => m.t === 'view' && m.incarnations?.nico);
  assert.deepEqual(pending.campaign.party.players.nico.statuses, ['wisp', 'incarnating']);
  assert.ok(pending.incarnations.nico.at - pending.now > 2000);
  const active = await until((m) => m.t === 'view' && m.campaign?.party.players.nico.statuses.length === 0);
  assert.equal(active.incarnations.nico, undefined);
  const emote = await until((m) => m.t === 'emote' && m.playerId === 'nico');
  assert.ok(['victory', 'fart', 'annoy'].includes(emote.kind));
});
