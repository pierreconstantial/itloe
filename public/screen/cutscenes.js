// Unlock / reward cutscenes from campaign.news. Every pending entry (seq above what THIS TV has
// shown) plays as ONE combined moment; afterwards the TV acks { upTo: last seq shown }. Two TVs:
// either may ack; a TV whose pending news vanish (the other one acked) stops its moment early and
// does not ack. A seq is never replayed by the same TV. Pure queue logic: playing is injected.

/** @typedef {import('../../shared/campaign/types.js').News} News */
/** @typedef {import('../../shared/campaign/types.js').Content} Content */

/**
 * @typedef {{
 *   upTo: number,
 *   unlocked: { id: string, title: string, kind: string }[],  // a world's own tableaux are folded into it
 *   items: string[],
 *   headline: string,
 * }} Moment
 */

/**
 * Builds the combined moment for some news entries.
 * @param {News[]} entries  in seq order
 * @param {Content} content
 * @returns {Moment}
 */
export function composeMoment(entries, content) {
  const ids = entries.flatMap((e) => (e.t === 'unlocked' ? [e.node] : []));
  const batch = new Set(ids);
  const unlocked = ids
    .filter((id) => !batch.has(content.nodes[id]?.parent ?? ''))   // the world says it for its tableaux
    .map((id) => ({ id, title: content.nodes[id]?.title ?? id, kind: content.nodes[id]?.kind ?? 'tableau' }));
  const items = entries.flatMap((e) => (e.t === 'item' ? [e.item] : []));
  const worlds = unlocked.filter((u) => u.kind === 'world').length;
  const headline = worlds > 1 ? 'New worlds unlocked!' : worlds === 1 ? 'New world unlocked!'
    : unlocked.length ? 'Unlocked!' : items.length ? 'Reward!' : '';
  return { upTo: Math.max(0, ...entries.map((e) => e.seq)), unlocked, items, headline };
}

/**
 * @param {{
 *   play: (m: Moment, signal: AbortSignal) => Promise<void>,  // resolves when done or aborted
 *   ack: (upTo: number) => void,
 *   canPlay: () => boolean,                                     // e.g. not mid-game, podium settled
 *   content: () => Content,
 *   ackDelay?: () => number,   // ms before acking; random per TV, so a second TV usually sees the first ack land
 * }} deps
 */
export function createCutscenes({ play, ack, canPlay, content, ackDelay = () => 0 }) {
  /** @type {News[]} */
  let news = [];
  let maxShown = 0;
  /** @type {{ upTo: number, from: number, ctl: AbortController } | null} */
  let current = null;

  /** Entries of a moment still waiting on the server (not acked by anyone). @param {number} from @param {number} upTo */
  const stillPending = (from, upTo) => news.some((n) => n.seq > from && n.seq <= upTo);

  async function tick() {
    if (current || !canPlay()) return;
    const pending = news.filter((n) => n.seq > maxShown);
    if (!pending.length) return;
    const m = composeMoment(pending, content());
    const ctl = new AbortController();
    current = { upTo: m.upTo, from: maxShown, ctl };
    try {
      await play(m, ctl.signal);
    } finally {
      const { from } = current;
      current = null;
      maxShown = Math.max(maxShown, m.upTo);
      // ack only what is still there: if the other TV acked meanwhile, nothing to say
      if (!ctl.signal.aborted) {
        const delay = ackDelay();
        const send = () => { if (stillPending(from, m.upTo)) ack(m.upTo); };
        if (delay > 0) setTimeout(send, delay); else send();
      }
    }
    tick();
  }

  return {
    /**
     * Feed every view's campaign.
     * @param {News[]} list  campaign.news
     * @param {number} newsSeq  campaign.newsSeq (a smaller one = a new campaign: forget what was shown)
     */
    update(list, newsSeq) {
      news = Array.isArray(list) ? list : [];
      if (typeof newsSeq === 'number' && newsSeq < maxShown) maxShown = 0;
      if (current && !stillPending(current.from, current.upTo)) current.ctl.abort(); // acked elsewhere
      tick();
    },
    /** Re-check whether a deferred moment can start now (call when canPlay may have changed). */
    poke: () => { tick(); },
    playing: () => current !== null,
    maxShown: () => maxShown,
  };
}
