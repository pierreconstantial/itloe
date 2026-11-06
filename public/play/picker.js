// Character picker (M3; slice 2b: the character IS the identity). Built from the shared roster, so a
// new character appears with no change here. Each card is in one of three states, live from each view:
//  - free: nobody holds it → a new party member (during a round, they watch);
//  - continue: held by a player whose phone is offline → tapping takes that player back (same board,
//    score, hand), from any device and in any phase;
//  - taken: held by an online player → greyed.
import { CHARACTERS } from '../../shared/characters.js';
import { $ } from './dom.js';
import { avatarCanvas } from './avatar.js';

/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** @typedef {'free' | 'continue' | 'taken'} PickState */

const PICKER_SCALE = 5; // 16 px sprites → 80 px

/**
 * Who holds which character: the campaign party (slice 3, exists on the hub too) or, without a
 * campaign, the block State's players. Both have this shape.
 * @typedef {{ order: string[], players: Record<string, { character: CharacterId, left?: boolean }> }} Roster
 */

/**
 * The state of every character for a phone that is not (or no longer) a member.
 * @param {Roster} roster
 * @param {readonly string[]} online member ids with a live socket
 * @returns {Map<CharacterId, PickState>}
 */
export function pickStates(roster, online) {
  const live = new Set(online);
  /** @type {Map<string, string>} character → holding id (left members hold nothing) */
  const holders = new Map();
  for (const id of roster.order) {
    const p = roster.players[id];
    if (p && !p.left) holders.set(p.character, id);
  }
  /** @type {Map<CharacterId, PickState>} */
  const states = new Map();
  for (const c of Object.values(CHARACTERS)) {
    const holder = holders.get(c.id);
    if (holder) states.set(c.id, live.has(holder) ? 'taken' : 'continue');
    else states.set(c.id, 'free');
  }
  return states;
}

/** Is there anything this phone can tap? @param {Map<CharacterId, PickState>} states */
export function anyPickable(states) {
  return [...states.values()].some((s) => s !== 'taken');
}

/** @type {Record<PickState, string>} */
const BADGES = { free: '', continue: 'Continue', taken: 'Taken' };

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
  const cont = /** @type {HTMLButtonElement} */ ($('btn-continue'));
  /** @type {CharacterId | null} */ let offered = null;
  cont.addEventListener('click', () => { if (offered && !cont.disabled) hooks.onPick(offered); });

  return {
    /**
     * @param {Map<CharacterId, PickState>} states from pickStates()
     * @param {CharacterId | null} pending a pick sent and not answered yet (all cards wait)
     * @param {CharacterId | null} last this phone's previous character: offered first when pickable
     */
    render(states, pending, last) {
      offered = last !== null && states.get(last) !== 'taken' ? last : null;
      cont.hidden = offered === null;
      cont.disabled = pending !== null;
      if (offered) cont.textContent = pending === offered ? 'Joining…' : `Continue as ${CHARACTERS[offered].name}`;
      $('pick-prompt').textContent = offered ? 'Or pick someone else:' : 'Who are you tonight?';
      for (const [id, card] of cards) {
        const st = states.get(id) ?? 'taken';
        card.disabled = st === 'taken' || pending !== null;
        card.classList.toggle('taken', st === 'taken');
        card.classList.toggle('pending', id === pending);
        card.classList.toggle('last', id === last && st !== 'taken');
        /** @type {HTMLElement} */ (card.querySelector('.pick-badge')).textContent =
          id === pending ? 'Joining…' : BADGES[st];
        card.setAttribute('aria-label', `${st === 'continue' ? 'Continue as ' : ''}${CHARACTERS[id].name}${st === 'taken' ? ' (taken)' : ''}`);
      }
    },
  };
}
