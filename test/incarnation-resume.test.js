import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newCampaign, reduceCampaign } from '../shared/campaign/index.js';
import { STORY_CONTENT } from '../shared/campaign/story/index.js';
import { freePort, screen, startServer, stop } from '../scripts/e2e-lib.mts';

test('a pending Wisp incarnation survives a server restart and finishes after its countdown', { timeout: 12_000 }, async (t) => {
  let campaign = newCampaign(STORY_CONTENT, 7);
  campaign = reduceCampaign(campaign, { t: 'join', id: 'elo', character: 'elodie' }, STORY_CONTENT);
  campaign = reduceCampaign(campaign, { t: 'join', id: 'pierre', character: 'pierre' }, STORY_CONTENT);
  campaign = reduceCampaign(campaign, { t: 'join', id: 'nico', character: 'nico' }, STORY_CONTENT);
  campaign = reduceCampaign(campaign, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'person.nico.unlocked', on: true } }, STORY_CONTENT);
  assert.deepEqual(campaign.party.players.nico.statuses, ['wisp', 'incarnating']);

  const dir = mkdtempSync(join(tmpdir(), 'itloe-incarnate-'));
  writeFileSync(join(dir, 'bloko.state.json'), JSON.stringify({ v: 2, campaign, room: 'WISP', savedAt: Date.now() }));
  const port = await freePort();
  const { proc } = await startServer(port, dir, '', { fresh: false, stdio: 'pipe', env: { ...process.env, BLOKO_BIND: '127.0.0.1' } })
    .catch((e) => { rmSync(dir, { recursive: true, force: true }); throw e; });
  t.after(async () => { await stop(proc); rmSync(dir, { recursive: true, force: true }); });
  const tv = await screen('tv', `ws://127.0.0.1:${port}/ws`);
  t.after(() => tv.ws.close());
  /** @param {(message: any) => boolean} predicate */
  const until = (predicate) => tv.waitFor(predicate, 0, 5000);
  const pending = await until((m) => m.t === 'view' && m.incarnations?.nico);
  assert.deepEqual(pending.campaign.party.players.nico.statuses, ['wisp', 'incarnating']);
  assert.ok(pending.incarnations.nico.at - pending.now > 2000);
  const active = await until((m) => m.t === 'view' && m.campaign?.party.players.nico.statuses.length === 0);
  assert.equal(active.incarnations.nico, undefined);
  const emote = await until((m) => m.t === 'emote' && m.playerId === 'nico');
  assert.ok(['victory', 'fart', 'annoy'].includes(emote.kind));
});
