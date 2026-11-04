// Content helpers: validation (run by a test, so a content edit fails fast) and door hit-testing.

import { isCharacterId } from '../characters.js';

/** @typedef {import('./types.js').Condition} Condition */
/** @typedef {import('./types.js').Content} Content */
/** @typedef {import('./types.js').Node} Node */

const KINDS = new Set(['hub', 'world', 'tableau']);
const ACTIVITY_KINDS = new Set(['blocks', 'scene', 'quiz']);

/** Children of a node, in content order. @param {Content} content @param {string} id @returns {Node[]} */
export function childrenOf(content, id) {
  return Object.values(content.nodes).filter((n) => n.parent === id);
}

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
  if (!content || typeof content !== 'object' || !content.nodes) return ['content needs { start, chooser, nodes }'];
  if (!isCharacterId(content.chooser)) errors.push(`chooser "${content.chooser}" is not a character`);
  const start = nodes[content.start];
  if (!start) errors.push(`start "${content.start}" is not a node`);
  else if (start.activity?.kind !== 'blocks') errors.push(`start "${content.start}" must be a blocks tableau`);
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
    if (n.activity && !ACTIVITY_KINDS.has(n.activity.kind)) errors.push(`${at}: unknown activity "${n.activity.kind}"`);
    if (typeof n.title !== 'string' || !n.title) errors.push(`${at}: missing title`);
    if (!isCondition(n.unlock)) errors.push(`${at}: invalid unlock condition`);
    if (n.complete !== undefined && !isCondition(n.complete)) errors.push(`${at}: invalid complete condition`);
    for (const ref of [...refsOf(n.unlock), ...refsOf(n.complete ?? { always: true })]) {
      if (!nodes[ref]) errors.push(`${at}: condition refers to unknown node "${ref}"`);
    }
    for (const e of n.rewards ?? []) {
      if ('unlock' in e && !nodes[e.unlock]) errors.push(`${at}: reward unlocks unknown node "${e.unlock}"`);
      if (!('unlock' in e) && !('item' in e) && !('flag' in e)) errors.push(`${at}: invalid reward ${JSON.stringify(e)}`);
    }
    if (n.door) {
      const d = n.door;
      if (![d.x, d.y, d.w, d.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || d.w <= 0 || d.h <= 0) {
        errors.push(`${at}: invalid door ${JSON.stringify(d)}`);
      }
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
