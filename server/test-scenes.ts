// Local scratch-server shortcuts for reviewing a story moment: the story is played up to it through the campaign
// reducer, so the resulting room, machines, inventory and statuses are those of a real evening.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { CHARACTERS, isCharacterId } from '../shared/characters.js';
import { reduceCampaign, type Campaign, type Content } from './campaign.ts';
import type { GmOp } from '../shared/campaign/types.js';

export const TEST_ROOT = '/test/';
type Character = keyof typeof CHARACTERS;
type Item = { character: Character, item: string, count: number };
type Status = { character: Character, status: string };
/** A key moment of the story, at `/test/<path>`: the story played up to the end of beat `upTo`. */
type Preset = { path: string, title: string, about: string, upTo: Beat, characters?: Character[] };
export type SceneSetup = { preset: Preset, characters: Character[], inventory: Item[], flags: string[], statuses: Status[] };

const TRAM_5 = 'young-adult/tram-5';
const FLAT = 'young-adult/appart-elo-1';
const SHELTER = 'young-adult/shelter';
const MAROKKANERGASSE = 'young-adult/appart-pierre';
/** The four who play the opening. */
const MAIN: Character[] = ['elodie', 'pierre', 'sol', 'anna'];
/** Every scene's phones by default: the four, and Konz connected too. */
const DEFAULT_CHARACTERS: Character[] = [...MAIN, 'konz'];
const charactersOf = (preset: Preset): Character[] => preset.characters ?? DEFAULT_CHARACTERS;

/** The tree's groups, in story order: a path and its title. */
const GROUPS: [string, string][] = [
  ['hub', 'Hub'],
  ['young-adult', 'Young Adult'],
  [TRAM_5, 'Tram 5 · Wallensteinplatz'],
  [FLAT, 'Élodie’s flat'],
  [SHELTER, 'The Shelter'],
  [MAROKKANERGASSE, 'Marokkanergasse'],
];

/** A step of the story as players play it: who does it, and the action without its id. A refused step fails the scene. */
type Play = { by: Character, step: Record<string, unknown> };
const by = (who: Character, step: Record<string, unknown>): Play => ({ by: who, step });
const finished = (node: string): Play => by('pierre', { t: 'gm', op: { op: 'count', counter: `node.${node}.finished`, set: 1 } });
/** The painted tram: Élodie rides, the quiz is played (the game master ends it), she chooses where it goes. */
const ride = (to: string): Play[] => [
  by('elodie', { t: 'use', object: 'tram-5-tram', action: 'ride' }),
  by('elodie', { t: 'enter', node: `${TRAM_5}/quiz` }),
  by('pierre', { t: 'endMinigame' }),
  by('elodie', { t: 'choose', option: to }),
];

