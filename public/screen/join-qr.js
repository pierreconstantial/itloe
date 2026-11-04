// "Show the QR again" on the TV: any player asks (server → screens: { t:'joinQr', until }), the TV
// shows a corner card with the join QR + room code until `until` (server epoch ms, read through the
// clock skew). A later request EXTENDS it (never shortens); it hides by itself at `until`; a joinQr
// whose `until` is already reached CLOSES it at once (a player's hideJoin: the server sends
// until = now). Nothing past ever opens it (the server never re-sends after a close or expiry).
// Pure timing here; the card's DOM is built and driven by main.js.

/**
 * @typedef {{ until: number, from: number }} JoinWindow  from: server time when the current span began (bar = 100 %)
 */

/**
 * Applies a joinQr: extends the open window, opens a new one, closes it (until ≤ now), or ignores an
 * invalid message.
 * @param {JoinWindow | null} w  current window (null = hidden)
 * @param {unknown} until  from the message
 * @param {number} serverNow  Date.now() + skew
 * @returns {JoinWindow | null}  the same object when nothing changes
 */
export function applyJoinQr(w, until, serverNow) {
  if (typeof until !== 'number' || !Number.isFinite(until)) return w && w.until > serverNow ? w : null; // invalid: keep
  if (until <= serverNow) return null; // close now (hideJoin), or a past one: never opens
  if (w && w.until > serverNow) {
    // still open: extend (the bar refills to 100 % of the new span), never shorten
    return until > w.until ? { until, from: serverNow } : w;
  }
  return { until, from: serverNow };
}

/**
 * The card's state at a given time: visible, seconds left, and the bar fraction (1 → 0).
 * @param {JoinWindow | null} w @param {number} serverNow
 * @returns {{ visible: boolean, secondsLeft: number, fraction: number }}
 */
export function joinQrState(w, serverNow) {
  if (!w || serverNow >= w.until) return { visible: false, secondsLeft: 0, fraction: 0 };
  const span = Math.max(1, w.until - w.from);
  return {
    visible: true,
    secondsLeft: Math.ceil((w.until - serverNow) / 1000),
    fraction: Math.min(1, Math.max(0, (w.until - serverNow) / span)),
  };
}
