// Reports the page's uncaught errors, unhandled rejections and failed loads to the server
// (POST /api/client-error) for the admin page: on the evening, a guest's phone has no developer tools.
// Loaded before the page's main module, so an error while that one loads is reported too.
// Each distinct error once per page load, at most MAX_REPORTS.
import { KEYS, load } from '../play/storage.js';

const MAX_REPORTS = 10;
const reported = new Set();

/** @param {string} message @param {string} source @param {string} stack */
function report(message, source, stack) {
  const key = `${message}\n${source}`;
  if (reported.has(key) || reported.size >= MAX_REPORTS) return;
  reported.add(key);
  const body = JSON.stringify({ page: location.pathname + location.search, playerId: load(KEYS.id), message, source, stack });
  fetch('/api/client-error', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } })
    .catch(() => { /* offline: nothing to do */ });
}

// Capture: a script, stylesheet, image or sound that fails to load fires on its element, without bubbling.
addEventListener('error', (/** @type {Event} */ event) => {
  const target = event.target;
  if (event instanceof ErrorEvent) {
    report(event.message, `${event.filename}:${event.lineno}:${event.colno}`, event.error?.stack ?? '');
  } else if (target instanceof Element) {
    const what = target.getAttribute('src') ?? target.getAttribute('href') ?? target.tagName;
    report(`could not load ${what}`, '', '');
  }
}, true);

addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  report(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`, '',
    reason instanceof Error ? reason.stack ?? '' : '');
});