/** The story, beat by beat, in order: each preset plays every beat up to its own. */
const BEATS = {
  // the block game, the portal, the apparition (the others become wisps), the first key
  opening: [
    by('pierre', { t: 'startMinigame' }),
    ...MAIN.map((who) => by(who, { t: 'activity', action: { t: 'ready', id: who, on: true } })),
    by('pierre', { t: 'activity', action: { t: 'start', id: 'pierre' } }),
    by('pierre', { t: 'activity', action: { t: 'endGame', id: 'pierre' } }),
    by('pierre', { t: 'activity', action: { t: 'lobby', id: 'pierre' } }),
    by('pierre', { t: 'endMinigame' }),
    by('elodie', { t: 'zone', zone: 'portal' }),
    by('elodie', { t: 'ack-cutscene' }),
    by('elodie', { t: 'pickup', item: 'memory-key-intro' }),
  ],
  'tram-day': [by('elodie', { t: 'enter', node: 'young-adult' }), by('elodie', { t: 'enter', node: TRAM_5 })],
  'flat-dark': ride('flat'),
  // the lamp, an hour of Columbo and two of reading: Pierre arrives and becomes himself
  'flat-pierre': [
    by('elodie', { t: 'use', object: 'appart-elo-1-lamp', action: 'switch' }),
    by('elodie', { t: 'use', object: 'appart-elo-1-tv', action: 'columbo' }),
    by('elodie', { t: 'use', object: 'appart-elo-1-books', action: 'read' }),
    by('pierre', { t: 'incarnate' }),
  ],
  // backgammon (Pierre a wisp again), the beers and cigarettes, Toni and his crowbar, back home for the ticket
  'tram-night': [
    by('elodie', { t: 'use', character: 'pierre', action: 'talk' }),
    by('elodie', { t: 'enter', node: `${FLAT}/backgammon` }),
    by('pierre', { t: 'endMinigame' }),
    finished(`${FLAT}/backgammon`),
    by('elodie', { t: 'pickup', item: 'cigarette-pack' }),
    by('elodie', { t: 'pickup', item: 'beers' }),
    by('elodie', { t: 'zone', zone: 'flat-exit' }),
    by('elodie', { t: 'use', object: 'tram-5-weird-man', action: 'give' }),
    by('elodie', { t: 'tick', after: 3000 }),
    by('elodie', { t: 'pickup', item: 'crowbar' }),
    ...ride('flat'),
    by('elodie', { t: 'use', object: 'appart-elo-1-floorboard', action: 'lift' }),
    by('elodie', { t: 'zone', zone: 'flat-exit' }),
  ],
  // in through its entrance: Pierre becomes himself and waits
  shelter: [by('elodie', { t: 'zone', zone: 'shelter-entrance' }), by('pierre', { t: 'incarnate' })],
  // Élodie gives Pierre a beer (holding the beers, her action on him), he offers table football, it is played
  'after-match': [
    by('elodie', { t: 'use', character: 'pierre', action: 'give-beer' }),
    by('elodie', { t: 'enter', node: `${SHELTER}/foosball` }),
    by('pierre', { t: 'endMinigame' }),
    finished(`${SHELTER}/foosball`),
  ],
  // the kiss, up the stair, the tram to Marokkanergasse
  marokkanergasse: [
    by('elodie', { t: 'use', character: 'pierre', action: 'kiss' }),
    by('elodie', { t: 'zone', zone: 'shelter-exit' }),
    ...ride('marokkanergasse'),
  ],
} satisfies Record<string, Play[]>;
type Beat = keyof typeof BEATS;

/** The presets, in story order. */
const PRESETS: Preset[] = [
  { path: 'hub/base', title: 'Élodie’s dream apartment', about: 'Just after the opening: Élodie has the first key; Pierre, Sol and Anna are wisps.', upTo: 'opening' },
  { path: `${TRAM_5}/base`, title: 'Day · the Shelter closed', about: 'Élodie has walked to Tram 5; Tschick-Toni waits beside the automat.', upTo: 'tram-day' },
  { path: `${FLAT}/arrived`, title: 'First visit, in the dark', about: 'After the first tram quiz: the lamp is off, Pierre has not come yet.', upTo: 'flat-dark' },
  { path: `${FLAT}/pierre`, title: 'Pierre arrives · backgammon', about: 'The lamp on, three hours later: Pierre is himself and waits for Élodie to talk to him, then offers backgammon.', upTo: 'flat-pierre' },
  { path: `${TRAM_5}/night`, title: 'Night · the Shelter open', about: 'After backgammon, Toni and the floorboard: Élodie holds the beers, the cigarettes, the crowbar and the ticket; Pierre is a wisp again.', upTo: 'tram-night' },
  { path: `${SHELTER}/arrived`, title: 'Just walked in · table football', about: 'Through its entrance at night: Pierre is himself and waits for Élodie to come to him (holding the beers, she gives him one first), then offers table football.', upTo: 'shelter' },
  { path: `${SHELTER}/after-match`, title: 'After the match · the kiss', about: 'Back in the bar after table football: Élodie can kiss Pierre.', upTo: 'after-match' },
  { path: `${MAROKKANERGASSE}/party`, title: 'The friends · Pyramide, with Nico', about: 'After the kiss and a last tram quiz: Johanna, Nico and Mathieu stand there, Nico’s player a wisp. Talking to one offers Pyramide.',
    upTo: 'marokkanergasse', characters: [...DEFAULT_CHARACTERS, 'nico'] },
  { path: `${MAROKKANERGASSE}/everyone`, title: 'The friends · Pyramide, everyone', about: 'The same, with every character connected: Nico, Mathieu and Johanna’s players wisps until Pyramide introduces them.',
    upTo: 'marokkanergasse', characters: [...DEFAULT_CHARACTERS, 'nico', 'mathieu', 'johanna'] },
];

