// Host controls during a game (slice 2b): a disconnected player must never block the podium.
// Lives in the ☰ menu sheet, host only, while a block game or quiz runs: "Take <name> out" per player
// still playing (offline ones first and flagged; block games only), and "End game". Both are
// irreversible, so each needs a second tap to confirm (same pattern as "Leave game"); an armed button
// disarms after a few seconds.
// Its buttons are inserted as direct children of the sheet panel, just before the #host-controls
// marker, so they get the panel's button styles.
import { $ } from './dom.js';
import { createConfirm } from './confirm.js';
import { quizRunning } from '../../shared/quiz/index.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/quiz/bank.js').QuizView} QuizView */

/** @param {{ send: (msg: unknown) => void }} io */
export function createHostControls(io) {
  /** @type {{ v: State | null, q: QuizView | null, online: readonly string[], meId: string } | null} */ let last = null;
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
    const v = ctx?.v ?? null, q = ctx?.q ?? null;
    // exactly when the server accepts endGame: the game's host, while it runs
    const blocks = ctx && v && v.phase === 'playing' && v.hostId === ctx.meId ? v : null;
    const quiz = !!ctx && !!q && quizRunning(q) && q.hostId === ctx.meId;
    if (!ctx || (!blocks && !quiz)) { place([]); confirm.disarm(); return; }
    const live = new Set(ctx.online);
    // a quiz has no "take out" (the server refuses retire there)
    const playing = blocks ? blocks.order.filter((id) => !blocks.players[id].done) : [];
    // offline first: they are the ones blocking the podium
    playing.sort((a, b) => Number(live.has(a)) - Number(live.has(b)));

    const title = document.createElement('p');
    title.className = 'dim';
    title.textContent = 'Host';
    const rows = !blocks ? [] : playing.map((id) => {
      const p = blocks.players[id];
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
     * @param {State | null} v the block game, null when none @param {QuizView | null} q the quiz, null when none
     * @param {readonly string[]} online @param {string} meId
     */
    render(v, q, online, meId) {
      last = { v, q, online, meId };
      redraw();
    },
  };
}
