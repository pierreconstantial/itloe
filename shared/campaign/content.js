// Content helpers: validation (run at boot and by a test, so a content edit fails fast), door hit-testing and
// a node's room.

import { isCharacterId } from '../characters.js';
import { minigame } from '../minigames.js';
import { PARTY_ROOM } from '../scene.js';
import { hiddenProps } from './machines.js';

/** @typedef {import('./types.js').Condition} Condition */
/** @typedef {import('./types.js').Content} Content */
/** @typedef {import('./types.js').Node} Node */
/** @typedef {import('../scene.js').Scene} Scene */
/** @typedef {import('./types.js').Effect} Effect */
/** @typedef {import('./types.js').Facts} Facts */

const KINDS = new Set(['hub', 'world', 'tableau']);
/** A tableau's activity: a registered minigame, or a scene (a content kind without rules). @param {unknown} kind */
const isActivityKind = (kind) => kind === 'scene' || !!minigame(kind);

/** Children of a node, in content order. @param {Content} content @param {string} id @returns {Node[]} */
export function childrenOf(content, id) {
  return Object.values(content.nodes).filter((n) => n.parent === id);
}

/**
 * Item ids a condition refers to ({ has }), for validation.
 * @param {Condition} c
 * @returns {{ has: string, who?: string }[]}
 */
function hasOf(c) {
  if (!c || typeof c !== 'object') return [];
  if ('has' in c) return [c];
  if ('all' in c) return c.all.flatMap(hasOf);
  if ('any' in c) return c.any.flatMap(hasOf);
  if ('not' in c) return hasOf(c.not);
  return [];
}

const REWARD_TO = new Set(['chooser', 'winner', 'all']);

/**
 * Node ids a condition refers to (done / unlocked), for validation.
 * @param {Condition} c
 * @returns {string[]}
 */
function refsOf(c) {
  if (!c || typeof c !== 'object') return [];
  if ('done' in c) return [c.done];
  if ('unlocked' in c) return [c.unlocked];
  if ('all' in c) return c.all.flatMap(refsOf);
  if ('any' in c) return c.any.flatMap(refsOf);
  if ('not' in c) return refsOf(c.not);
  return [];
}

/** @param {unknown} c @returns {boolean} */
function isCondition(c) {
  if (!c || typeof c !== 'object') return false;
  const o = /** @type {Record<string, unknown>} */ (c);
  if ('always' in o) return o.always === true;
  if ('flag' in o) return typeof o.flag === 'string';
  if ('done' in o) return typeof o.done === 'string';
  if ('unlocked' in o) return typeof o.unlocked === 'string';
  if ('count' in o) return typeof o.count === 'string' && typeof o.gte === 'number';
  if ('has' in o) return typeof o.has === 'string' && (o.gte === undefined || (typeof o.gte === 'number' && o.gte >= 1))
    && (o.who === undefined || o.who === 'anyone' || isCharacterId(o.who));
  if ('machine' in o) return typeof o.machine === 'string' && Array.isArray(o.in) && o.in.every((x) => typeof x === 'string');
  if ('all' in o) return Array.isArray(o.all) && o.all.every(isCondition);
  if ('any' in o) return Array.isArray(o.any) && o.any.every(isCondition);
  if ('not' in o) return isCondition(o.not);
  return false;
}

/**
 * Every problem in a content graph, as readable lines (empty = valid).
 * @param {Content} content
 * @returns {string[]}
 */
