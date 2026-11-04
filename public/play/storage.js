// Per-phone persistence. /sim loads four /play iframes on one origin: ?slot=1..4
// namespaces their keys; real phones have no ?slot and use the plain keys.
// Every access is guarded: storage can be missing or throw (private mode, blocked site data).
// Each value is mirrored in a first-party cookie: if localStorage is unavailable or was wiped
// (some private modes, storage pressure) the cookie still brings the player back, and vice versa.

const SLOT = new URLSearchParams(location.search).get('slot') ?? '';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days: a party lasts a night, a series of parties a month

export const KEYS = Object.freeze({
  id: `bloko-id${SLOT}`,
  character: `bloko-character${SLOT}`, // last pick, offered again in the picker
  vibrate: `bloko-vibrate${SLOT}`,
  room: `bloko-room${SLOT}`,
});

/** @param {string} key @returns {string | null} */
function readCookie(key) {
  try {
    for (const part of document.cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0 && part.slice(0, eq).trim() === key) return decodeURIComponent(part.slice(eq + 1).trim());
    }
  } catch { /* cookies blocked */ }
  return null;
}

/** @param {string} key @param {string} value @param {number} maxAge seconds (0 deletes) */
function writeCookie(key, value, maxAge) {
  try {
    document.cookie = `${key}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
  } catch { /* cookies blocked */ }
}

/** @param {string} key @returns {string | null} */
export function load(key) {
  let value = null;
  try { value = localStorage.getItem(key); } catch { /* unavailable */ }
  return value ?? readCookie(key);
}

/** @param {string} key @param {string} value */
export function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not persisted there */ }
  writeCookie(key, value, COOKIE_MAX_AGE);
}

/** @param {string} key */
export function forget(key) {
  try { localStorage.removeItem(key); } catch { /* nothing to forget */ }
  writeCookie(key, '', 0);
}
