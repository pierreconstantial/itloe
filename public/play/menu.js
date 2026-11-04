// ☰ menu and the bottom sheets (menu, rules, invite, settings). Sheets are overlays outside
// the view switcher in main.js, so a re-render from a new `view` never closes them.
// Any element with data-open="<sheet>" opens that sheet; data-close closes them all.
import { $, pieceEl } from './dom.js';
import * as haptics from './haptics.js';
import { RULES } from './rules.js';

const SHEETS = ['menu', 'rules', 'invite', 'settings', 'gm', 'bag'];
const RULE_CELL = 10; // px per cell for rule illustrations

/**
 * @param {{ canLeave: () => boolean, onLeave: () => void, isGameMaster: () => boolean, onShowJoin: () => void }} hooks
 * @returns {{ refresh: () => void, close: (name?: string) => void, isOpen: () => boolean }}
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
    $('btn-gm').hidden = !hooks.isGameMaster();
    leaveArmed = false;
    $('btn-leave').textContent = 'Leave game';
  }

  /** @param {string} name */
  function open(name) {
    refresh();
    if (name === 'invite') loadInvite();
    for (const s of SHEETS) $(`sheet-${s}`).hidden = s !== name;
  }

  /** Closes one sheet, or all of them. @param {string} [name] */
  function close(name) {
    for (const s of SHEETS) if (!name || s === name) $(`sheet-${s}`).hidden = true;
  }

  renderRules();

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

  // the join QR: this phone shows it (the invite sheet opens via data-open) AND asks the TVs to show it
  $('btn-show-join').addEventListener('click', () => hooks.onShowJoin());

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

  const isOpen = () => SHEETS.some((s) => !$(`sheet-${s}`).hidden);

  refresh();
  return { refresh, close, isOpen };
}

/** Join URL + room code + QR from the server (GET /api/join); plain page URL if that fails. */
async function loadInvite() {
  const qr = /** @type {HTMLImageElement} */ ($('invite-qr'));
  try {
    const res = await fetch('/api/join', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const { url, code } = await res.json();
    $('invite-url').textContent = String(url);
    $('invite-code').textContent = String(code);
    $('invite-code-line').hidden = !code;
    qr.src = `/api/join-qr.svg?t=${Date.now()}`;
    qr.hidden = false;
  } catch {
    $('invite-url').textContent = `${location.origin}/play/`;
    $('invite-code-line').hidden = true;
    qr.hidden = true;
  }
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
