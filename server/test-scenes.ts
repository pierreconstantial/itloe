// Local scratch-server shortcuts for reviewing a story scene without playing its opening.
// These use the campaign reducer, so the resulting room, inventory and statuses are ordinary game state.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { CHARACTERS, isCharacterId } from '../shared/characters.js';
import { reduceCampaign, type Campaign, type Content } from './campaign.ts';

export const TEST_SCENE_ROOT = '/test/young-adult/tram-5/';
export const TEST_HUB_ROOT = '/test/hub/';
type Scene = 'tram-5' | 'hub';
type Character = keyof typeof CHARACTERS;
type Preset = 'base' | 'night';
type Item = { character: Character, item: string, count: number };
type Status = { character: Character, status: string };
export type SceneSetup = { scene: Scene, preset: Preset, context: Preset, characters: Character[], inventory: Item[], flags: string[], statuses: Status[] };

/** These shortcuts can only change a loopback server with a scratch save, never the hosted game or port 3131. */
export function testScenesEnabled(port: number, bind: string | undefined, varDir: string | undefined, publicOrigin: string | null): boolean {
  return port !== 3131 && bind === '127.0.0.1' && !!varDir && resolve(varDir).startsWith('/tmp/') && !publicOrigin;
}

const entries = (value: string | null): string[] => value ? value.split(',').map((x) => x.trim()) : [];
const character = (value: string): Character => {
  if (!isCharacterId(value)) throw new Error(`Unknown character: ${value}`);
  return value;
};

