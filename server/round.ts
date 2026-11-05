// A running round's in-memory side: what it holds outside the saved campaign, from the round's start
// until its podium closes or a new round replaces it. The `io` handed to its minigame's server code
// belongs to that one round: once the round has ended, what the server code still does through it
// (a late verdict, a timer) is dropped, so it never reaches the next round.

import type { Campaign } from './campaign.ts';
import type { MinigameIo } from './minigames.ts';

/** The round's identity: the campaign's seed, which every round start advances; null between rounds. */
export const roundOf = (c: Campaign): number | null => (c.at.activity ? c.seed : null);

export type RoundDeps<A> = {
  apply: (action: A) => boolean,   // an action on the campaign's running round
};

export type Round<A> = { io: MinigameIo<A>, end: () => void };

export function makeRound<A>(deps: RoundDeps<A>): Round<A> {
  let ended = false;
  return {
    io: { apply: (action) => !ended && deps.apply(action) },
    end() { ended = true; },
  };
}