export function validateContent(content) {
  /** @type {string[]} */
  const errors = [];
  const nodes = content?.nodes ?? {};
  const ids = Object.keys(nodes);
  if (!content || typeof content !== 'object' || !content.nodes) return ['content needs { start, chooser, gameMaster, nodes }'];
  if (!isCharacterId(content.chooser)) errors.push(`chooser "${content.chooser}" is not a character`);
  if (!isCharacterId(content.gameMaster)) errors.push(`game master "${content.gameMaster}" is not a character`);
  const start = nodes[content.start];
  if (!start) errors.push(`start "${content.start}" is not a node`);
  else if (!minigame(start.activity?.kind)) errors.push(`start "${content.start}" must be the tableau of a minigame`);
  // the item catalogue: only these can exist
  const items = content.items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) errors.push('content needs an item catalogue: items: { [id]: { id, name, icon, description } }');
  for (const [key, it] of Object.entries(items ?? {})) {
    if (!it || it.id !== key) errors.push(`item "${key}": id "${it?.id}" differs from its key`);
    for (const f of /** @type {const} */ (['name', 'icon', 'description'])) {
      if (typeof it?.[f] !== 'string' || !it[f].trim()) errors.push(`item "${key}": missing ${f}`);
    }
  }
  const knownItem = (/** @type {string} */ id) => !!items?.[id];
  const hubs = ids.filter((id) => nodes[id].parent === null);
  if (hubs.length !== 1) errors.push(`exactly one root (parent: null) expected, found ${hubs.length}: ${hubs.join(', ')}`);

  for (const [key, n] of Object.entries(nodes)) {
    const at = `node "${key}"`;
    if (n.id !== key) errors.push(`${at}: id "${n.id}" differs from its key (duplicate or copy-paste?)`);
    if (!KINDS.has(n.kind)) errors.push(`${at}: unknown kind "${n.kind}"`);
    if (n.parent === null && n.kind !== 'hub') errors.push(`${at}: the root must be the hub`);
    if (n.parent !== null && !nodes[n.parent]) errors.push(`${at}: unknown parent "${n.parent}"`);
    if (n.parent !== null && nodes[n.parent]?.kind === 'tableau') errors.push(`${at}: a tableau cannot have children`);
    if (n.kind === 'hub' && n.parent !== null) errors.push(`${at}: a hub must be the root`);
    if (n.activity && n.kind !== 'tableau') errors.push(`${at}: only tableaux have an activity`);
    if (n.kind === 'tableau' && !n.activity) errors.push(`${at}: a tableau needs an activity`);
    if (n.activity && !isActivityKind(n.activity.kind)) errors.push(`${at}: unknown activity "${n.activity.kind}"`);
    const rules = minigame(n.activity?.kind);
    const settings = /** @type {{ settings?: unknown } | undefined} */ (n.activity)?.settings;
    if (rules && settings !== undefined) for (const e of rules.validateSettings(settings)) errors.push(`${at}: ${e}`);
    const players = /** @type {{ eligible?: unknown, allReady?: unknown } | undefined} */ (n.activity);
    if (players?.eligible !== undefined && !(Array.isArray(players.eligible) && players.eligible.every(isCharacterId))) errors.push(`${at}: eligible must list characters`);
    if (players?.allReady !== undefined && players.allReady !== true) errors.push(`${at}: allReady can only be true`);
    if (!rules && (players?.eligible !== undefined || players?.allReady !== undefined)) errors.push(`${at}: only a minigame has eligible players`);
    if (typeof n.title !== 'string' || !n.title) errors.push(`${at}: missing title`);
    if (!isCondition(n.unlock)) errors.push(`${at}: invalid unlock condition`);
    if (n.complete !== undefined && !isCondition(n.complete)) errors.push(`${at}: invalid complete condition`);
    for (const ref of [...refsOf(n.unlock), ...refsOf(n.complete ?? { always: true })]) {
      if (!nodes[ref]) errors.push(`${at}: condition refers to unknown node "${ref}"`);
    }
    for (const h of [...hasOf(n.unlock), ...hasOf(n.complete ?? { always: true })]) {
      if (!knownItem(h.has)) errors.push(`${at}: condition needs unknown item "${h.has}" (not in the catalogue)`);
    }
    for (const e of n.rewards ?? []) {
      if ('item' in e) {
        if (!knownItem(e.item)) errors.push(`${at}: reward gives unknown item "${e.item}" (not in the catalogue)`);
        if (e.to !== undefined && !REWARD_TO.has(e.to) && !isCharacterId(e.to)) errors.push(`${at}: reward to "${e.to}" is not chooser | winner | all | a character`);
        if (e.count !== undefined && !(Number.isInteger(e.count) && e.count >= 1)) errors.push(`${at}: reward count must be a whole number ≥ 1`);
      }
      if ('unlock' in e && !nodes[e.unlock]) errors.push(`${at}: reward unlocks unknown node "${e.unlock}"`);
      if (!('unlock' in e) && !('item' in e) && !('flag' in e)) errors.push(`${at}: invalid reward ${JSON.stringify(e)}`);
    }
    if (n.room !== undefined && !Object.hasOwn(content.rooms ?? {}, n.room)) errors.push(`${at}: unknown room "${n.room}"`);
    if (n.enterWhen !== undefined && !isCondition(n.enterWhen)) errors.push(`${at}: invalid enterWhen condition`);
    if (n.startsOnEnter !== undefined && (n.startsOnEnter !== true || !rules)) errors.push(`${at}: only a minigame tableau starts on enter`);
    for (const h of n.hints ?? []) {
      if (typeof h?.text !== 'string' || (h.when !== undefined && !isCondition(h.when))) errors.push(`${at}: invalid hint ${JSON.stringify(h)}`);
    }
    if (n.back !== undefined && n.back !== false && typeof n.back !== 'string') errors.push(`${at}: back must be a label or false`);
    if (n.door) {
      const d = n.door;
      if (![d.x, d.y, d.w, d.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || d.w <= 0 || d.h <= 0) {
        errors.push(`${at}: invalid door ${JSON.stringify(d)}`);
      }
    }
  }

  for (const [id, r] of Object.entries(content.rooms ?? {})) if (r?.id !== id) errors.push(`room "${id}": id "${r?.id}" differs from its key`);
  for (const [room, list] of Object.entries(content.roomArt ?? {})) {
    if (!Object.hasOwn(content.rooms ?? {}, room) && room !== PARTY_ROOM.id) errors.push(`roomArt "${room}": unknown room`);
    for (const a of list) if (typeof a?.src !== 'string' || (a.when !== undefined && !isCondition(a.when))) errors.push(`roomArt "${room}": invalid entry`);
  }
  if (content.cast) {
    const { opening, introducedBy } = content.cast;
    if (!Array.isArray(opening) || !opening.every(isCharacterId)) errors.push('cast.opening must list characters');
    if (!introducedBy || typeof introducedBy !== 'object' || !Object.values(introducedBy).every((f) => typeof f === 'string')) errors.push('cast.introducedBy must map ids to flags');
  }
  if (content.leadAfter !== undefined && !isCondition(content.leadAfter)) errors.push('leadAfter: invalid condition');
  for (const id of content.gmPlaces ?? []) if (!nodes[id]) errors.push(`gmPlaces: unknown node "${id}"`);
  errors.push(...machineErrors(content, knownItem));
  // a machine condition naming a machine or state that doesn't exist would never hold, silently
  for (const [where, c] of allConditions(content)) {
    for (const m of machineConds(c)) {
      const states = content.machines?.[m.machine]?.states;
      if (!states) errors.push(`${where}: condition names unknown machine "${m.machine}"`);
      else for (const st of m.in) if (!Object.hasOwn(states, st)) errors.push(`${where}: condition names unknown state "${st}" of machine "${m.machine}"`);
    }
  }

  // cycles in parents (a node must reach the root)
  for (const id of ids) {
    const seen = new Set();
    let cur = /** @type {string | null} */ (id);
    while (cur !== null && nodes[cur]) {
      if (seen.has(cur)) { errors.push(`node "${id}": parent cycle through "${cur}"`); break; }
      seen.add(cur);
      cur = nodes[cur].parent;
    }
  }
  return errors;
}

