// Phone-side reading of the campaign (slice 3): helpers over the view's `campaign` and the content.
// The view carries the campaign (facts, party, where we are) and a `contentVersion`; the content itself
// (titles, tree, doors) comes from GET /api/content through the shared content source, re-fetched when
// the version changes. Until it loads (or on the mock) the bundled sample stands in: never null.
import { childrenOf, holds } from '../../shared/campaign/index.js';
import { createContentSource } from '../commun/content.js';
import { CHARACTERS } from '../../shared/characters.js';

/** @typedef {import('../../shared/campaign/types.js').Campaign} Campaign */
/** @typedef {import('../../shared/campaign/types.js').Content} Content */
/** @typedef {import('../../shared/campaign/types.js').Condition} Condition */
/** @typedef {import('../../shared/campaign/types.js').Facts} Facts */
/** @typedef {import('../../shared/campaign/types.js').Node} Node */

/** @type {Set<() => void>} */
const listeners = new Set();
const source = createContentSource({ onChange: () => { for (const f of listeners) f(); } });

/** The content to render with. @returns {Content} */
export const content = () => source.get();
/** Call with every view's `contentVersion`. @param {unknown} version */
export const syncContent = (version) => { void source.sync(typeof version === 'string' ? version : null); };
/** Runs `f` whenever a (re)load brought different content. @param {() => void} f */
export const onContentChange = (f) => { listeners.add(f); };

/** @param {string} id @returns {string} */
export const titleOf = (id) => content().nodes[id]?.title ?? id;

/** A `has` condition in words (Contract F): "🗝️ Old key — Élodie", "×2 🍰 Cake — anyone".
 *  @param {{ has: string, who?: string, gte?: number }} c */
function hasText(c) {
  const item = content().items?.[c.has];
  const what = item ? `${item.icon} ${item.name}` : c.has;
  const who = !c.who || c.who === 'anyone' ? 'anyone' : (CHARACTERS[/** @type {keyof typeof CHARACTERS} */ (c.who)]?.name ?? c.who);
  return `${c.gte && c.gte > 1 ? `×${c.gte} ` : ''}${what} — ${who}`;
}

/**
 * @typedef {{ node: Node, unlocked: boolean, done: boolean, fresh: boolean }} ChildMark
 * fresh = unlocked but nobody has entered it yet (the "NEW" mark)
 */

/** Children of the node the party stands on, with their marks. @param {Campaign} c @returns {ChildMark[]} */
export function childMarks(c) {
  const f = c.facts;
  return childrenOf(content(), c.at.node).map((node) => {
    const unlocked = f.unlocked.includes(node.id);
    return { node, unlocked, done: f.done.includes(node.id), fresh: unlocked && !f.seen.includes(node.id) };
  });
}

/** Every node, depth-first from the hub, with its depth (for an indented picker). @returns {{ node: Node, depth: number }[]} */
export function nodeTree() {
  /** @type {{ node: Node, depth: number }[]} */
  const out = [];
  /** @param {string | null} parent @param {number} depth */
  const walk = (parent, depth) => {
    for (const node of Object.values(content().nodes)) {
      if (node.parent !== parent) continue;
      out.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * A condition as short readable text with ✓/✗ on each leaf, so the game master sees WHY something is
 * (not) unlocked: "3 × blocks.played ✗ (2)", "done World 1 ✓", "all(…)".
 * @param {Condition} cond @param {Facts} f @returns {string}
 */
export function explain(cond, f) {
  if (!cond || typeof cond !== 'object') return '?';
  const mark = (/** @type {boolean} */ ok) => (ok ? '✓' : '✗');
  if ('always' in cond) return 'always';
  if ('flag' in cond) return `flag ${cond.flag} ${mark(holds(cond, f))}`;
  if ('done' in cond) return `done "${titleOf(cond.done)}" ${mark(holds(cond, f))}`;
  if ('unlocked' in cond) return `unlocked "${titleOf(cond.unlocked)}" ${mark(holds(cond, f))}`;
  if ('count' in cond) return `${cond.count} ≥ ${cond.gte} ${mark(holds(cond, f))} (${f.counters[cond.count] ?? 0})`;
  if ('has' in cond) return `${hasText(cond)} ${mark(holds(cond, f))}`;
  if ('all' in cond) return `all of (${cond.all.map((x) => explain(x, f)).join(', ')})`;
  if ('any' in cond) return `any of (${cond.any.map((x) => explain(x, f)).join(', ')})`;
  if ('not' in cond) return `not (${explain(cond.not, f)})`;
  return '?';
}
