// "+N" score floaters at bot speed: per player, a gain within MERGE_MS of the previous floater
// MERGES into it (one "+N" that grows), otherwise it takes the next free vertical SLOT among that
// player's floaters still on screen, so they never sit on top of each other. Pure planner;
// fx.js draws what it decides.

export const MERGE_MS = 300;
export const LIFE_MS = 1200;

/** @typedef {{ key: number, slot: number, total: number, born: number, last: number }} Floater */

export function createFloaterPlanner({ mergeMs = MERGE_MS, lifeMs = LIFE_MS } = {}) {
  /** player id → floaters still on screen */
  const live = new Map();
  let keys = 0;

  /** @param {string} id @param {number} now */
  const alive = (id, now) => {
    const list = /** @type {Floater[]} */ (live.get(id) ?? []).filter((f) => now - f.born < lifeMs);
    live.set(id, list);
    return list;
  };

  return {
    /**
     * @param {string} id  player
     * @param {number} gained
     * @param {number} now  ms
     * @returns {{ kind: 'merge' | 'new', key: number, slot: number, total: number }}
     */
    add(id, gained, now) {
      const list = alive(id, now);
      const last = list.at(-1);
      if (last && now - last.last <= mergeMs) {
        last.total += gained;
        last.last = now;
        return { kind: 'merge', key: last.key, slot: last.slot, total: last.total };
      }
      const used = new Set(list.map((f) => f.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      const f = { key: ++keys, slot, total: gained, born: now, last: now };
      list.push(f);
      return { kind: 'new', key: f.key, slot, total: gained };
    },
  };
}
