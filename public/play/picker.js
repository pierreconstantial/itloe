// Character picker (M3, replaces name entry). Built from the shared roster, so a new character
// appears with no change here; taken characters are greyed live from each view.
import { CHARACTERS, freeCharacters } from '../../shared/characters.js';
import { $ } from './dom.js';
import { avatarCanvas } from './avatar.js';

/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** @typedef {import('../../shared/game.js').State} State */

const PICKER_SCALE = 5; // 16 px sprites → 80 px

/** @param {{ onPick: (id: CharacterId) => void }} hooks */
export function createPicker(hooks) {
  /** @type {Map<CharacterId, HTMLButtonElement>} */
  const cards = new Map();

  function build() {
    const grid = $('picker-grid');
    grid.replaceChildren();
    cards.clear();
    for (const c of Object.values(CHARACTERS)) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `pick-card c${c.color}`;
      card.dataset.id = c.id;
      const name = document.createElement('span');
      name.className = 'pick-name';
      name.textContent = c.name;
      const badge = document.createElement('span');
      badge.className = 'pick-badge';
      card.append(avatarCanvas(c.id, PICKER_SCALE), name, badge);
      card.addEventListener('click', () => { if (!card.disabled) hooks.onPick(c.id); });
      grid.append(card);
      cards.set(c.id, card);
    }
  }

  build();

  return {
    /**
     * @param {State} state
     * @param {CharacterId | null} pending a pick sent and not answered yet (all cards wait)
     * @param {CharacterId | null} last this phone's previous character, highlighted
     */
    render(state, pending, last) {
      const free = new Set(freeCharacters(state));
      for (const [id, card] of cards) {
        const taken = !free.has(id);
        card.disabled = taken || pending !== null;
        card.classList.toggle('taken', taken);
        card.classList.toggle('pending', id === pending);
        card.classList.toggle('last', id === last && !taken);
        /** @type {HTMLElement} */ (card.querySelector('.pick-badge')).textContent =
          taken ? 'Taken' : id === pending ? 'Joining…' : id === last ? 'Last time' : '';
        card.setAttribute('aria-label', `${CHARACTERS[id].name}${taken ? ' (taken)' : ''}`);
      }
    },
  };
}
