// Campaign rules: conditions over facts, events → facts, and the monotonic unlock fixpoint.
// Pure and data-driven: content says WHEN (conditions), this file only says HOW to evaluate.

/** @typedef {import('./types.js').Condition} Condition */
/** @typedef {import('./types.js').Content} Content */
/** @typedef {import('./types.js').Effect} Effect */
/** @typedef {import('./types.js').Facts} Facts */
/** @typedef {import('./types.js').News} News */
/** @typedef {import('./types.js').Node} Node */
/** @typedef {import('./types.js').CampaignEvent} CampaignEvent */

/** Counter keys the engine itself maintains (content conditions may read them). */
export const COUNTER = {
  blocksPlayed: 'blocks.played',
  /** @param {string} character */
  blocksWon: (character) => `blocks.won.${character}`,
  /** @param {string} node */
  finished: (node) => `node.${node}.finished`,
  /** @param {string} node — set by gm lock: settle never re-unlocks it */
  locked: (node) => `node.${node}.locked`,
  /** @param {string} node — set when its rewards were applied: they never apply twice */
  rewarded: (node) => `node.${node}.rewarded`,
  quizPlayed: 'quiz.played',
  /** @param {string} character */
  quizWon: (character) => `quiz.won.${character}`,
  /** @param {string} character — right answers across every quiz of the evening */
  correctBy: (character) => `quiz.correct.${character}`,
  /** @param {string} sceneId */
  sceneSeen: (sceneId) => `scene.${sceneId}.seen`,
  /** @param {string} zone @param {string} character */
  zone: (zone, character) => `zone.${zone}.${character}`,
};

/** @returns {Facts} */
export function emptyFacts() {
  return { counters: {}, flags: [], items: [], unlocked: [], done: [], seen: [], asked: [], totals: {} };
}

/** @param {Facts} f @param {string} key */
export const count = (f, key) => f.counters[key] ?? 0;

/**
 * @param {Condition} c
 * @param {Facts} f
 * @returns {boolean}  unknown shapes are false (a typo never opens anything)
 */
export function holds(c, f) {
  if (!c || typeof c !== 'object') return false;
  if ('always' in c) return c.always === true;
  if ('flag' in c) return f.flags.includes(c.flag);
  if ('done' in c) return f.done.includes(c.done);
  if ('unlocked' in c) return f.unlocked.includes(c.unlocked);
  if ('count' in c) return count(f, c.count) >= c.gte;
  if ('all' in c) return Array.isArray(c.all) && c.all.every((x) => holds(x, f));
  if ('any' in c) return Array.isArray(c.any) && c.any.some((x) => holds(x, f));
  if ('not' in c) return !holds(c.not, f);
  return false;
}

/** @param {Facts} f @param {Record<string, number>} add @param {Record<string, number>} [totals] @returns {Facts} */
function bump(f, add, totals = {}) {
  const counters = { ...f.counters };
  for (const [k, n] of Object.entries(add)) counters[k] = (counters[k] ?? 0) + n;
  const t = { ...f.totals };
  for (const [k, n] of Object.entries(totals)) t[k] = (t[k] ?? 0) + n;
  return { ...f, counters, totals: t };
}

/**
 * What an event changes in the facts (counters + totals). Unlocks are settle's job.
 * @param {Facts} f
 * @param {CampaignEvent} e
 * @returns {Facts}
 */
