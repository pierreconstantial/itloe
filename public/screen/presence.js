// Slice 2b — who has dropped, as the TV shows it. The server's `view.online` lists the players with
// a live socket; a player missing from it is shown OFFLINE only after GRACE_MS, so a reconnect blip
// (phone locked for a second, Wi-Fi hiccup) never makes the tag flicker. Pure logic + one timer.

export const GRACE_MS = 2000;

/**
 * @param {{
 *   onChange: () => void,                       // the shown offline set changed (re-apply the dimming)
 *   graceMs?: number,
 *   now?: () => number,
 *   later?: (fn: () => void, ms: number) => unknown,
 *   cancel?: (handle: any) => void,
 * }} opts
 */
export function createPresence({ onChange, graceMs = GRACE_MS, now = () => performance.now(), later = setTimeout, cancel = clearTimeout }) {
  /** playerId → when it was first seen missing from `online` */
  const missingSince = new Map();
  /** @type {Set<string>} */
  let shown = new Set();
  /** @type {unknown} */
  let timer = null;

  function recompute() {
    const t = now();
    /** @type {Set<string>} */
    const next = new Set();
    let soonest = Infinity;
    for (const [id, since] of missingSince) {
      const due = since + graceMs;
      if (t >= due) next.add(id);
      else soonest = Math.min(soonest, due);
    }
    if (timer !== null) { cancel(timer); timer = null; }
    if (soonest < Infinity) timer = later(recompute, soonest - t);
    const changed = next.size !== shown.size || [...next].some((id) => !shown.has(id));
    shown = next;
    if (changed) onChange();
  }

  return {
    /**
     * Feed every view. `online` undefined (a server without presence, e.g. the mock) → nobody is offline.
     * @param {string[] | undefined} online
     * @param {string[]} players  ids that can be offline (seated, not left)
     */
    update(online, players) {
      const on = new Set(online ?? players);
      const t = now();
      for (const id of [...missingSince.keys()]) if (on.has(id) || !players.includes(id)) missingSince.delete(id);
      for (const id of players) if (!on.has(id) && !missingSince.has(id)) missingSince.set(id, t);
      recompute();
    },
    /** @param {string} id */
    isOffline: (id) => shown.has(id),
    /** @returns {Set<string>} */
    offline: () => new Set(shown),
  };
}
