// Finished: ranking, champion highlighted. Basic; the podium sequence is M2 juice.

import { h, colorDot, playerColor, formatScore } from './dom.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/game.js').Player} Player */

const RANK_LABELS = ['🏆', '2nd', '3rd', '4th'];

/**
 * Players by score, best first; ties share a rank (1, 1, 3…).
 * @param {State} s
 * @returns {{ player: Player, rank: number }[]}
 */
export function ranking(s) {
  const sorted = s.order.map((id) => s.players[id]).sort((a, b) => b.score - a.score);
  return sorted.map((player, i) => ({
    player,
    rank: sorted.findIndex((q) => q.score === player.score) + 1,
  }));
}

/** @param {State} s */
export function renderPodium(s) {
  const list = h('ol', 'ranking');
  for (const { player: p, rank } of ranking(s)) {
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
