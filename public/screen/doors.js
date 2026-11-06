// Campaign map on the TV: which doors the party room shows (the children of the node the party is
// in) and in which state, derived from campaign.facts. Pure: the party room only draws the result.

import { childrenOf } from '../../shared/campaign/index.js';
import { CHARACTERS } from '../../shared/characters.js';

/** @typedef {import('../../shared/campaign/types.js').CampaignView} Campaign */
/** @typedef {import('../../shared/campaign/types.js').Content} Content */
/** @typedef {import('../../shared/campaign/types.js').Door} Rect */

/**
 * locked: closed + padlock · open: unlocked, already entered · new: unlocked, never entered (glows)
 * · done: completed (a star on the plaque; it still opens if replayable).
 * @typedef {'locked' | 'open' | 'new' | 'done'} DoorState
 * @typedef {{ id: string, title: string, rect: Rect, state: DoorState, kind: string }} DoorView
 */

/**
 * @param {Campaign} c
 * @param {Content} content
 * @param {string} [nodeId]  default: where the party is
 * @returns {DoorView[]}  children with a door, in content order
 */
export function doorStates(c, content, nodeId = c.at.node) {
  const f = c.facts;
  /** @type {DoorView[]} */
  const out = [];
  for (const n of childrenOf(content, nodeId)) {
    if (!n.door) continue;
    /** @type {DoorState} */
    const state = !f.unlocked.includes(n.id) ? 'locked'
      : f.done.includes(n.id) ? 'done'
        : f.seen.includes(n.id) ? 'open' : 'new';
    out.push({ id: n.id, title: n.title, rect: n.door, state, kind: n.kind });
  }
  return out;
}

/**
 * A character's display name (the party's name when present, else the roster's).
 * @param {string} character @param {Campaign} [c]
 */
export function nameOf(character, c) {
  const m = c && Object.values(c.party.players).find((p) => p.character === character && !p.left);
  return m?.name ?? CHARACTERS[/** @type {keyof typeof CHARACTERS} */ (character)]?.name ?? character;
}

/**
 * Each present player's items, for the map band: icon + name + count from the catalogue (an item
 * that left the catalogue is not shown). Players with an empty bag are left out.
 * @param {Campaign} c @param {Content} content
 * @returns {{ id: string, name: string, color: number, items: { id: string, icon: string, name: string, count: number }[] }[]}
 */
export function bags(c, content) {
  const inv = c.facts.inventory ?? {};
  return c.party.order
    .map((id) => c.party.players[id])
    .filter((m) => m && !m.left && m.character)
    .map((m) => ({
      id: m.id, name: m.name, color: m.color,
      items: Object.entries(inv[/** @type {string} */ (m.character)] ?? {})
        .filter(([item, n]) => n > 0 && content.items?.[item])
        .map(([item, n]) => ({ id: item, icon: content.items[item].icon, name: content.items[item].name, count: n })),
    }))
    .filter((b) => b.items.length > 0);
}

/**
 * Top band copy for a map screen.
 * @param {Campaign} c
 * @param {Content} content
 * @returns {{ title: string, hint: string, bags: ReturnType<typeof bags> }}
 */
export function mapCopy(c, content) {
  const node = content.nodes[c.at.node];
  const chooser = Object.values(c.party.players).find((m) => !m.left && m.character === content.chooser);
  const hint = c.at.node === 'hub' && c.facts.flags.includes('portal.entered')
    ? !c.facts.flags.includes('apparition.seen') ? 'A visitor is appearing…'
      : !c.facts.inventory.elodie?.['memory-key-intro'] ? 'Élodie, pick up the key.'
        : 'Élodie, enter the Young Adult room.'
    : c.at.node === 'young-adult' ? "Élodie can return to Elo's dream place."
      : chooser ? `${chooser.name}, walk through a door — or the host picks one` : 'The host picks a door';
  return {
    title: node?.title ?? c.at.node,
    hint,
    bags: bags(c, content),
  };
}
