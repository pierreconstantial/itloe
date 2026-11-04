// Liveness watchdog for a client socket. The server sends every client `{ t:'tick', now }` every
// 10 s (PROTOCOL.md), so a socket that has carried NO message for `timeoutMs` is presumed dead —
// typically half-open (Wi-Fi dropped silently): the browser never fires `close`, and ping frames
// are invisible to JS. Shared by the TV and the phone; one watchdog per socket.

export const LIVENESS_TIMEOUT_MS = 25_000;

/**
 * @param {{
 *   onDead: () => void,                                // called once; then the watchdog is stopped
 *   timeoutMs?: number,
 *   now?: () => number,
 *   later?: (fn: () => void, ms: number) => unknown,
 *   cancel?: (handle: any) => void,
 * }} opts
 */
export function createLiveness({ onDead, timeoutMs = LIVENESS_TIMEOUT_MS, now = () => Date.now(), later = setTimeout, cancel = clearTimeout }) {
  let lastAt = now();
  /** @type {unknown} */
  let timer = null;
  let running = false;

  /** @param {number} ms */
  function arm(ms) {
    timer = later(check, ms);
  }
  function check() {
    timer = null;
    if (!running) return;
    const idle = now() - lastAt;
    if (idle >= timeoutMs) {
      running = false;
      onDead();
    } else {
      arm(timeoutMs - idle); // a message came in meanwhile: re-check when it would expire
    }
  }

  return {
    /** Start watching (socket open). Counts from now. */
    start() {
      lastAt = now();
      running = true;
      if (timer !== null) cancel(timer);
      arm(timeoutMs);
    },
    /** Call on every message received. Cheap: no timer churn. */
    feed() {
      lastAt = now();
    },
    /** Stop watching (socket closed or abandoned). */
    stop() {
      running = false;
      if (timer !== null) { cancel(timer); timer = null; }
    },
  };
}
