// Small DOM helpers shared by the /play modules.
/** @param {string} id @returns {HTMLElement} */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/** Brief message at the bottom of the screen; a newer toast replaces the current one. @param {string} text */
export function toast(text, ms = 2200) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** How many views and refusals the server has sent: what answers a tap (the frame counts them, `heardBack`). */
let answers = 0;
/** The server sent a view or an `err`. */
export function heardBack() { answers++; }

/**
 * A tap that moves the game on (Start, I'm ready, Back to the lobby, Next): tapped again before the server answered
 * the first (a view or a refusal; for `ms` at most, in case none comes), it is the same tap, not a second message
 * that the server refuses once the first went through ("That can't be done right now").
 * @param {() => void} act @returns {() => void}
 */
export function oneTap(act, ms = 2000) {
  let at = -Infinity, seen = -1;
  return () => {
    const now = performance.now();
    if (seen === answers && now - at < ms) return;
    at = now;
    seen = answers;
    act();
  };
}

/** Player colour dot. @param {number} color 1..4 @returns {HTMLElement} */
export function dotEl(color) {
  const dot = document.createElement('span');
  dot.className = `dot c${color}`;
  return dot;
}

/** Loads a stylesheet once, after the page's own (a minigame's screens bring theirs). @param {URL} url */
export function addStylesheet(url) {
  if (typeof document === 'undefined' || document.querySelector(`link[href="${url.href}"]`)) return;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url.href }));
}
