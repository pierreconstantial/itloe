// Self-healing WebSocket for the phone (M3 slice 2: "the session is never losable").
// The phone keeps rendering its last view while disconnected; this module only gets the link back:
//  - auto-reconnect with a short backoff after any close/error;
//  - a connect timeout (a socket stuck in CONNECTING after a Wi-Fi change is dropped and retried);
//  - the shared liveness watchdog (public/commun/liveness.js): the server ticks every 10 s, so a
//    socket silent for 25 s is half-open (Wi-Fi dropped silently) and is abandoned;
//  - a faster probe whenever the page comes back (unlock, tab switch, bfcache restore, Chrome
//    `resume`, `online`): a socket can look OPEN after a long sleep yet be dead, so we re-send
//    `hello` (idempotent on the server: re-attach + welcome + view) and reconnect if nothing
//    comes back in time.
// The banner shows only after a short grace, so a quick self-heal does not flash it.
// One exception to "always reconnect": `replaced` (another device took this player, slice 2b).
// Then the link stays down for good until restart(): two devices must never fight over a player.
import { createLiveness } from '../commun/liveness.js';

const RETRY_MS = [500, 1000, 2000, 3000]; // backoff per consecutive failure, then stays at the last
const CONNECT_TIMEOUT_MS = 5000;
const PROBE_TIMEOUT_MS = 3000;
const BANNER_GRACE_MS = 700;
const CLOSE_REPLACED = 4001; // PROTOCOL.md: the server closes a bumped socket with this code

/**
 * @param {{
 *   url: () => string,
 *   hello: () => unknown,
 *   onMessage: (raw: string) => void,
 *   onStatus: (online: boolean) => void,
 *   onReplaced: () => void,
 * }} hooks
 */
export function createConnection(hooks) {
  /** @type {WebSocket | null} */ let ws = null;
  /** Watchdog of the current socket; abandoning a socket stops it. */
  let live = createLiveness({ onDead: () => {} });
  let failures = 0;
  let lastHeard = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let retryTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let connectTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let probeTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let bannerTimer;
  let online = false;
  let stopped = false;

  /** @param {boolean} up */
  function setOnline(up) {
    if (up) {
      clearTimeout(bannerTimer);
      if (!online) { online = true; hooks.onStatus(true); }
      return;
    }
    if (!online) return; // already down: keep the pending banner (a failed retry inside the grace must not cancel it)
    online = false;
    bannerTimer = setTimeout(() => { if (!online) hooks.onStatus(false); }, BANNER_GRACE_MS);
  }

  function open() {
    if (stopped) return;
    clearTimeout(retryTimer);
    clearTimeout(connectTimer);
    clearTimeout(probeTimer);
    live.stop();
    const sock = new WebSocket(hooks.url());
    ws = sock;
    live = createLiveness({ onDead: () => drop(sock) }); // half-open: abandon, never wait on close()
    connectTimer = setTimeout(() => { if (ws === sock && sock.readyState !== WebSocket.OPEN) drop(sock); }, CONNECT_TIMEOUT_MS);
    sock.addEventListener('open', () => {
      if (ws !== sock) return;
      clearTimeout(connectTimer);
      failures = 0;
      lastHeard = Date.now();
      live.start();
      setOnline(true);
      sendRaw(sock, hooks.hello());
    });
    sock.addEventListener('message', (ev) => {
      if (ws !== sock) return;
      live.feed();
      lastHeard = Date.now();
      clearTimeout(probeTimer);
      setOnline(true);
      const raw = String(ev.data);
      if (raw.includes('"replaced"') && isReplaced(raw)) { stop(); return; }
      hooks.onMessage(raw);
    });
    sock.addEventListener('close', (ev) => {
      if (ws !== sock) return;
      if (ev.code === CLOSE_REPLACED) stop();
      else scheduleRetry();
    });
    sock.addEventListener('error', () => { if (ws === sock) drop(sock); });
  }

  /** Abandon a socket (dead or stuck) and retry. @param {WebSocket} sock */
  function drop(sock) {
    if (ws !== sock) return;
    try { sock.close(); } catch { /* already gone */ }
    scheduleRetry();
  }

  function scheduleRetry() {
    ws = null;
    live.stop();
    clearTimeout(connectTimer);
    clearTimeout(probeTimer);
    setOnline(false);
    clearTimeout(retryTimer);
    const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures++;
    retryTimer = setTimeout(open, delay);
  }

  /** @param {string} raw */
  function isReplaced(raw) {
    try { return JSON.parse(raw)?.t === 'replaced'; } catch { return false; }
  }

  /** Bumped by another device: no socket, no retry, no probe, until restart(). */
  function stop() {
    if (stopped) return;
    stopped = true;
    live.stop(); // never restarted after replaced
    const sock = ws;
    ws = null;
    for (const t of [retryTimer, connectTimer, probeTimer, bannerTimer]) clearTimeout(t);
    try { sock?.close(); } catch { /* already gone */ }
    online = false;
    hooks.onReplaced();
  }

  /** @param {WebSocket} sock @param {unknown} msg @returns {boolean} whether it went out */
  function sendRaw(sock, msg) {
    if (sock.readyState !== WebSocket.OPEN) return false;
    sock.send(JSON.stringify(msg));
    return true;
  }

  /** Is the link alive? Re-hello and wait for any answer; reconnect now if there is no socket. */
  function probe() {
    if (stopped) return;
    const sock = ws;
    if (!sock) { open(); return; } // waiting for a retry: don't wait any longer
    if (sock.readyState !== WebSocket.OPEN) return; // CONNECTING: the connect timeout covers it
    clearTimeout(probeTimer);
    const asked = Date.now();
    sendRaw(sock, hooks.hello());
    probeTimer = setTimeout(() => { if (ws === sock && lastHeard < asked) drop(sock); }, PROBE_TIMEOUT_MS);
  }

  // page lifecycle: every "we're back" signal probes the link
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') probe(); });
  // bfcache: a page leaving for the cache closes its socket itself, so the server sees the player
  // offline at once (its character becomes reclaimable from another device), and reopens on restore
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted || stopped) return;
    const sock = ws;
    ws = null;
    live.stop();
    for (const t of [retryTimer, connectTimer, probeTimer]) clearTimeout(t);
    try { sock?.close(1000, 'pagehide'); } catch { /* already gone */ }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && !stopped) { failures = 0; open(); } });
  window.addEventListener('online', probe);
  window.addEventListener('focus', probe);
  document.addEventListener('resume', probe); // Chrome page lifecycle: unfrozen

  return {
    start: open,
    /** False when the link is down: the message didn't go out, and nothing resends it. @param {unknown} msg */
    send(msg) { return !!ws && sendRaw(ws, msg); },
    /** Drop the socket on purpose and open a fresh one at once (no banner); also ends a stop(). */
    restart() {
      stopped = false;
      const old = ws;
      ws = null;
      live.stop();
      try { old?.close(); } catch { /* already gone */ }
      failures = 0;
      open();
    },
    isOnline: () => online,
  };
}
