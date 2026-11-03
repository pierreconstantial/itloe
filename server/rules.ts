// The server's single door to shared/game.js. Server-only reducer inputs live here:
// `now` on start/again, `timeUp`, `config` with the sender's id — never taken from the wire.
// The Q4 shapes (settings, deadline, config/timeUp actions, initState's 2nd param) are typed locally
// until P1's shared implementation lands; then the widening below collapses to plain re-exports.

import { initState as sharedInit, reduce as sharedReduce, ranking } from '../shared/game.js';

export { ranking };

export type Settings = Record<string, unknown>;

export type State = ReturnType<typeof sharedInit> & {
  settings?: Settings,
  deadline?: number | null,
};

type SharedAction = Parameters<typeof sharedReduce>[1];

export type ServerAction =
  | Exclude<SharedAction, { t: 'start' } | { t: 'again' }>
  | { t: 'start', id: string, now: number }
  | { t: 'again', id: string, now: number }
  | { t: 'config', id: string, patch: Settings }
  | { t: 'timeUp', deadline: number };

export function initState(seed: number, settings?: Settings): State {
  return (sharedInit as (seed: number, settings?: Settings) => State)(seed, settings);
}

/** Pure; invalid or no-op actions return `state` itself (reference-equal). */
export function reduce(state: State, action: ServerAction): State {
  return sharedReduce(state, action as SharedAction) as State;
}