const EFFECTS = ['flag', 'item', 'unlock', 'count', 'cutscene', 'goto', 'wisp', 'incarnate'];

/** The `{ machine, in }` conditions inside a condition, for validation. @param {Condition | undefined} c
 * @returns {{ machine: string, in: string[] }[]} */
function machineConds(c) {
  if (!c || typeof c !== 'object') return [];
  if ('machine' in c) return [c];
  if ('all' in c) return c.all.flatMap(machineConds);
  if ('any' in c) return c.any.flatMap(machineConds);
  if ('not' in c) return machineConds(c.not);
  return [];
}

/** Every condition of the content, with where it is, for the checks that span them all. @param {Content} content
 * @returns {[string, Condition][]} */
function allConditions(content) {
  /** @type {[string, Condition][]} */
  const out = [];
  for (const n of Object.values(content.nodes ?? {})) {
    for (const [k, c] of /** @type {[string, Condition | undefined][]} */ ([['unlock', n.unlock], ['complete', n.complete], ['enterWhen', n.enterWhen]])) if (c) out.push([`node "${n.id}" ${k}`, c]);
    for (const h of n.hints ?? []) if (h?.when) out.push([`node "${n.id}" hint`, h.when]);
  }
  if (content.leadAfter) out.push(['leadAfter', content.leadAfter]);
  for (const [room, list] of Object.entries(content.roomArt ?? {})) for (const a of list) if (a?.when) out.push([`roomArt "${room}"`, a.when]);
  for (const [id, m] of Object.entries(content.machines ?? {})) {
    for (const [sid, st] of Object.entries(m?.states ?? {})) {
      for (const w of st.when ?? []) out.push([`machine "${id}", state "${sid}", when`, w.if]);
      for (const o of Object.values(st.objects ?? {})) for (const a of o.actions ?? []) if (a.if) out.push([`machine "${id}", state "${sid}", action "${a.key}"`, a.if]);
    }
  }
  return out;
}

