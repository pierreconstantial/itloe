// Finished: ranking, champion highlighted. Basic; the podium sequence is M2 juice.

import { ranking } from '../../shared/game.js';
import { h, colorDot, playerColor, formatScore } from './dom.js';

/** @typedef {import('../../shared/game.js').State} State */

const RANK_LABELS = ['🏆', '2nd', '3rd', '4th'];

/** @param {State} s */
export function renderPodium(s) {
  const list = h('ol', 'ranking');
  for (const { id, rank } of ranking(s)) {
    const p = s.players[id];
    const row = h('li', 'rank-row' + (rank === 1 ? ' champion' : ''), [
      h('span', 'rank', [RANK_LABELS[rank - 1] ?? `${rank}th`]),
      colorDot(p.color),
      h('span', 'rank-name', [p.name]),
      h('span', 'rank-score', [formatScore(p.score)]),
    ]);
    row.style.setProperty('--pc', playerColor(p.color));
    list.append(row);
  }
  return h('section', 'podium', [
    h('h1', 'title', ['Podium']),
    list,
    h('p', 'podium-hint', ["Play again on the host's phone"]),
  ]);
}
