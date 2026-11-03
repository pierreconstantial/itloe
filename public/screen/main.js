// P4 — /screen: the TV page. Renders purely from each { t: 'view', state } (PROTOCOL.md);
// juice (sound, particles, call-outs, shake) reacts to events derived from consecutive views.
// Dev console: bloko.debug('midgame' | 'finished') (mock server only), bloko.render(state).

import { renderLobby, fetchJoinInfo, fallbackJoinInfo } from './lobby-view.js';
import { renderGame } from './game-view.js';
import { renderPodium, revealSchedule } from './podium-view.js';
import { detectEvents, calloutsFor } from './events.js';
import { sfx, installAudioUnlock, onAudioState } from './audio.js';
import * as fx from './fx.js';
import { syncClock } from '../commun/clock.js';
import { updateCountdown } from './countdown.js';
import { legalPlacementCount } from '../../shared/board.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('./events.js').ScreenEvent} ScreenEvent */

const RECONNECT_MS = 1000;
/** How long "Time's up!" holds the screen before the podium reveal starts. */
const TIMES_UP_MS = 2600;

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const soundHint = /** @type {HTMLElement} */ (document.getElementById('sound-hint'));

/** @type {State | null} */
let current = null;
/** After a reconnect the previous view is stale: render, but don't replay what was missed. */
let stale = false;
/** performance.now() when the current game finished (podium sequence clock). */
let finishedAt = -Infinity;
/** @type {WebSocket | null} */
let ws = null;
/** @type {import('./lobby-view.js').JoinInfo} */
let joinInfo = fallbackJoinInfo();

/** @type {Record<State['phase'], (s: State, prev: State | null) => HTMLElement>} */
const VIEWS = {
  lobby: (s, prev) => renderLobby(s, prev, joinInfo),
  playing: (s, prev) => renderGame(s, prev, { danger: playersInDanger(s) }),
  finished: (s) => renderPodium(s, performance.now() - finishedAt),
};

/** Fewer legal placements than this (and more than 0) → the board frame pulses. */
const DANGER_BELOW = 3;

/**
 * @param {State} s
 * @returns {Set<string>}
 */
function playersInDanger(s) {
  return new Set(s.order.filter((id) => {
    const p = s.players[id];
    if (p.done) return false;
    const n = legalPlacementCount(p.board, s.size, p.hand, DANGER_BELOW);
    return n > 0 && n < DANGER_BELOW;
  }));
}

/** @param {State} next */
function show(next) {
  const prev = stale ? null : current;
  stale = false;
  current = next;
  const events = detectEvents(prev, next);
  const finished = events.find((e) => e.t === 'finished');
  if (finished) finishedAt = performance.now() + (finished.t === 'finished' && finished.reason === 'time' ? TIMES_UP_MS : 0);
  if (next.phase !== 'finished') finishedAt = -Infinity;
  if (next.phase === 'lobby') fx.clearAll();

  app.replaceChildren(VIEWS[next.phase](next, prev));
  updateCountdown(next);
  for (const e of events) react(e, next);
}

/**
 * @param {ScreenEvent} e
 * @param {State} s
 */
function react(e, s) {
  switch (e.t) {
    case 'joined':
      sfx.joined();
      break;
    case 'start':
      sfx.start();
      break;
    case 'move': {
      const m = e.move;
      sfx.place();
      fx.scoreFloater(m.id, m.gained);
      if (m.lines === 0) break;
      fx.clearEffect(m, s.size);
      fx.shake(m.lines);
      sfx.clear(m.lines);
      if (m.streak >= 2) sfx.combo(m.streak);
      if (m.cleanBoard) sfx.cleanBoard();
      fx.callout(m.id, calloutsFor(m), m.color);
      break;
    }
    case 'done':
      sfx.done();
      break;
    case 'finished':
      if (e.reason === 'time') {
        sfx.bell();
        fx.timesUp(TIMES_UP_MS);
        setTimeout(() => podiumSequence(s), TIMES_UP_MS);
      } else {
        podiumSequence(s);
      }
      break;
  }
}

/** Sounds + confetti in step with the podium's CSS reveal (same schedule). @param {State} s */
function podiumSequence(s) {
  const schedule = revealSchedule(s);
  const championAt = Math.min(...schedule.filter((r) => r.rank === 1).map((r) => r.atMs));
  const steps = new Set(schedule.filter((r) => r.rank > 1).map((r) => r.atMs));
  for (const at of steps) setTimeout(() => sfx.reveal(), at);
  setTimeout(() => {
    if (current?.phase !== 'finished') return;
    sfx.fanfare();
    fx.confetti(schedule.filter((r) => r.rank === 1).map((r) => fx.colorHex(s.players[r.id].color)).concat('#ffd166', '#ffffff'));
  }, championAt);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.addEventListener('open', () => {
    document.body.classList.remove('offline');
    sock.send(JSON.stringify({ t: 'hello', role: 'screen' }));
  });
  sock.addEventListener('message', (ev) => {
    /** @type {{ t?: string, state?: State, now?: number }} */
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg.t !== 'view' || !msg.state) return;
    syncClock(msg.now);
    show(msg.state);
  });
  sock.addEventListener('close', () => {
    document.body.classList.add('offline');
    stale = true;
    setTimeout(connect, RECONNECT_MS);
  });
}

installAudioUnlock();
onAudioState((st) => {
  soundHint.dataset.state = st;
  soundHint.textContent = st === 'locked' ? '🔇 Click anywhere for sound' : st === 'muted' ? '🔇 Muted (M)' : '';
});
connect();
fetchJoinInfo().then((info) => {
  joinInfo = info;
  if (current?.phase === 'lobby') app.replaceChildren(renderLobby(current, current, joinInfo));
});

/** @type {any} */ (window).bloko = {
  /** @param {'midgame' | 'finished'} scenario */
  debug: (scenario) => ws?.send(JSON.stringify({ t: 'debug', scenario })),
  state: () => current,
  /** @param {State} s */
  render: (s) => show(s),
};
