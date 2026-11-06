// The plain lobby, server side: its messages to actions (shared/plain-lobby.js), the round's server inputs
// at each Start, and its view. While a round runs, every other message goes to the round's server code.
// A guest's lobby message gets not-gm, the game master's at the wrong moment refused.

import type { PlainLobbyState } from '../shared/plain-lobby.js';
import type { RoundServer, MinigameServer } from './minigames.ts';

const isPlainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** A minigame's server code: a round's server code wrapped in a plain lobby. */
export function plainLobbyServer<R, A>(round: RoundServer<R, A, any>): MinigameServer<PlainLobbyState<R>, any> {
  return {
    // actions are rebuilt field by field: ids, now and inputs never come from the wire
    message(m, ctx, io) {
      const { id, now, gameMasterId, state: s, asked } = ctx;
      const gm = id === gameMasterId;
      const refused = gm ? 'refused' : 'not-gm';
      switch (m.t) {
        case 'ready':
          if (typeof m.on !== 'boolean') return null;
          return { action: { t: 'ready', id, on: m.on }, refused: 'refused' };

        case 'config':
          // the game master's no-op patch is silent
          if (!isPlainObject(m.patch)) return null;
          if (!gm) return { refused: 'not-gm' };
          if (s.stage !== 'lobby') return { refused: 'locked' };
          return { action: { t: 'config', id, patch: m.patch } };

        case 'start':
          if (!gm || s.stage !== 'lobby') return { refused };
          return { action: { t: 'start', id, now, inputs: round.inputs?.(s.settings, asked) }, refused };

        case 'lobby':
          return { action: { t: 'lobby', id }, refused };

        case 'endGame':
          return { action: { t: 'endGame', id }, refused };

        case 'retire':
          // the game master taking out an unknown, done or left player while a round runs: a no-op, not an error
          if (typeof m.target !== 'string') return null;
          return { action: { t: 'retire', id, target: m.target }, ...(gm && s.stage === 'running' ? {} : { refused }) };

        default: // the round's own messages, while it runs
          if (s.stage !== 'running' || !s.round) return { refused: 'not-playing' };
          return round.message(m, { id, now, gameMasterId, state: s.round, asked }, io as any);
      }
    },

    view: (s) => ({ stage: s.stage, settings: s.settings, players: s.players, ready: s.ready, round: s.round ? round.view(s.round) : null }),

    onChange(prev, next) {
      const before = prev?.round ?? null, after = next?.round ?? null;
      if (before !== after) round.onChange?.(before, after);
    },
  };
}
