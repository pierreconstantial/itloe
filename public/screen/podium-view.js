// Finished: ranking with a staged reveal (last place → … → champion(s)).
// The reveal is driven by `elapsedMs` since the game ended, so a re-render mid-sequence resumes
// where it was (negative CSS delays) instead of restarting; elapsed = Infinity shows it settled.

import { ranking } from '../../shared/game.js';
import { h, colorDot, playerColor, formatScore } from './dom.js';
import { summarizeSettings } from '../commun/settings-text.js';

/** @typedef {import('../../shared/game.js').State} State */

const RANK_LABELS = ['🏆', '2nd', '3rd', '4th'];
const FIRST_STEP_MS = 700;
const STEP_MS = 1100;
const CHAMPION_PAUSE_MS = 600;

/** Line under the title, by how the game ended (no line when it ran its natural course). */
const ENDINGS = /** @type {Record<string, string>} */ ({ host: 'Game ended by the host' });

/**
 * When each ranking row appears, in ranking order (same order as `ranking(s)`).
 * One step per rank, worst rank first; tied players appear together; the champion(s) come
 * last after a short pause.
 * @param {State} s
 * @returns {{ id: string, rank: number, atMs: number }[]}
 */
export function revealSchedule(s) {
  const rows = ranking(s);
  const lowerRanks = [...new Set(rows.map((r) => r.rank).filter((k) => k > 1))].sort((a, b) => b - a);
  const championAt = FIRST_STEP_MS + lowerRanks.length * STEP_MS + (lowerRanks.length ? CHAMPION_PAUSE_MS : 0);
  return rows.map((r) => ({
    id: r.id,
    rank: r.rank,
    atMs: r.rank === 1 ? championAt : FIRST_STEP_MS + lowerRanks.indexOf(r.rank) * STEP_MS,
  }));
}

/**
 * @param {State} s
 * @param {number} elapsedMs time since the game finished (Infinity = no animation)
 */
export function renderPodium(s, elapsedMs = Infinity) {
  const schedule = revealSchedule(s);
  const lastAt = Math.max(...schedule.map((r) => r.atMs));
  /** @param {HTMLElement} el @param {number} atMs */
  const delay = (el, atMs) => el.style.setProperty('--delay', `${atMs - Math.min(elapsedMs, 1e9)}ms`);

  const list = h('ol', 'ranking');
  for (const { id, rank, atMs } of schedule) {
    const p = s.players[id];
    const row = h('li', 'rank-row reveal' + (rank === 1 ? ' champion' : ''), [
      h('span', 'rank', [RANK_LABELS[rank - 1] ?? `${rank}th`]),
      colorDot(p.color),
      h('span', 'rank-name', [p.name, ...(/** @type {{ retired?: boolean }} */ (p).retired ? [h('span', 'out-tag', ['out'])] : [])]),
      h('span', 'rank-score', [formatScore(p.score)]),
    ]);
    row.style.setProperty('--pc', playerColor(p.color));
    delay(row, atMs);
    list.append(row);
  }
  const title = h('h1', 'title reveal', ['Podium']);
  delay(title, 0);
  const ending = s.endReason ? ENDINGS[s.endReason] : undefined;
  const sub = ending ? [h('p', 'podium-ending reveal', [ending])] : [];
  for (const el of sub) delay(el, 0);
  const hint = h('p', 'podium-hint reveal', ["Play again on the host's phone"]);
  delay(hint, lastAt + 1200);
  const next = h('p', 'settings-line reveal', [`Next game: ${summarizeSettings(s.settings)}`]);
  delay(next, lastAt + 1200);
  return h('section', 'podium', [title, ...sub, list, hint, next]);
}
