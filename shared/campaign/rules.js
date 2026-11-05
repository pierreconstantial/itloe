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
  /** @param {string} kind — rounds of that minigame finished */
  played: (kind) => `${kind}.played`,
  /** @param {string} kind @param {string} character — rounds of that minigame won (rank 1, two or more players) */
  won: (kind, character) => `${kind}.won.${character}`,
  /** @param {string} node */
  finished: (node) => `node.${node}.finished`,
  /** @param {string} node — set by gm lock: settle never re-unlocks it */
  locked: (node) => `node.${node}.locked`,
  /** @param {string} node — set when its rewards were applied: they never apply twice */
  rewarded: (node) => `node.${node}.rewarded`,
  /** @param {string} sceneId */
  sceneSeen: (sceneId) => `scene.${sceneId}.seen`,
  /** @param {string} zone @param {string} character */
  zone: (zone, character) => `zone.${zone}.${character}`,
};

/** @returns {Facts} */
export function emptyFacts() {
  return { counters: {}, flags: [], inventory: {}, unlocked: [], done: [], seen: [], asked: [], totals: {} };
}

/** How many of an item a character holds. @param {Facts} f @param {string} character @param {string} item */
export const holding = (f, character, item) => f.inventory?.[character]?.[item] ?? 0;

/**
 * Inventory with `n` (positive: give, negative: take) of an item for a character; counts never go
 * below 0, and an emptied entry is removed. Same object when nothing changes.
 * @param {Facts['inventory']} inv @param {string} character @param {string} item @param {number} n
 * @returns {Facts['inventory']}
 */
export function addItem(inv, character, item, n) {
  const had = inv[character]?.[item] ?? 0;
  const next = Math.max(0, had + n);
  if (next === had) return inv;
  const { [item]: _old, ...rest } = inv[character] ?? {};
  const mine = next > 0 ? { ...rest, [item]: next } : rest;
  const { [character]: _c, ...others } = inv;
  return Object.keys(mine).length ? { ...others, [character]: mine } : others;
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
  if ('has' in c) {
    const need = typeof c.gte === 'number' ? c.gte : 1;
    const who = c.who ?? 'anyone';
    if (who === 'anyone') return Object.keys(f.inventory ?? {}).some((ch) => holding(f, ch, c.has) >= need);
    return holding(f, who, c.has) >= need;
  }
  if ('all' in c) return Array.isArray(c.all) && c.all.every((x) => holds(x, f));
  if ('any' in c) return Array.isArray(c.any) && c.any.some((x) => holds(x, f));
  if ('not' in c) return !holds(c.not, f);
  return false;
}

/**
 * Adds counters, and points to `totals[kind]` (per minigame: block and quiz points have
 * different scales, so they are never summed here — an "evening total" is a presentation choice).
 * @param {Facts} f @param {Record<string, number>} add @param {string} [kind] @param {Record<string, number>} [points]
 * @returns {Facts}
 */
function bump(f, add, kind, points = {}) {
  const counters = { ...f.counters };
  for (const [k, n] of Object.entries(add)) counters[k] = (counters[k] ?? 0) + n;
  if (!kind || !Object.keys(points).length) return { ...f, counters };
  const mine = { ...(f.totals[kind] ?? {}) };
  for (const [c, n] of Object.entries(points)) mine[c] = (mine[c] ?? 0) + n;
  return { ...f, counters, totals: { ...f.totals, [kind]: mine } };
}

/**
 * What an event changes in the facts (counters + totals). Unlocks are settle's job.
 * @param {Facts} f
 * @param {CampaignEvent} e
 * @returns {Facts}
 */