/**
 * Every problem in the content's machines: unknown states, nodes, items and props, invalid conditions and
 * effects, and a pickup its state never leaves (it could be picked up forever).
 * @param {Content} content @param {(id: string) => boolean} knownItem @returns {string[]}
 */
function machineErrors(content, knownItem) {
  /** @type {string[]} */
  const errors = [];
  const nodes = content.nodes;
  const props = new Set(Object.values(content.rooms ?? {}).flatMap((r) => r.props.map((p) => p.id)));
  /** @param {{ x?: unknown, y?: unknown, radius?: unknown }} p */
  const spot = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y) && Number.isFinite(p?.radius) && /** @type {number} */ (p.radius) > 0;
  // what can happen at all, so an event name nothing produces (a typo) is reported instead of never firing
  const states = Object.values(content.machines ?? {}).flatMap((m) => Object.values(m?.states ?? {}));
  const zoneIds = new Set(states.flatMap((st) => (st.zones ?? []).map((z) => z.id)));
  const pickupItems = new Set(states.flatMap((st) => (st.pickups ?? []).map((p) => p.item)));
  const allEffects = states.flatMap((st) => [...(st.enter ?? []), ...(st.after?.do ?? []), ...(st.when ?? []).flatMap((w) => w.do ?? []),
    ...Object.values(st.on ?? {}).flatMap((t) => (t && typeof t === 'object' ? t.do ?? [] : []))]);
  const cutscenes = new Set(allEffects.flatMap((e) => (e && typeof e === 'object' && 'cutscene' in e ? [e.cutscene] : [])));
  const actions = new Set(states.flatMap((st) => Object.entries(st.objects ?? {}).flatMap(([prop, o]) => (o?.actions ?? []).map((a) => `${a.key}:${prop}`))));
  /** Why an event key can never happen, or null. @param {string} event @returns {string | null} */
  const eventError = (event) => {
    const [kind, ...rest] = event.split(':');
    const target = rest.join(':');
    if (kind === 'entered') return nodes[target] ? null : `no node "${target}"`;
    if (kind === 'zone') return zoneIds.has(target) ? null : `no zone "${target}"`;
    if (kind === 'pickup') return pickupItems.has(target) ? null : `no pickup of "${target}"`;
    if (kind === 'cutscene') return cutscenes.has(target) ? null : `no cutscene "${target}" is ever played`;
    return actions.has(event) ? null : `no object action "${kind}" on "${target}"`;
  };
  for (const [id, m] of Object.entries(content.machines ?? {})) {
    const at = `machine "${id}"`;
    if (!m || typeof m.states !== 'object' || !Object.hasOwn(m.states, m.initial)) { errors.push(`${at}: initial state "${m?.initial}" is not one of its states`); continue; }
    const state = (/** @type {string} */ s) => Object.hasOwn(m.states, s);
    /** @param {string} where @param {Effect[] | undefined} list */
    const effects = (where, list) => {
      for (const e of list ?? []) {
        const kind = EFFECTS.find((k) => e && typeof e === 'object' && k in e);
        if (!kind) errors.push(`${where}: invalid effect ${JSON.stringify(e)}`);
        else if (['flag', 'unlock', 'cutscene', 'goto'].includes(kind) && typeof /** @type {any} */ (e)[kind] !== 'string') errors.push(`${where}: ${kind} needs a name, in ${JSON.stringify(e)}`);
        else if ('item' in e && !knownItem(e.item)) errors.push(`${where}: unknown item "${e.item}"`);
        else if ('item' in e && e.to !== undefined && e.to !== 'chooser' && e.to !== 'all' && !isCharacterId(e.to)) errors.push(`${where}: an item from a machine goes to chooser | all | a character ("winner" is for node rewards)`);
        else if ('item' in e && e.count !== undefined && !(Number.isInteger(e.count) && e.count >= 1)) errors.push(`${where}: item count must be a whole number ≥ 1`);
        else if (('goto' in e && !nodes[e.goto]) || ('unlock' in e && !nodes[e.unlock])) errors.push(`${where}: unknown node in ${JSON.stringify(e)}`);
        else if ('wisp' in e && e.wisp !== 'others' && !isCharacterId(e.wisp)) errors.push(`${where}: wisp names "others" or a character`);
        else if ('incarnate' in e && !isCharacterId(e.incarnate)) errors.push(`${where}: incarnate names a character`);
        // `count` alone moves a counter; next to `item` it is how many items (checked above)
        else if ('count' in e && !('item' in e) && (typeof e.count !== 'string'
          || ![e.by, e.set].every((n) => n === undefined || Number.isFinite(n)))) errors.push(`${where}: count needs a counter name, and by / set numbers`);
      }
    };
    if (m.states[m.initial].after) errors.push(`${at}: its initial state "${m.initial}" cannot have after (the evening starts in it, at no time)`);
    for (const [sid, s] of Object.entries(m.states)) {
      const where = `${at}, state "${sid}"`;
      for (const [event, t] of Object.entries(s.on ?? {})) {
        const to = typeof t === 'string' ? t : t && typeof t === 'object' ? t.to : undefined;
        if (!state(/** @type {string} */ (to))) errors.push(`${where}: event "${event}" goes to unknown state "${to}"`);
        if (t && typeof t === 'object') effects(`${where}, event "${event}"`, t.do);
        const why = eventError(event);
        if (why) errors.push(`${where}: event "${event}" can never happen: ${why}`);
      }
      for (const w of s.when ?? []) {
        if (!isCondition(w.if)) errors.push(`${where}: invalid when condition`);
        if (!state(w.to)) errors.push(`${where}: when goes to unknown state "${w.to}"`);
        effects(`${where}, when`, w.do);
      }
      if (s.after) {
        if (!(Number.isFinite(s.after.ms) && s.after.ms > 0)) errors.push(`${where}: after needs ms > 0`);
        if (!state(s.after.to)) errors.push(`${where}: after goes to unknown state "${s.after.to}"`);
        effects(`${where}, after`, s.after.do);
      }
      effects(`${where}, enter`, s.enter);
      for (const node of [...Object.keys(s.hints ?? {}), ...(s.holdChooser ? [s.holdChooser] : [])]) {
        if (!nodes[node]) errors.push(`${where}: unknown node "${node}"`);
      }
      for (const p of s.pickups ?? []) {
        if (!spot(p)) errors.push(`${where}: pickup of "${p.item}" needs numbers x, y and radius > 0`);
        if (!knownItem(p.item)) errors.push(`${where}: pickup of unknown item "${p.item}"`);
        if (!nodes[p.node]) errors.push(`${where}: pickup at unknown node "${p.node}"`);
        if (!s.on?.[`pickup:${p.item}`]) errors.push(`${where}: picking up "${p.item}" must leave the state (on "pickup:${p.item}")`);
      }
      for (const z of s.zones ?? []) {
        if (!nodes[z.node]) errors.push(`${where}: zone "${z.id}" at unknown node "${z.node}"`);
        if (!spot(z)) errors.push(`${where}: zone "${z.id}" needs numbers x, y and radius > 0`);
        if (z.arrive !== undefined && !(Number.isFinite(z.arrive?.x) && Number.isFinite(z.arrive?.y))) errors.push(`${where}: zone "${z.id}": arrive needs numbers x and y`);
      }
      for (const ch of Object.keys(s.speech ?? {})) if (!isCharacterId(ch)) errors.push(`${where}: speech by "${ch}", not a character`);
      for (const prop of [...Object.keys(s.objects ?? {}), ...Object.keys(s.npcs ?? {}), ...(s.hide ?? [])]) {
        if (!props.has(prop)) errors.push(`${where}: unknown prop "${prop}"`);
      }
      for (const [prop, o] of Object.entries(s.objects ?? {})) {
        for (const a of o.actions ?? []) {
          if (typeof a.key !== 'string' || typeof a.text !== 'string') errors.push(`${where}: object "${prop}" has an action without key or text`);
          if (a.if !== undefined && !isCondition(a.if)) errors.push(`${where}: object "${prop}" action "${a.key}": invalid if`);
          if (a.by !== undefined && a.by !== 'chooser' && a.by !== 'anyone' && !isCharacterId(a.by)) errors.push(`${where}: object "${prop}" action "${a.key}": invalid by`);
        }
      }
      if (s.offer && !(nodes[s.offer.node] && typeof s.offer.text === 'string' && typeof s.offer.accept === 'string')) errors.push(`${where}: invalid offer`);
    }
  }
  return errors;
}

