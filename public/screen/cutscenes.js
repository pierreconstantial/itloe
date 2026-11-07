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
 *   items: { item: string, icon: string, name: string, to: string[] }[],   // to: display names
 *   headline: string,
 *   cutscene: string | null,   // a scripted cutscene's id (news `cutscene`): the TV plays that one instead
 * }} Moment
 */

/**
 * Builds the combined moment for some news entries.
 * @param {News[]} entries  in seq order
 * @param {Content} content
 * @param {(character: string) => string} [nameOf]  CharacterId → display name
 * @returns {Moment}
 */
export function composeMoment(entries, content, nameOf = (c) => c) {
  const ids = entries.flatMap((e) => (e.t === 'unlocked' ? [e.node] : []));
  const batch = new Set(ids);
  const unlocked = ids
    .filter((id) => !batch.has(content.nodes[id]?.parent ?? ''))   // the world says it for its tableaux
    .map((id) => ({ id, title: content.nodes[id]?.title ?? id, kind: content.nodes[id]?.kind ?? 'tableau' }));
  const items = entries.flatMap((e) => (e.t === 'item' ? [{
    item: e.item,
    icon: content.items?.[e.item]?.icon ?? '🎁',
    name: content.items?.[e.item]?.name ?? e.item,
    to: (Array.isArray(e.to) ? e.to : []).map(nameOf),
  }] : []));
  const worlds = unlocked.filter((u) => u.kind === 'world').length;
  const cutscene = entries.flatMap((e) => (e.t === 'cutscene' ? [e.id] : []))[0] ?? null;
  const headline = worlds > 1 ? 'New worlds unlocked!' : worlds === 1 ? 'New world unlocked!'
    : unlocked.length ? 'Unlocked!' : items.length ? 'Reward!' : '';
  return { upTo: Math.max(0, ...entries.map((e) => e.seq)), unlocked, items, headline, cutscene };
}

/**
 * @param {{
 *   play: (m: Moment, signal: AbortSignal) => Promise<void>,  // resolves when done or aborted
 *   ack: (upTo: number) => void,
 *   canPlay: () => boolean,                                     // e.g. not mid-game, podium settled
 *   content: () => Content,
 *   nameOf?: (character: string) => string,
 *   ackDelay?: () => number,   // ms before acking; random per TV, so a second TV usually sees the first ack land
 * }} deps
 */
export function createCutscenes({ play, ack, canPlay, content, nameOf, ackDelay = () => 0 }) {
  /** @type {News[]} */
  let news = [];
  let maxShown = 0;
  /** interrupted: a game / quiz question started mid-moment → not shown, played again later */
  /** @type {{ upTo: number, from: number, ctl: AbortController, interrupted: boolean } | null} */
  let current = null;

  /** Entries of a moment still waiting on the server (not acked by anyone). @param {number} from @param {number} upTo */
  const stillPending = (from, upTo) => news.some((n) => n.seq > from && n.seq <= upTo);

  async function tick() {
    if (current || !canPlay()) return;
    const pending = news.filter((n) => n.seq > maxShown);
    if (!pending.length) return;
    const m = composeMoment(pending, content(), nameOf);
    const ctl = new AbortController();
    current = { upTo: m.upTo, from: maxShown, ctl, interrupted: false };
    try {
      await play(m, ctl.signal);
    } finally {
      const { from, interrupted } = current;
      current = null;
      if (interrupted) return; // not shown: the next calm moment plays it again (poke / update)
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

  const api = {
    /**
     * Feed every view's campaign.
     * @param {News[]} list  campaign.news
     * @param {number} newsSeq  campaign.newsSeq (a smaller one = a new campaign: forget what was shown)
     */
    update(list, newsSeq) {
      news = Array.isArray(list) ? list : [];
      if (typeof newsSeq === 'number' && newsSeq < maxShown) maxShown = 0;
      if (current && !stillPending(current.from, current.upTo)) current.ctl.abort(); // acked elsewhere
      api.poke(); // interrupt it if play just started, else start a pending one
    },
    /**
     * Re-check canPlay: start a deferred moment, or interrupt the running one when a game or a quiz
     * question has started meanwhile (it never covers play; it is replayed once calm again).
     */
    poke: () => {
      if (current && !current.interrupted && !canPlay()) {
        current.interrupted = true;
        current.ctl.abort();
        return;
      }
      tick();
    },
    playing: () => current !== null,
    maxShown: () => maxShown,
  };
  return api;
}