export function record(f, e) {
  switch (e.t) {
    case 'game.finished': {
      /** @type {Record<string, number>} */
      const add = { [COUNTER.blocksPlayed]: 1, [COUNTER.finished(e.node)]: 1 };
      /** @type {Record<string, number>} */
      const totals = {};
      for (const r of e.ranking) {
        if (!r.character) continue;
        totals[r.character] = (totals[r.character] ?? 0) + r.score;
        if (r.rank === 1 && e.ranking.length > 1) add[COUNTER.blocksWon(r.character)] = 1;
      }
      return bump(f, add, totals);
    }
    case 'quiz.finished': {
      /** @type {Record<string, number>} */
      const add = { [COUNTER.quizPlayed]: 1, [COUNTER.finished(e.node)]: 1 };
      /** @type {Record<string, number>} */
      const totals = {};
      for (const r of e.ranking) {
        if (!r.character) continue;
        totals[r.character] = (totals[r.character] ?? 0) + r.score;
        if (r.correct > 0) add[COUNTER.correctBy(r.character)] = r.correct;
        if (r.rank === 1 && e.ranking.length > 1) add[COUNTER.quizWon(r.character)] = 1;
      }
      const bumped = bump(f, add, totals);
      const known = new Set(f.asked ?? []);
      const fresh = (e.asked ?? []).filter((id) => typeof id === 'string' && !known.has(id));
      return fresh.length ? { ...bumped, asked: [...(f.asked ?? []), ...fresh] } : bumped;
    }
    case 'scene.seen':
      return bump(f, { [COUNTER.sceneSeen(e.sceneId)]: 1, ...(e.node ? { [COUNTER.finished(e.node)]: 1 } : {}) });
    case 'zone.entered':
      return bump(f, { [COUNTER.zone(e.zone, e.character)]: 1 });
    default:
      return f;
  }
}

/** When a node counts as done: its own `complete`, else "its activity finished once"; no activity → never. */
/** @param {Node} n @returns {Condition | null} */
export function completeCondition(n) {
  if (n.complete) return n.complete;
  return n.activity ? { count: COUNTER.finished(n.id), gte: 1 } : null;
}

/**
 * Monotonic fixpoint: unlocks every node whose condition holds (and whose parent is unlocked, and
 * that gm has not locked), marks done every unlocked node whose completion holds, applies its rewards
 * ONCE. Repeats until nothing changes, so chains and simultaneous unlocks come in one call. Never
 * removes anything. Unchanged → the SAME facts object and no news (idempotent).
 * @param {Facts} facts
 * @param {Content} content
 * @param {number} [fromSeq]  last news seq handed out; new news are numbered fromSeq+1, +2…
 * @returns {{ facts: Facts, news: News[] }}
 */
export function settle(facts, content, fromSeq = 0) {
  /** @type {News[]} */
  const news = [];
  let f = facts;
  let seq = fromSeq;
  const unlocked = new Set(f.unlocked);
  const done = new Set(f.done);
  /** @type {Record<string, number>} */
  const counters = { ...f.counters };
  const flags = new Set(f.flags);
  const items = new Set(f.items);
  let changed = false;

  /** @param {string} id */
  const unlock = (id) => {
    if (unlocked.has(id) || !content.nodes[id]) return;
    unlocked.add(id);
    news.push({ seq: ++seq, t: 'unlocked', node: id });
    changed = true;
  };
  /** @param {Effect} e */
  const apply = (e) => {
    if ('flag' in e) flags.add(e.flag);
    else if ('item' in e) {
      if (!items.has(e.item)) { items.add(e.item); news.push({ seq: ++seq, t: 'item', item: e.item }); }
    } else if ('unlock' in e) unlock(e.unlock);
  };

  for (let pass = 0, again = true; again && pass < 1000; pass++) {
    again = false;
    /** @type {Facts} */
    const view = { ...f, unlocked: [...unlocked], done: [...done], counters, flags: [...flags], items: [...items] };
    for (const n of Object.values(content.nodes)) {
      const parentOpen = n.parent === null || unlocked.has(n.parent);
      if (!unlocked.has(n.id) && parentOpen && !counters[COUNTER.locked(n.id)] && holds(n.unlock, view)) {
        unlock(n.id);
        again = true;
      }
      const cc = completeCondition(n);
      if (unlocked.has(n.id) && !done.has(n.id) && cc && holds(cc, view)) {
        done.add(n.id);
        changed = again = true;
        if (!counters[COUNTER.rewarded(n.id)]) {
          counters[COUNTER.rewarded(n.id)] = 1;
          for (const e of n.rewards ?? []) apply(e);
        }
      }
    }
  }
  if (!changed) return { facts, news: [] };
  f = { ...f, unlocked: [...unlocked], done: [...done], counters, flags: [...flags], items: [...items] };
  return { facts: f, news };
}
