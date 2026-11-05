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