/**
 * The child of `nodeId` whose door contains (x, y), or null. Doors are on the parent's map, in
 * world units. Does not look at unlocks: `enter` refuses a locked node.
 * @param {Content} content
 * @param {string} nodeId
 * @param {number} x
 * @param {number} y
 * @returns {string | null}
 */
export function zoneAt(content, nodeId, x, y) {
  for (const n of childrenOf(content, nodeId)) {
    const d = n.door;
    if (d && x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) return n.id;
  }
  return null;
}

/**
 * The room at a node, as the content declares it: the node's own (`room`, in content.rooms), else the party room.
 * @param {Content} content
 * @param {string | null | undefined} nodeId
 * @returns {Scene}
 */
export function roomAt(content, nodeId) {
  const room = nodeId ? content.nodes[nodeId]?.room : undefined;
  return room && Object.hasOwn(content.rooms ?? {}, room) ? /** @type {Scene} */ (content.rooms?.[room]) : PARTY_ROOM;
}

/** @type {WeakMap<Scene, Map<string, Scene>>} */
const withoutCache = new WeakMap();

/**
 * The room at a node now: what the TV draws there, and what avatars walk in and use objects of, without the
 * props the story's machines hide (hiddenProps). The same object while the same props are hidden, so caches
 * keyed by the scene keep working. The server, the phone and the TV all choose it here.
 * @param {Content} content @param {Facts} facts @param {string | null | undefined} nodeId @returns {Scene}
 */
export function sceneAt(content, facts, nodeId) {
  const base = roomAt(content, nodeId);
  const hidden = hiddenProps(facts, content);
  const gone = base.props.filter((p) => hidden.has(p.id)).map((p) => p.id);
  if (!gone.length) return base;
  const key = gone.join(',');
  let byKey = withoutCache.get(base);
  if (!byKey) { byKey = new Map(); withoutCache.set(base, byKey); }
  let scene = byKey.get(key);
  if (!scene) {
    scene = { ...base, props: base.props.filter((p) => !hidden.has(p.id)) };
    byKey.set(key, scene);
  }
  return scene;
}
