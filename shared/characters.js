// Contract C (M3, 2026-11-04) — the character roster. The character IS the colour slot.
// Insertion order = display order (phone picker, TV).

/**
 * @typedef {'pierre' | 'elodie' | 'sol' | 'anna'} CharacterId
 * @typedef {{ id: CharacterId, name: string, color: number }} Character   // color 1..4 → CSS --p1..--p4
 */

/**
 * The roster sizes the game: nothing caps the player count on its own, the server refuses a join
 * only once every character is held.
 * @type {Readonly<Record<CharacterId, Readonly<Character>>>}
 */
export const CHARACTERS = Object.freeze({
  pierre: Object.freeze({ id: 'pierre', name: 'Pierre', color: 1 }),
  elodie: Object.freeze({ id: 'elodie', name: 'Élodie', color: 2 }),
  sol: Object.freeze({ id: 'sol', name: 'Sol', color: 3 }),
  anna: Object.freeze({ id: 'anna', name: 'Anna', color: 4 }),
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
