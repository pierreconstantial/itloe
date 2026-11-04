// Host controls during a game (slice 2b): a disconnected player must never block the podium.
// Lives in the ☰ menu sheet, host only, phase playing: "Take <name> out" per player still playing
// (offline ones first and flagged), and "End game". Both are irreversible, so each needs a second
// tap to confirm (same pattern as "Leave game"); an armed button disarms after a few seconds.
// Its buttons are inserted as direct children of the sheet panel, just before the #host-controls
// marker, so they get the panel's button styles.
import { $ } from './dom.js';

/** @typedef {import('../../shared/game.js').State} State */

const CONFIRM_MS = 4000;

/** @param {{ send: (msg: unknown) => void }} io */
export function createHostControls(io) {
  /** Armed action key ('end' or a playerId) waiting for its confirming tap. @type {string | null} */
  let armed = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let disarmTimer;
  /** @type {{ v: State, online: readonly string[], meId: string } | null} */ let last = null;

  /** @param {string} key @param {() => void} act */
  function tap(key, act) {
    clearTimeout(disarmTimer);
    if (armed === key) { armed = null; act(); redraw(); return; }
    armed = key;
    disarmTimer = setTimeout(() => { armed = null; redraw(); }, CONFIRM_MS);
    redraw();
  }

  /** @param {string} cls @param {string} text @param {() => void} onClick */
  function button(cls, text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  /** Signature of what is on screen: views arrive on every placement, and rebuilding identical
   *  buttons between a finger's down and up would swallow the tap. */
  let shown = '';

  /** @param {HTMLElement[]} els */
  function place(els) {
    const sig = els.map((el) => el.textContent).join('|');
    if (sig === shown) return;
    shown = sig;
    const marker = $('host-controls');
    for (const old of document.querySelectorAll('.host-control')) old.remove();
    for (const el of els) { el.classList.add('host-control'); marker.before(el); }
  }

  function redraw() {
    const ctx = last;
    const show = ctx !== null && ctx.v.phase === 'playing' && ctx.v.hostId === ctx.meId;
    if (!show || !ctx) { place([]); armed = null; return; }
    const { v, online } = ctx;
    const live = new Set(online);
    const playing = v.order.filter((id) => !v.players[id].done);
    // offline first: they are the ones blocking the podium
    playing.sort((a, b) => Number(live.has(a)) - Number(live.has(b)));

    const title = document.createElement('p');
    title.className = 'dim';
    title.textContent = 'Host';
    const rows = playing.map((id) => {
      const p = v.players[id];
      const off = !live.has(id);
      const text = armed === id ? `Tap again: take ${p.name} out`
        : `${off ? '📴 ' : ''}Take ${p.name} out${off ? ' (offline)' : ''}`;
      const b = button(off ? 'danger' : '', text, () => tap(id, () => io.send({ t: 'retire', target: id })));
      b.dataset.retire = id;
      return b;
    });
    const end = button('danger', armed === 'end' ? 'Tap again to end the game' : 'End game now',
      () => tap('end', () => io.send({ t: 'endGame' })));
    end.id = 'btn-end-game';
    place([title, ...rows, end]);
  }

  return {
    /** @param {State} v @param {readonly string[]} online @param {string} meId */
    render(v, online, meId) {
      last = { v, online, meId };
      redraw();
    },
  };
}
