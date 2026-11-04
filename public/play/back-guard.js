// The phone's back button (M3 slice 2). At the first playtest a player pressed back on the podium
// looking for a way to the room and left the page. Now the first back press stays in the game:
// it closes an open sheet, or says where things are. A second press really leaves (and coming
// back resumes the session anyway).
// One guard entry is pushed on top of the page's entry. Browsers ignore entries pushed without a
// user gesture when going back, so it is (re-)armed from a tap, never from a timer or popstate.

const GUARD = 'bloko-guard';

/** @param {{ onBack: () => void }} hooks */
export function installBackGuard(hooks) {
  const armed = () => history.state?.[GUARD] === true;

  function arm() {
    if (armed()) return;
    try { history.pushState({ ...history.state, [GUARD]: true }, ''); } catch { /* history unavailable */ }
  }

  window.addEventListener('pointerdown', arm, { capture: true, passive: true });
  window.addEventListener('popstate', () => { if (!armed()) hooks.onBack(); });
}
