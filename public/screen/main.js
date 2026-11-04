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
import { createPartyRoom } from './party-room.js';
import { createPresence } from './presence.js';

/** @typedef {import('../../shared/game.js').State} State */
/** @typedef {import('./events.js').ScreenEvent} ScreenEvent */

const RECONNECT_MS = 1000;
/** Timers stopped for longer than this (laptop asleep, tab frozen) → the socket is presumed dead. */
const WAKE_GAP_MS = 5000;
/** How long "Time's up!" holds the screen before the podium reveal starts. */
const TIMES_UP_MS = 2600;

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const party = createPartyRoom(
  /** @type {HTMLCanvasElement} */ (document.getElementById('party-bg')),
  /** @type {HTMLCanvasElement} */ (document.getElementById('party-fg')),
);
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
/** Pending podium sounds/confetti: cancelled as soon as the phase leaves 'finished' (rematch, back to the room). */
const podiumTimers = new Set();

/** setTimeout tracked in podiumTimers. @param {() => void} fn @param {number} ms */
function podiumLater(fn, ms) {
  const id = setTimeout(() => { podiumTimers.delete(id); fn(); }, ms);
  podiumTimers.add(id);
}

function cancelPodium() {
  for (const id of podiumTimers) clearTimeout(id);
  podiumTimers.clear();
}

/** Who has dropped (debounced): dims their board / avatar so the host can say "tap your character". */
const presence = createPresence({ onChange: applyPresence });

/** Seated players who can be offline (a left player is gone, not offline). @param {State} s */
const seated = (s) => s.order.filter((id) => s.players[id] && !/** @type {{ left?: boolean }} */ (s.players[id]).left);

/** Marks offline players on the current DOM and in the party room, without a re-render. */
function applyPresence() {
  const off = presence.offline();
  for (const el of app.querySelectorAll('[data-id]')) {
    el.classList.toggle('is-offline', off.has(/** @type {HTMLElement} */ (el).dataset.id ?? ''));
  }
  party.setOffline(off);
}

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
  if (next.phase !== 'finished') {
    finishedAt = -Infinity;
    cancelPodium();
  }
  if (next.phase === 'lobby') fx.clearAll();

  app.replaceChildren(VIEWS[next.phase](next, prev));
  party.setPlayers(next);
  party.setVisible(next.phase === 'lobby');
  document.body.classList.toggle('party', next.phase === 'lobby');
  updateCountdown(next);
  applyPresence();
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
        podiumLater(() => podiumSequence(s), TIMES_UP_MS);
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
  for (const at of steps) podiumLater(() => sfx.reveal(), at);
  podiumLater(() => {
    sfx.fanfare();
    fx.confetti(schedule.filter((r) => r.rank === 1).map((r) => fx.colorHex(s.players[r.id].color)).concat('#ffd166', '#ffffff'));
  }, championAt);
}

/** Server → screen messages; any other `t` is ignored (forward-compatibility rule, PROTOCOL.md). */
/** @type {Record<string, (msg: any) => void>} */
const HANDLERS = {
  view: (msg) => {
    if (!msg.state) return;
    syncClock(msg.now);
    show(msg.state);
    presence.update(Array.isArray(msg.online) ? msg.online : undefined, seated(msg.state));
  },
  pos: (msg) => party.onPos(msg),
};

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  // every listener checks `ws === sock`: an abandoned socket (see reconnectNow) can never act again
  sock.addEventListener('open', () => {
    if (ws !== sock) return;
    document.body.classList.remove('offline');
    // Positions are server memory: after a reconnect its pos snapshot (or, after a server restart,
    // each phone's spawn point) is the truth — not where this TV last drew the avatars.
    party.reset();
    sock.send(JSON.stringify({ t: 'hello', role: 'screen' }));
  });
  sock.addEventListener('message', (ev) => {
    if (ws !== sock) return;
    /** @type {{ t?: string }} */
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    HANDLERS[String(msg.t)]?.(msg); // a screen is never bumped: `replaced` is not for it and is ignored
  });
  sock.addEventListener('close', () => {
    if (ws !== sock) return;
    document.body.classList.add('offline');
    stale = true;
    setTimeout(connect, RECONNECT_MS);
  });
}

/**
 * Drops the current socket and opens a new one at once. After a sleep the old socket may be
 * half-open: the server already terminated it, but this side never hears the FIN and close() can
 * hang — so it is abandoned (its listeners go inert) instead of waited for.
 * @param {string} why
 */
function reconnectNow(why) {
  const old = ws;
  ws = null;
  console.info(`[bloko] reconnecting (${why})`);
  document.body.classList.add('offline');
  stale = true;
  try { old?.close(); } catch { /* already closing */ }
  connect();
}

// Wake detection: timers do not run while the laptop sleeps (or the tab is frozen), wall time does.
// Hidden tabs are skipped (Chrome throttles their timers to ~1/min, which is not a sleep);
// a tab shown again after a long hide reconnects instead.
let lastTick = Date.now();
let hiddenAt = 0;
setInterval(() => {
  const t = Date.now();
  if (t - lastTick > WAKE_GAP_MS && document.visibilityState === 'visible') {
    reconnectNow(`woke after ${Math.round((t - lastTick) / 1000)} s`);
  }
  lastTick = t;
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  const away = Date.now() - hiddenAt;
  lastTick = Date.now();
  if (hiddenAt && away > WAKE_GAP_MS) reconnectNow(`shown again after ${Math.round(away / 1000)} s`);
});
addEventListener('online', () => reconnectNow('network back'));

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
  /** Feed a fake `pos` (self-tests before the server relays them). @param {object} m */
  pos: (m) => party.onPos(m),
  avatars: () => party.snapshot(),
  offline: () => [...presence.offline()],
  /** Tests: simulate a wake from sleep. */
  wake: () => reconnectNow('debug wake'),
};
