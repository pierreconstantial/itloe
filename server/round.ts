// A running round's in-memory side: what it holds outside the saved campaign, from the round's start
// until its podium closes or a new round replaces it. The `io` handed to its minigame's server code
// belongs to that one round: once the round has ended, what the server code still does through it
// (a late verdict, an unsaved message from a timer) is dropped, so it never reaches the next round.
// During the round, `pos` belongs to its minigame's game area: who may walk is the minigame's call
// (`walks`), and the positions are the round's own, apart from the room's, and dropped with it.

import type { Campaign } from './campaign.ts';
import type { MinigameIo, MinigameServer } from './minigames.ts';
import { makePositions, type Pos } from './pos.ts';

/** The round's identity: the campaign's seed, which every round start advances; null between rounds. */
export const roundOf = (c: Campaign): number | null => (c.at.activity ? c.seed : null);

export type RoundDeps<S, A> = {
  state: () => S,                  // the round's current state
  apply: (action: A) => boolean,   // an action on the campaign's running round
  sendAll: (msg: object) => void,  // to every phone and TV
  relay: (playerId: string, pos: Pos) => void,   // a position, to the screens
};

export type Round<A> = {
  io: MinigameIo<A>,
  /** The round's positions (game-area coordinates), apart from the room's. */
  positions: ReturnType<typeof makePositions<object>>,
  /** A player's `pos` during the round: kept and relayed when the minigame lets them walk; false when dropped. */
  walk: (playerId: string, pos: Pos) => boolean,
  end: () => void,
};

export function makeRound<S, A>(server: Pick<MinigameServer<S, A, any>, 'walks'>, deps: RoundDeps<S, A>): Round<A> {
  let ended = false;
  const positions = makePositions<object>();
  return {
    io: {
      apply: (action) => !ended && deps.apply(action),
      send: (data) => { if (!ended) deps.sendAll({ t: 'unsaved', data }); },
      positions: () => Object.fromEntries(positions.entries()),
    },
    positions,
    walk(playerId, pos) {
      if (ended || !server.walks?.(deps.state(), playerId)) return false;
      positions.set(playerId, pos);
      deps.relay(playerId, pos);
      return true;
    },
    end() {
      ended = true;
      positions.clear();
    },
  };
}
