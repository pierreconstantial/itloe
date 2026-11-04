// Pure: what happened between two consecutive views. The screen's juice (sound, particles,
// call-outs, shake) reacts to these events; rendering itself stays a pure function of the state.

import { clearedCells } from './game-view.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('../../shared/game.js').Player} Player */

/**
 * @typedef {{
 *   id: string, color: number,
 *   cleared: Map<number, number>,   // cell index → colour it had
 *   rows: number[], cols: number[], // lines cleared by this move
 *   lines: number,
 *   gained: number, streak: number, cleanBoard: boolean,
 * }} Move
 *
 * @typedef {{ t: 'joined', id: string }
 *   | { t: 'start' }
 *   | { t: 'move', move: Move }
 *   | { t: 'done', id: string }
 *   | { t: 'finished', reason: State['endReason'] }} ScreenEvent
 */

/**
 * The move a player made between two views, from the Player.last record (reduce writes it;
 * last.n changes once per placement, so an event can never fire twice).
 * @param {Player} prev
 * @param {Player} next
 * @returns {Move | null}
 */
export function detectMove(prev, next) {
  const last = next.last;
  if (!last || last.n === prev.last?.n) return null;
  return {
    id: next.id,
    color: next.color,
    cleared: clearedCells(prev.board, last.rows, last.cols, next.color),
    rows: last.rows,
    cols: last.cols,
    lines: last.rows.length + last.cols.length,
    gained: last.gained,
    streak: last.streak,
    cleanBoard: last.cleanBoard,
  };
}

/**
 * @param {State | null} prev
 * @param {State} next
 * @returns {ScreenEvent[]}
 */
export function detectEvents(prev, next) {
  if (!prev) return [];
  /** @type {ScreenEvent[]} */
  const events = [];

  if (prev.phase === 'lobby' && next.phase === 'lobby') {
    for (const id of next.order) if (!prev.order.includes(id)) events.push({ t: 'joined', id });
  }
  if (prev.phase !== 'playing' && next.phase === 'playing') events.push({ t: 'start' });

  const sameGame = prev.phase === 'playing' && next.phase !== 'lobby' && prev.seed === next.seed;
  if (sameGame) {
    for (const id of next.order) {
      const p = prev.players[id];
      const n = next.players[id];
      if (!p || !n) continue;
      const move = detectMove(p, n);
      if (move) events.push({ t: 'move', move });
      if (!p.done && n.done) events.push({ t: 'done', id });
    }
  }
  if (prev.phase === 'playing' && next.phase === 'finished') events.push({ t: 'finished', reason: next.endReason });
  return events;
}

const LINE_WORDS = ['', '', 'Double line!', 'Triple line!', 'Quad line!'];

/**
 * Call-out lines for a move, biggest first. Empty = nothing to celebrate.
 * @param {Move} m
 * @returns {string[]}
 */
export function calloutsFor(m) {
  /** @type {string[]} */
  const out = [];
  if (m.cleanBoard) out.push('Clean board!');
  if (m.lines >= 2) out.push(LINE_WORDS[m.lines] ?? `${m.lines} lines!`);
  if (m.lines > 0 && m.streak >= 2) out.push(`Combo ×${m.streak}!`);
  return out;
}
