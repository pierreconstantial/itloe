// Server-clock helpers for timed games. Each `view` carries the server's `now`;
// the skew between it and this phone's clock lets the countdown follow state.deadline exactly.

let skew = 0;

/** @param {unknown} serverNow the `now` field of a view (epoch ms) */
export function syncClock(serverNow) {
  if (typeof serverNow === 'number' && Number.isFinite(serverNow)) skew = serverNow - Date.now();
}

/** The server's clock now (epoch ms): this device's clock + the last measured skew. */
export const serverNow = () => Date.now() + skew;

/** Seconds left until `deadline` (epoch ms, server clock); can go negative. @param {number} deadline */
export function secondsLeft(deadline) {
  return (deadline - (Date.now() + skew)) / 1000;
}

/** 185 → "3:05"; rounds up so the display hits 0:00 only at the bell. @param {number} seconds */
export function mmss(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