/** Null means the URL is outside this test area; an index describes its available presets. Bad parameters throw. */
export function parseTestScene(url: URL, content: Content): SceneSetup | { index: Scene } | null {
  if (url.pathname === TEST_SCENE_ROOT || url.pathname === TEST_SCENE_ROOT.slice(0, -1)) return { index: 'tram-5' };
  if (url.pathname === TEST_HUB_ROOT || url.pathname === TEST_HUB_ROOT.slice(0, -1)) return { index: 'hub' };
  const tram = /^\/test\/young-adult\/tram-5\/(base|night)\/?$/.exec(url.pathname);
  const hub = /^\/test\/hub\/(base)\/?$/.exec(url.pathname);
  if (!tram && !hub) return null;
  const scene: Scene = tram ? 'tram-5' : 'hub';
  for (const key of url.searchParams.keys()) {
    if (!['characters', 'inventory', 'flags', 'statuses', 'context'].includes(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error(`Unknown or repeated parameter: ${key}`);
    }
  }
  const preset = (tram ?? hub)![1] as Preset;
  const requestedContext = url.searchParams.get('context') ?? preset;
  if (requestedContext !== 'base' && requestedContext !== 'night') throw new Error('context must be base or night');
  if (scene === 'hub' && requestedContext === 'night') throw new Error('the hub has no night context');
  const context: Preset = requestedContext;
  const characters = entries(url.searchParams.get('characters') ?? (scene === 'hub' ? 'elodie,pierre,sol,anna' : 'elodie,pierre')).map(character);
  if (!characters.length || characters.length > 4 || new Set(characters).size !== characters.length) {
    throw new Error('characters must list 1–4 distinct characters');
  }
  const inventory = entries(url.searchParams.get('inventory')).map((entry): Item => {
    const [who, item, amount, extra] = entry.split(':');
    const count = amount === undefined ? 1 : Number(amount);
    if (extra !== undefined || !content.items[item] || !Number.isInteger(count) || count < 1 || count > 99) {
      throw new Error(`Invalid inventory entry: ${entry}`);
    }
    return { character: character(who), item, count };
  });
  const flags = entries(url.searchParams.get('flags'));
  for (const flag of flags) if (!/^[a-z][a-z0-9.-]{0,63}$/.test(flag)) throw new Error(`Invalid flag: ${flag}`);
  const statuses = entries(url.searchParams.get('statuses')).map((entry): Status => {
    const [who, status, extra] = entry.split(':');
    if (extra !== undefined || !/^[a-z][a-z0-9-]{0,63}$/.test(status) || status === 'incarnating') {
      throw new Error(`Invalid status entry: ${entry}`);
    }
    const id = character(who);
    if (!characters.includes(id)) throw new Error(`Status character is not in characters: ${who}`);
    return { character: id, status };
  });
  return { scene, preset, context, characters, inventory, flags, statuses };
}

/** Build one known scene through the same reducer actions as ordinary play and game-master setup. */
export function makeTestScene(initial: Campaign, content: Content, setup: SceneSetup): { campaign: Campaign, ids: Record<string, string> } {
  const gm = `test-${randomUUID()}`;
  const ids: Record<string, string> = {};
  let campaign = reduceCampaign(initial, { t: 'join', id: gm, character: 'pierre' }, content);
  if (setup.characters.includes('pierre')) ids.pierre = gm;
  for (const who of setup.characters) {
    if (who === 'pierre') continue;
    const id = `test-${randomUUID()}`;
    ids[who] = id;
    campaign = reduceCampaign(campaign, { t: 'join', id, character: who }, content);
  }
  const gmOp = (op: import('../shared/campaign/types.js').GmOp) => {
    const next = reduceCampaign(campaign, { t: 'gm', id: gm, op }, content);
    if (next === campaign) throw new Error(`Test scene setup refused ${JSON.stringify(op)}`);
    campaign = next;
  };
  if (setup.scene === 'tram-5') gmOp({ op: 'unlock', node: 'young-adult' });
  gmOp({ op: 'goto', node: setup.scene === 'tram-5' ? 'young-adult/tram-5' : 'hub' });
  if (setup.scene === 'tram-5' && setup.characters.includes('pierre') && !setup.statuses.some(({ character }) => character === 'pierre')) {
    campaign = reduceCampaign(campaign, { t: 'status', id: gm, status: 'wisp', on: true }, content);
  }
  if (setup.context === 'night') {
    gmOp({ op: 'setFlag', flag: 'young-adult.shelter.open', on: true });
    gmOp({ op: 'give', item: 'shelter-ticket', to: 'elodie', count: 1 });
  }
  for (const flag of setup.flags) {
    if (campaign.facts.flags.includes(flag)) continue;
    gmOp({ op: 'setFlag', flag, on: true });
  }
  for (const { character, item, count } of setup.inventory) gmOp({ op: 'give', item, to: character, count });
  for (const { character, status } of setup.statuses) {
    const id = ids[character];
    if (status === 'normal') {
      campaign = reduceCampaign(campaign, { t: 'status', id, status: 'wisp', on: false }, content);
      campaign = reduceCampaign(campaign, { t: 'incarnate', id }, content);
    } else {
      campaign = reduceCampaign(campaign, { t: 'status', id, status, on: true }, content);
    }
  }
  if (!setup.characters.includes('pierre')) campaign = reduceCampaign(campaign, { t: 'leave', id: gm }, content);
  campaign = reduceCampaign(campaign, { t: 'ack', id: 'screen', upTo: campaign.newsSeq }, content);
  return { campaign, ids };
}

export function testSceneIndex(scene: Scene): string {
  const hub = scene === 'hub';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${hub ? 'Hub' : 'Tram 5'} test scenes</title>
<style>body{font:18px/1.5 system-ui;max-width:44rem;margin:3rem auto;padding:0 1rem;background:#17171c;color:#eee}a{color:#ffd166}li{margin:1rem 0}code{color:#b6d9ff}</style>
<h1>${hub ? 'Hub' : 'Tram 5'} test scenes</h1><p>Each link starts a fresh scratch scene and opens the simulator.</p>
${hub ? `<ul><li><a href="${TEST_HUB_ROOT}base">Base · Élodie’s dream apartment</a><br>Élodie, Pierre, Sol and Anna are present.</li></ul>`
    : `<ul><li><a href="${TEST_SCENE_ROOT}base">Base · Wallensteinplatz</a><br>The Shelter is closed. Élodie can speak to Tschick-Toni beside the automat; Pierre is the game master in wisp mode.</li>
<li><a href="${TEST_SCENE_ROOT}night">Night · The Shelter is open</a><br>Élodie has a Shelter ticket in her bag.</li></ul>`}
<p>Optional overrides: <code>characters=elodie,pierre</code>, <code>inventory=elodie:shelter-ticket:1</code>,
<code>flags=young-adult.shelter.open</code>, <code>statuses=pierre:wisp</code>, <code>context=base|night</code>.</p></html>`;
}

/** Seed simulator slots before opening /sim/, so the prepared characters appear without picker taps. */
export function testScenePage(setup: SceneSetup, ids: Record<string, string>, room: string): string {
  const slots = setup.characters.map((character) => ({ character, id: ids[character] }));
  const title = setup.scene === 'hub' ? 'the hub' : 'Tram 5';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Opening ${title}…</title>
<p>Opening <a href="/sim/">${title} in the simulator</a>…</p>
<script>
const slots = ${JSON.stringify(slots)};
const room = ${JSON.stringify(room)};
for (let i = 1; i <= 4; i++) {
  const slot = slots[i - 1];
  for (const [key, value] of [['bloko-id' + i, slot?.id ?? ''], ['bloko-character' + i, slot?.character ?? ''], ['bloko-room' + i, room]]) {
    try { localStorage.setItem(key, value); } catch { /* the phone can read its cookie */ }
    try { document.cookie = key + '=' + encodeURIComponent(value) + '; max-age=2592000; path=/; SameSite=Lax'; } catch { /* storage may be blocked */ }
  }
}
location.replace('/sim/');
</script></html>`;
}
