// Pixel assets for Young Adult collectibles. The catalogue still supplies names and emoji fallbacks.
const ROOT = '/assets/items/young-adult/';

export const ITEM_ART = Object.freeze({
  'young-adult-beer': `${ROOT}beer.svg`,
  'young-adult-cigarettes': `${ROOT}cigarettes.svg`,
  'young-adult-crowbar': `${ROOT}crowbar.svg`,
  'shelter-ticket': `${ROOT}shelter-ticket.svg`,
  'young-adult-adult-key': `${ROOT}adult-key.svg`,
});

/** @param {string} id */
export const itemArt = (id) => ITEM_ART[/** @type {keyof typeof ITEM_ART} */ (id)] ?? null;
