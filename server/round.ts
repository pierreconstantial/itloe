// A running minigame's in-memory side: what it holds outside the saved campaign, from the game master's
// start until his end. The `io` handed to its server code belongs to that one run: once it has ended, what
// the server code still does through it (a late verdict, an unsaved message from a timer) is dropped, so it
// never reaches the next run.

import type { Campaign } from './campaign.ts';
import type { MinigameIo } from './minigames.ts';

/** The running minigame's identity: the campaign's seed, which every minigame start advances; null while none runs. */
export const roundOf = (c: Campaign): number | null => (c.at.activity ? c.seed : null);

export type RoundDeps<A> = {
  apply: (action: A) => boolean,   // an action on the campaign's running minigame
  sendAll: (msg: object) => void,  // to every phone and TV
};

export type Round<A> = {
  io: MinigameIo<A>,
  end: () => void,
};

export function makeRound<A>(deps: RoundDeps<A>): Round<A> {
  let ended = false;
  return {
    io: {
      apply: (action) => !ended && deps.apply(action),
      send: (data) => { if (!ended) deps.sendAll({ t: 'unsaved', data }); },
    },
    end() { ended = true; },
  };
}
