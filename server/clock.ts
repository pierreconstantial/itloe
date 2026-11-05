// The round clock. The reducer stays pure: the server owns wall time and, when a round's deadline
// passes, fires its minigame's deadline action (blocks: timeUp, quiz: close). A stale timer is
// harmless: the minigame refuses a deadline action whose deadline no longer matches, so timers are
// never cancelled.

import { roundDeadline } from './resume.ts';
import type { Campaign } from './campaign.ts';
import type { MinigameKind } from '../shared/minigames.js';

export function makeClock(fire: (kind: MinigameKind, deadline: number) => void) {
  return {
    /** Call after every change of the campaign's round (prev: null at boot). */
    onChange(prev: Campaign['at'] | null, next: Campaign['at']): void {
      const kind = next.kind;
      const d = roundDeadline(next);
      const before = prev && prev.kind === kind ? roundDeadline(prev) : null;
      if (kind !== null && d !== null && d !== before) setTimeout(() => fire(kind, d), Math.max(0, d - Date.now()));
    },
  };
}
