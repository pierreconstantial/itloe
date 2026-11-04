// "Show the join QR" timings, shared by the server (the window it opens on the TVs) and the phone (its
// toast and its "Hide from the TV" button), so the two can never disagree.

/** How long the TVs show the join QR after a showJoin (a repeat restarts it). */
export const JOIN_QR_MS = 15_000;
/** One showJoin, and separately one hideJoin, per socket per this long (a mashed button can't flood). */
export const JOIN_QR_GAP_MS = 2000;
