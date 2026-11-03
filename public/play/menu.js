// ☰ menu and its sheets (menu, rules, invite). Sheets are overlays outside the view
// switcher in main.js, so a re-render from a new `view` never closes them.
// Any element with data-open="<sheet>" opens that sheet; data-close closes them all.
import { $, pieceEl } from './dom.js';
import * as haptics from './haptics.js';
import { RULES } from './rules.js';

const SHEETS = ['menu', 'rules', 'invite'];
const RULE_CELL = 10; // px per cell for rule illustrations

/**
 * @param {{ canLeave: () => boolean, onLeave: () => void }} hooks
 * @returns {{ refresh: () => void }}
 */
export function initMenu(hooks) {
  let leaveArmed = false;

  function refresh() {
    const vib = /** @type {HTMLButtonElement} */ ($('btn-vibrate'));
    vib.disabled = !haptics.supported;
    vib.textContent = !haptics.supported
      ? 'Vibration: not on this phone'
      : `Vibration: ${haptics.isEnabled() ? 'on' : 'off'}`;
    $('btn-leave').hidden = !hooks.canLeave();
    leaveArmed = false;
    $('btn-leave').textContent = 'Leave game';
  }

  /** @param {string} name */
  function open(name) {
    refresh();
    for (const s of SHEETS) $(`sheet-${s}`).hidden = s !== name;
  }

  function close() {
    for (const s of SHEETS) $(`sheet-${s}`).hidden = true;
  }

  renderRules();
  $('invite-url').textContent = `${location.origin}/play/`;

  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const opener = e.target.closest('[data-open]');
    if (opener instanceof HTMLElement && opener.dataset.open) { open(opener.dataset.open); return; }
    if (e.target.closest('[data-close]')) close();
  });
  for (const s of SHEETS) {
    const sheet = $(`sheet-${s}`);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); }); // backdrop tap
  }

  $('btn-vibrate').addEventListener('click', () => {
    haptics.setEnabled(!haptics.isEnabled());
    haptics.buzz('place'); // feel it right away when switching on
    refresh();
  });

  $('btn-leave').addEventListener('click', () => {
    if (!leaveArmed) {
      leaveArmed = true;
      $('btn-leave').textContent = 'Tap again to leave';
      return;
    }
    close();
    hooks.onLeave();
  });

  refresh();
  return { refresh };
}

function renderRules() {
  const ul = $('rules-list');
  ul.replaceChildren();
  RULES.forEach(({ piece, text }, i) => {
    const li = document.createElement('li');
    const icon = document.createElement('div');
    icon.className = 'rule-icon';
    icon.append(pieceEl(piece, (i % 4) + 1, RULE_CELL));
    const p = document.createElement('p');
    p.textContent = text;
    li.append(icon, p);
    ul.append(li);
  });
}
