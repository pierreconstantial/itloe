// The ONE ranking rule for every podium and crown, whatever the minigame: a round's players ranked by
// score. Pure JSDoc ESM.

/**
 * A round's players as the ranking reads them. `rank`: set by a minigame whose ranking isn't its players'
 * scores (Pyramide's teams), once its round is on the podium.
 * @typedef {{ order: string[], players: Record<string, { score: number, rank?: number }> }} Scored
 */

/**
 * Score descending; equal scores SHARE a rank (standard competition ranking: 1, 1, 3);
 * display order among ties = join order. Rank 1 can be held by several co-champions. When every player has a
 * `rank` of its own, those are used as given, in rank order.
 * @param {Scored} state
 * @returns {{ id: string, rank: number, score: number }[]} in display order
 */
export function ranking(state) {
  if (state.order.length > 0 && state.order.every((id) => Number.isInteger(state.players[id].rank))) {
    const rank = (/** @type {string} */ id) => /** @type {number} */ (state.players[id].rank);
    return [...state.order]
      .sort((a, b) => rank(a) - rank(b) || state.order.indexOf(a) - state.order.indexOf(b))
      .map((id) => ({ id, rank: rank(id), score: state.players[id].score }));
  }
  const ordered = [...state.order].sort(
    (a, b) =>
      state.players[b].score - state.players[a].score ||
      state.order.indexOf(a) - state.order.indexOf(b)
  );
  let prevScore = NaN;
  let prevRank = 0;
  return ordered.map((id, i) => {
    const score = state.players[id].score;
    const rank = score === prevScore ? prevRank : i + 1;
    prevScore = score;
    prevRank = rank;
    return { id, rank, score };
  });
}
