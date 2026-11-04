// Contract C (M3, 2026-11-04) — the character roster. The character IS the colour slot.
// Insertion order = display order (phone picker, TV). The roster will grow later.

/**
 * @typedef {'pierre' | 'elodie' | 'sol' | 'anna' | 'konz'} CharacterId
 * @typedef {{ id: CharacterId, name: string, color: number }} Character   // color 1..N → CSS --p1..--pN
 */

/**
 * The roster sizes the game: nothing caps the player count on its own, the server refuses a join
 * only once every character is held. Adding one here makes the game one player bigger, so it also
 * needs its --pN colour (public/commun/base.css), its sprite (shared/sprites.js) and a look at the
 * TV layouts that place one panel per player.
 * @type {Readonly<Record<CharacterId, Readonly<Character>>>}
 */
export const CHARACTERS = Object.freeze({
  pierre: Object.freeze({ id: 'pierre', name: 'Pierre', color: 1 }),
  elodie: Object.freeze({ id: 'elodie', name: 'Élodie', color: 2 }),
  sol: Object.freeze({ id: 'sol', name: 'Sol', color: 3 }),
  anna: Object.freeze({ id: 'anna', name: 'Anna', color: 4 }),
  konz: Object.freeze({ id: 'konz', name: 'Konz', color: 5 }),
});

/** How many players the game holds: one per character. */
export const ROSTER_SIZE = Object.keys(CHARACTERS).length;

/**
 * @param {unknown} id
 * @returns {id is CharacterId}
 */
export function isCharacterId(id) {
  return typeof id === 'string' && Object.hasOwn(CHARACTERS, id);
}

/**
 * Characters not picked by any player who has not left, in display order.
 * A player without `character` (save from before M3) holds the character
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
