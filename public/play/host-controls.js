// Host controls during a game (slice 2b): a disconnected player must never block the podium.
// Lives in the ☰ menu sheet, host only, while a round runs, the same for every minigame: "Take <name> out"
// per player still playing (offline ones first and flagged), and "End game". Both are
// irreversible, so each needs a second tap to confirm (same pattern as "Leave game"); an armed button
// disarms after a few seconds.
// Its buttons are inserted as direct children of the sheet panel, just before the #host-controls
// marker, so they get the panel's button styles.
import { $ } from './dom.js';
import { createConfirm } from './confirm.js';

/** @typedef {import('../../shared/minigames.js').RoundView} RoundView */
/** @typedef {import('../../shared/minigames.js').RoundPlayers} RoundPlayers */

/** @param {{ send: (msg: unknown) => void }} io */
export function createHostControls(io) {
  /** @type {{ round: RoundView | null, online: readonly string[], meId: string, hostId: string | null } | null} */ let last = null;
  // armed key: 'end' or a playerId
  const confirm = createConfirm(() => redraw());
  const tap = confirm.tap;

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
    // exactly when the server accepts endGame: the party's host, while a round runs
    const v = ctx && ctx.hostId === ctx.meId && ctx.round?.status === 'running' ? /** @type {RoundPlayers} */ (ctx.round.view) : null;
    if (!ctx || !v) { place([]); confirm.disarm(); return; }
    const live = new Set(ctx.online);
    const playing = v.order.filter((id) => !v.players[id].done && !v.players[id].left);
    // offline first: they are the ones blocking the podium
    playing.sort((a, b) => Number(live.has(a)) - Number(live.has(b)));

    const title = document.createElement('p');
    title.className = 'dim';
    title.textContent = 'Host';
    const rows = playing.map((id) => {
      const p = v.players[id];
      const off = !live.has(id);
      const text = confirm.isArmed(id) ? `Tap again: take ${p.name} out`
        : `${off ? '📴 ' : ''}Take ${p.name} out${off ? ' (offline)' : ''}`;
      const b = button(off ? 'danger' : '', text, () => tap(id, () => io.send({ t: 'retire', target: id })));
      b.dataset.retire = id;
      return b;
    });
    const end = button('danger', confirm.isArmed('end') ? 'Tap again to end the game' : 'End game now',
      () => tap('end', () => io.send({ t: 'endGame' })));
    end.id = 'btn-end-game';
    place([title, ...rows, end]);
  }

  return {
    /**
     * @param {RoundView | null} round the running round, null between rounds
     * @param {readonly string[]} online @param {string} meId @param {string | null} hostId the party's host
     */
    render(round, online, meId, hostId) {
      last = { round, online, meId, hostId };
      redraw();
    },
  };
}
