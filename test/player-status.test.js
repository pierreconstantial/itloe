import test from 'node:test';
import assert from 'node:assert/strict';
import { gameMasterId, loadCampaign, newCampaign, reduceCampaign } from '../shared/campaign/index.js';
import { STORY_CONTENT } from '../shared/campaign/story.js';

/** @param {import('../shared/campaign/types.js').Campaign} campaign
 * @param {import('../shared/campaign/types.js').CampaignAction} action */
const act = (campaign, action) => reduceCampaign(campaign, action, STORY_CONTENT);

test('players keep several statuses across save/load; portal and later joins grant wisp', () => {
  let c = newCampaign(STORY_CONTENT, 3);
  c = act(c, { t: 'join', id: 'elo', character: 'elodie' });
  c = act(c, { t: 'join', id: 'sol', character: 'sol' });
  c = act(c, { t: 'join', id: 'pierre', character: 'pierre' });
  c = act(c, { t: 'status', id: 'sol', status: 'charged', on: true });
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'setFlag', flag: 'portal.ready', on: true } });
  c = act(c, { t: 'portal', id: 'elo' });
  assert.deepEqual(c.party.players.elo.statuses, []);
  assert.deepEqual(c.party.players.sol.statuses, ['charged', 'wisp']);
  c = act(c, { t: 'join', id: 'anna', character: 'anna' });
  assert.deepEqual(c.party.players.anna.statuses, ['wisp']);
  c = act(c, { t: 'status', id: 'sol', status: 'charged', on: false });
  assert.deepEqual(c.party.players.sol.statuses, ['wisp']);
  assert.deepEqual(loadCampaign(JSON.parse(JSON.stringify(c)), STORY_CONTENT).party, c.party);

  const noWisp = act(c, { t: 'status', id: 'sol', status: 'wisp', on: false });
  assert.deepEqual(loadCampaign(JSON.parse(JSON.stringify(noWisp)), STORY_CONTENT).party.players.sol.statuses, ['wisp', 'incarnating']);
  const cancelled = act(noWisp, { t: 'status', id: 'sol', status: 'wisp', on: true });
  assert.deepEqual(cancelled.party.players.sol.statuses, ['wisp']);
  assert.equal(act(cancelled, { t: 'incarnate', id: 'sol' }), cancelled, 'a cancelled countdown cannot incarnate');
  assert.equal(act(c, { t: 'status', id: 'sol', status: 'incarnating', on: true }), c, 'pending is engine-owned');
  const incarnated = act(noWisp, { t: 'incarnate', id: 'sol' });
  assert.deepEqual(incarnated.party.players.sol.statuses, []);

  const old = JSON.parse(JSON.stringify(c));
  delete old.party.players.sol.statuses;
  assert.throws(() => loadCampaign(old, STORY_CONTENT), /invalid statuses/);
});

test('the game master switches Wisp Mode during a round without putting the player back in it', () => {
  let c = newCampaign(STORY_CONTENT, 7);
  for (const character of ['pierre', 'elodie', 'sol', 'anna']) {
    c = act(c, { t: 'join', id: character, character: /** @type {import('../shared/characters.js').CharacterId} */ (character) });
  }
  c = act(c, { t: 'start', id: 'pierre', now: 1000 });
  assert.equal(c.at.activity?.players.sol.left, false);
  assert.equal(act(c, { t: 'gm', id: 'elodie', op: { op: 'wisp', character: 'sol', on: true } }), c);
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'wisp', character: 'sol', on: true } });
  assert.deepEqual(c.party.players.sol.statuses, ['wisp']);
  assert.equal(c.at.activity?.players.sol.left, true);
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'wisp', character: 'sol', on: false } });
  assert.deepEqual(c.party.players.sol.statuses, ['wisp', 'incarnating']);
  c = act(c, { t: 'incarnate', id: 'sol' });
  assert.deepEqual(c.party.players.sol.statuses, []);
  assert.equal(c.at.activity?.players.sol.left, true);
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'wisp', character: 'pierre', on: true } });
  assert.deepEqual(c.party.players.pierre.statuses, ['wisp']);
  assert.equal(gameMasterId(c.party, STORY_CONTENT), 'pierre', 'still the game master as a wisp');
  assert.equal(c.at.activity?.players.pierre.left, true);
  c = act(c, { t: 'gm', id: 'pierre', op: { op: 'wisp', character: 'pierre', on: false } });
  assert.deepEqual(c.party.players.pierre.statuses, ['wisp', 'incarnating']);
  assert.equal(act(c, { t: 'gm', id: 'pierre', op: { op: 'wisp', character: 'nico', on: true } }), c,
    'an unjoined character cannot be switched');
});
