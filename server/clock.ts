// Q4 — timed-mode clock. The reducer stays pure: the server owns wall time and fires
// { t:'timeUp', deadline } when a deadline passes. A stale timer is harmless: reduce ignores a
// timeUp whose deadline no longer matches, so timers are never cancelled.

import type { State } from './rules.ts';

export function makeClock(fire: (deadline: number) => void) {
  const arm = (deadline: number): void => {
    setTimeout(() => fire(deadline), Math.max(0, deadline - Date.now()));
  };
  return {
    /** Call after every state change. */
    onChange(prev: State | null, next: State): void {
      const d = next.deadline;
      if (next.phase === 'playing' && typeof d === 'number' && d !== prev?.deadline) arm(d);
    },
  };
}
