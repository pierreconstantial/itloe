// 🎒 Bag (Contract F, inventory v1): MY items, read from the content's item catalogue and
// campaign.facts.inventory[my character]. Items are data: an id missing from the catalogue is not shown
// (the engine drops those on load anyway). Read-only in v1: no using, combining or trading.
import { $ } from './dom.js';
import { content } from './campaign-view.js';
import { holding } from '../../shared/campaign/index.js';
import { itemArt } from '../../shared/campaign/item-art.js';

/** @typedef {import('../../shared/campaign/types.js').Item} Item */
/** @typedef {import('../../shared/campaign/types.js').Facts} Facts */

/** The content's item catalogue (Contract F). @returns {Record<string, Item>} */
export function catalogue() {
  return content().items ?? {};
}

/**
 * A character's items, catalogue order, with counts (> 0 only).
 * @param {Facts | null} facts campaign.facts @param {string | null} character
 * @returns {{ item: Item, count: number }[]}
 */
export function itemsOf(facts, character) {
  if (!facts || !character) return [];
  return Object.values(catalogue())
    .map((item) => ({ item, count: holding(facts, character, item.id) }))
    .filter((x) => x.count > 0);
}

export function createBag() {
  return {
    /**
     * Fills the bag sheet and the bag button's badge.
     * @param {Facts | null} facts campaign.facts (null without a campaign) @param {string | null} character
     */
    render(facts, character) {
      const list = itemsOf(facts, character);
      const total = list.reduce((n, x) => n + x.count, 0);
      for (const b of document.querySelectorAll('[data-open="bag"]')) {
        b.textContent = total > 0 ? `🎒 Bag (${total})` : '🎒 Bag';
        /** @type {HTMLElement} */ (b).hidden = facts === null || !character;
      }
      const ul = $('bag-items');
      ul.replaceChildren(...list.map(({ item, count }) => {
        const li = document.createElement('li');
        li.dataset.item = item.id;
        const icon = Object.assign(document.createElement('span'), { className: 'bag-icon' });
        const art = itemArt(item.id);
        if (art) icon.append(Object.assign(document.createElement('img'), { src: art, alt: '', width: 32, height: 32 }));
        else icon.textContent = item.icon;
        const text = document.createElement('div');
        text.className = 'bag-text';
        const name = Object.assign(document.createElement('strong'), { textContent: item.name });
        if (count > 1) name.append(Object.assign(document.createElement('span'), { className: 'bag-count', textContent: ` ×${count}` }));
        text.append(name, Object.assign(document.createElement('p'), { className: 'dim', textContent: item.description }));
        li.append(icon, text);
        return li;
      }));
      $('bag-empty').hidden = list.length > 0;
    },
  };
}
