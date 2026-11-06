// Two-tap confirm for irreversible game-master actions: the first tap arms one action (its button says
// "Tap again…"), the second tap on the SAME action runs it; another action, or a few seconds, disarms.

const CONFIRM_MS = 4000;

/** @param {() => void} redraw called whenever the armed action changes (to relabel buttons) */
export function createConfirm(redraw) {
  /** @type {string | null} */ let armed = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;

  return {
    /** @param {string} key @param {() => void} act */
    tap(key, act) {
      clearTimeout(timer);
      if (armed === key) { armed = null; act(); redraw(); return; }
      armed = key;
      timer = setTimeout(() => { armed = null; redraw(); }, CONFIRM_MS);
      redraw();
    },
    /** @param {string} key */
    isArmed: (key) => armed === key,
    disarm() { clearTimeout(timer); armed = null; },
  };
}
