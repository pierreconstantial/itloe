// Per-phone persistence. /sim loads four /play iframes on one origin: ?slot=1..4
// namespaces their keys; real phones have no ?slot and use the plain keys.
// Every access is guarded: storage can be missing or throw (private mode, blocked site data).

const SLOT = new URLSearchParams(location.search).get('slot') ?? '';

export const KEYS = Object.freeze({
  id: `bloko-id${SLOT}`,
  character: `bloko-character${SLOT}`, // last pick, highlighted in the picker
  vibrate: `bloko-vibrate${SLOT}`,
  room: `bloko-room${SLOT}`,
});

/** @param {string} key @returns {string | null} */
export function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** @param {string} key @param {string} value */
export function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not persisted */ }
}

/** @param {string} key */
export function forget(key) {
  try { localStorage.removeItem(key); } catch { /* nothing to forget */ }
}
