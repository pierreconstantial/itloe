// The ONE ranking rule for every podium and crown, whatever the minigame: a round's players ranked by
// score. Pure JSDoc ESM.

/** A round's players as the ranking reads them. @typedef {{ order: string[], players: Record<string, { score: number }> }} Scored */

/**
 * Score descending; equal scores SHARE a rank (standard competition ranking: 1, 1, 3);
 * display order among ties = join order. Rank 1 can be held by several co-champions.
 * @param {Scored} state
 * @returns {{ id: string, rank: number, score: number }[]} in display order
 */
export function ranking(state) {
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