export function record(f, e) {
  switch (e.t) {
    case 'round.finished': {
      // the common result: played, won, the tableau finished, points; then the minigame's own counters
      /** @type {Record<string, number>} */
      const add = { [COUNTER.played(e.kind)]: 1, [COUNTER.finished(e.node)]: 1 };
      /** @type {Record<string, number>} */
      const totals = {};
      for (const r of e.ranking) {
        totals[r.character] = (totals[r.character] ?? 0) + r.score;
        if (r.rank === 1 && e.ranking.length > 1) add[COUNTER.won(e.kind, r.character)] = 1;
      }
      for (const [k, n] of Object.entries(e.counters ?? {})) add[k] = (add[k] ?? 0) + n;
      const bumped = bump(f, add, e.kind, totals);
      const known = new Set(f.asked);
      const fresh = (e.asked ?? []).filter((id) => typeof id === 'string' && !known.has(id));
      return fresh.length ? { ...bumped, asked: [...f.asked, ...fresh] } : bumped;
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
 * @param {SettleContext} [ctx]  who the item rewards go to (the party; the event that triggered this step)
 * @returns {{ facts: Facts, news: News[] }}
 */
export function settle(facts, content, fromSeq = 0, ctx = {}) {
  /** @type {News[]} */
  const news = [];
  let f = facts;
  let seq = fromSeq;
  const unlocked = new Set(f.unlocked);
  const done = new Set(f.done);
  /** @type {Record<string, number>} */
  const counters = { ...f.counters };
  const flags = new Set(f.flags);
  let inventory = f.inventory ?? {};
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
      if (!content.items?.[e.item]) return; // only catalogue items can exist (validateContent reports it)
      const to = recipients(e.to, content, ctx);
      const n = Number.isInteger(e.count) && /** @type {number} */ (e.count) > 0 ? /** @type {number} */ (e.count) : 1;
      for (const ch of to) inventory = addItem(inventory, ch, e.item, n);
      if (to.length) news.push({ seq: ++seq, t: 'item', item: e.item, to: /** @type {import('../characters.js').CharacterId[]} */ (to) });
    } else if ('unlock' in e) unlock(e.unlock);
  };

  for (let pass = 0, again = true; again && pass < 1000; pass++) {
    again = false;
    /** @type {Facts} */
    const view = { ...f, unlocked: [...unlocked], done: [...done], counters, flags: [...flags], inventory };
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
  f = { ...f, unlocked: [...unlocked], done: [...done], counters, flags: [...flags], inventory };
  return { facts: f, news };
}

/**
 * Context for item rewards. `party`: the characters present (for 'all'); `event`: the finished
 * activity that triggered this step (for 'winner': its rank-1 characters, all of them when tied).
 * @typedef {{ party?: { order: string[], players: Record<string, { character: string, left: boolean }> },
 *   event?: CampaignEvent }} SettleContext
 */

/**
 * Who gets an item reward. 'chooser' (default) · 'winner' = rank 1 of the activity that completed
 * the node (all when tied; no ranking in this step → the chooser) · 'all' = every non-left party
 * member · a CharacterId. Deduplicated, in party order.
 * @param {string | undefined} to @param {Content} content @param {SettleContext} ctx @returns {string[]}
 */
export function recipients(to, content, ctx) {
  const target = to ?? 'chooser';
  if (target === 'chooser') return [content.chooser];
  if (target === 'all') {
    const p = ctx.party;
    const all = p ? p.order.map((id) => p.players[id]).filter((m) => m && !m.left).map((m) => m.character) : [];
    return all.length ? [...new Set(all)] : [content.chooser];
  }
  if (target === 'winner') {
    const e = ctx.event;
    const ranking = e && 'ranking' in e ? e.ranking : [];
    const top = ranking.filter((r) => r.rank === 1).map((r) => r.character);
    return top.length ? [...new Set(top)] : [content.chooser];
  }
  return [target];
}

/**
 * Inventory made safe for the current content: entries whose item left the catalogue are dropped;
 * counts ≤ 0 removed.
 * @param {Partial<Facts>} f @param {Content} content @returns {Facts['inventory']}
 */
export function safeInventory(f, content) {
  const known = (/** @type {string} */ id) => !!content.items?.[id];
  /** @type {Facts['inventory']} */
  let inv = {};
  for (const [ch, items] of Object.entries(f.inventory ?? {})) {
    for (const [id, n] of Object.entries(items ?? {})) if (known(id) && typeof n === 'number' && n > 0) inv = addItem(inv, ch, id, Math.floor(n));
  }
  return inv;
}
