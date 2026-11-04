// Contract C (M3, 2026-11-04) — the character roster. The character IS the colour slot.
// Insertion order = display order (phone picker, TV). The roster will grow later.

/**
 * @typedef {'pierre' | 'elodie' | 'sol' | 'anna'} CharacterId
 * @typedef {{ id: CharacterId, name: string, color: number }} Character   // color 1..4 → CSS --p1..--p4
 */

/** @type {Readonly<Record<CharacterId, Readonly<Character>>>} */
export const CHARACTERS = Object.freeze({
  pierre: Object.freeze({ id: 'pierre', name: 'Pierre', color: 1 }),
  elodie: Object.freeze({ id: 'elodie', name: 'Élodie', color: 2 }),
  sol: Object.freeze({ id: 'sol', name: 'Sol', color: 3 }),
  anna: Object.freeze({ id: 'anna', name: 'Anna', color: 4 }),
});

/**
 * @param {unknown} id
 * @returns {id is CharacterId}
 */
export function isCharacterId(id) {
  return typeof id === 'string' && Object.hasOwn(CHARACTERS, id);
}

/**
 * Characters not picked by any player who has not left, in display order.
 * A player without `character` (save from before M3, mock server) holds the character
 * of its colour slot, so the two can never share a colour.
 * @param {{ order: string[], players: Record<string, { color: number, left?: boolean, character?: CharacterId | null }> }} state
 * @returns {CharacterId[]}
 */
export function freeCharacters(state) {
  /** @type {Set<string>} */
  const held = new Set();
  /** @type {Set<number>} */
  const heldColors = new Set();
  for (const id of state.order) {
    const p = state.players[id];
    if (!p || p.left) continue;
    if (p.character) held.add(p.character);
    else heldColors.add(p.color);
  }
  return /** @type {CharacterId[]} */ (Object.keys(CHARACTERS)).filter(
    (c) => !held.has(c) && !heldColors.has(CHARACTERS[c].color)
  );
}