/** These shortcuts can only change a loopback server with a scratch save, never the hosted game or port 3131. */
export function testScenesEnabled(port: number, bind: string | undefined, varDir: string | undefined, publicOrigin: string | null): boolean {
  return port !== 3131 && bind === '127.0.0.1' && !!varDir && resolve(varDir).startsWith('/tmp/') && !publicOrigin;
}

const entries = (value: string | null): string[] => value ? value.split(',').map((x) => x.trim()) : [];
const character = (value: string): Character => {
  if (!isCharacterId(value)) throw new Error(`Unknown character: ${value}`);
  return value;
};

/** Null means the URL is outside this test area; an index shows the tree under a path. Bad parameters throw. */
export function parseTestScene(url: URL, content: Content): SceneSetup | { index: string } | null {
  if (url.pathname !== '/test' && !url.pathname.startsWith(TEST_ROOT)) return null;
  const path = url.pathname.slice(TEST_ROOT.length).replace(/\/+$/, '');
  const preset = PRESETS.find((p) => p.path === path);
  if (!preset) return path === '' || GROUPS.some(([g]) => g === path) ? { index: path } : null;
  for (const key of url.searchParams.keys()) {
    if (!['characters', 'inventory', 'flags', 'statuses'].includes(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error(`Unknown or repeated parameter: ${key}`);
    }
  }
  const characters = url.searchParams.has('characters') ? entries(url.searchParams.get('characters')).map(character) : charactersOf(preset);
  if (!characters.length || new Set(characters).size !== characters.length) throw new Error('characters must list distinct characters');
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
  return { preset, characters, inventory, flags, statuses };
}

/** Build a scene by playing the story up to it, through the same reducer actions as ordinary play: the four play
 *  the opening; the others (Konz, the friends) join right after it, as wisps until the story introduces them;
 *  characters not asked for leave at the end. The game master's clock (Columbo, the books) and its timers run on
 *  the steps' own times. */
export function makeTestScene(initial: Campaign, content: Content, setup: SceneSetup): { campaign: Campaign, ids: Record<string, string> } {
  const ids: Record<string, string> = {};
  const idOf = (who: Character) => (ids[who] ??= `test-${randomUUID()}`);
  let campaign = initial;
  let now = 1000;
  const play = ({ by: who, step }: Play) => {
    now += step.t === 'tick' ? Number(step.after) : 1000;
    let action: Record<string, unknown> = { ...step, id: idOf(who), now };
    if (step.t === 'tick') action = { t: 'tick', now };
    // the TV has played the opening's cutscene
    if (step.t === 'ack-cutscene') action = { t: 'ack', id: 'screen', upTo: campaign.news.findLast((n) => n.t === 'cutscene')?.seq ?? 0, now };
    if (step.t === 'activity') action = { t: 'activity', id: idOf(who), action: { ...(step.action as object), id: idOf(who), now }, now };
    const next = reduceCampaign(campaign, action as Parameters<typeof reduceCampaign>[1], content);
    if (next === campaign) throw new Error(`Test scene: the story refused ${JSON.stringify(step)} by ${who}`);
    campaign = next;
  };
  for (const who of MAIN) play(by(who, { t: 'join', character: who }));
  const beats = Object.keys(BEATS) as Beat[];
  for (const beat of beats.slice(0, beats.indexOf(setup.preset.upTo) + 1)) {
    for (const step of BEATS[beat]) play(step);
    if (beat === 'opening') for (const who of setup.characters) if (!MAIN.includes(who)) play(by(who, { t: 'join', character: who }));
  }
  const gm = idOf(content.gameMaster);
  const gmOp = (op: GmOp) => {
    const next = reduceCampaign(campaign, { t: 'gm', id: gm, op }, content);
    if (next === campaign) throw new Error(`Test scene setup refused ${JSON.stringify(op)}`);
    campaign = next;
  };
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
  for (const who of MAIN) if (!setup.characters.includes(who)) campaign = reduceCampaign(campaign, { t: 'leave', id: ids[who] }, content);
  campaign = reduceCampaign(campaign, { t: 'ack', id: 'screen', upTo: campaign.newsSeq }, content);
  return { campaign, ids };
}

const escape = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const titleOf = (path: string): string => GROUPS.find(([g]) => g === path)?.[1] ?? 'Test scenes';
const parentOf = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

/** The tree under `path` ('' = everything): each group links to its own page, each scene starts directly. */
export function testSceneIndex(path: string): string {
  const branch = (parent: string): string => {
    const items = [
      ...PRESETS.filter((p) => parentOf(p.path) === parent).map((p) => `<li class="scene"><a href="${TEST_ROOT}${p.path}">${escape(p.title)}</a>
<br><span>${escape(p.about)}</span> <code>${TEST_ROOT}${p.path}</code></li>`),
      ...GROUPS.filter(([g]) => parentOf(g) === parent).map(([g, title]) => `<li><a class="group" href="${TEST_ROOT}${g}/">${escape(title)}</a>${branch(g)}</li>`),
    ];
    return items.length ? `<ul>${items.join('')}</ul>` : '';
  };
  // breadcrumb: Test scenes › Young Adult › The Shelter
  const parts = path ? path.split('/') : [];
  const crumbs = [path ? `<a href="${TEST_ROOT}">Test scenes</a>` : 'Test scenes', ...parts.map((_, i) => {
    const p = parts.slice(0, i + 1).join('/');
    return i === parts.length - 1 ? escape(titleOf(p)) : `<a href="${TEST_ROOT}${p}/">${escape(titleOf(p))}</a>`;
  })];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(titleOf(path))} · test scenes</title>
<style>body{font:17px/1.45 system-ui;max-width:50rem;margin:2.5rem auto;padding:0 1rem;background:#17171c;color:#eee}
a{color:#ffd166}.crumbs{color:#999}.group{font-weight:600;color:#9ecbff}ul{padding-left:1.3rem}li{margin:.45rem 0}
.scene span{color:#bbb}.scene code{font-size:12px;color:#7d8590}code{color:#b6d9ff}</style>
<p class="crumbs">${crumbs.join(' › ')}</p>
<h1>${escape(titleOf(path))}</h1><p>Each scene starts a fresh scratch evening there and opens the simulator.</p>
${branch(path)}
<p>Also: <a href="/sim/">simulator</a> · <a href="/screen/">TV</a> · <a href="/play/">phone</a> · <a href="/admin/">admin</a></p>
<p>Optional overrides: <code>characters=elodie,pierre</code>, <code>inventory=elodie:shelter-ticket:1</code>,
<code>flags=young-adult.shelter.open</code>, <code>statuses=pierre:wisp</code>. Every scene has Élodie, Pierre, Sol, Anna and Konz connected by default.</p></html>`;
}

/** Seed simulator slots before opening /sim/, so the prepared characters appear without picker taps. */
export function testScenePage(setup: SceneSetup, ids: Record<string, string>, room: string): string {
  const slots = setup.characters.map((character) => ({ character, id: ids[character] }));
  const title = escape(setup.preset.title);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Opening ${title}…</title>
<p>Opening <a href="/sim/">${title} in the simulator</a>…</p>
<script>
const slots = ${JSON.stringify(slots)};
const room = ${JSON.stringify(room)};
for (let i = 1; i <= Math.max(4, slots.length); i++) {
  const slot = slots[i - 1];
  for (const [key, value] of [['bloko-id' + i, slot?.id ?? ''], ['bloko-character' + i, slot?.character ?? ''], ['bloko-room' + i, room]]) {
    try { localStorage.setItem(key, value); } catch { /* the phone can read its cookie */ }
    try { document.cookie = key + '=' + encodeURIComponent(value) + '; max-age=2592000; path=/; SameSite=Lax'; } catch { /* storage may be blocked */ }
  }
}
location.replace(${JSON.stringify(slots.length > 4 ? `/sim/?phones=${slots.length}` : '/sim/')});
</script></html>`;
}
