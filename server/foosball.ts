// Table football, server side: the live match runs here, in memory (shared/foosball.js `step`). Phones send their
// finger's position and power button (`rod`), which are kept and never saved; the match advances SIM_HZ times a
// second and goes to every phone and TV as an unsaved message SEND_HZ times a second. A goal becomes an action, so
// the score is saved; after a restart the match goes on from a serve.
//
// The loop needs the run's io, which only messages bring: it starts with the first `rod` of a running match, and
// phones send one as soon as their screen mounts.

import { holders, startLive, step, type Control, type FoosballAction, type FoosballState, type Live } from '../shared/foosball.js';
import type { MinigameIo, RoundServer } from './minigames.ts';

const SIM_HZ = 60;
const SEND_EVERY = 3; // SIM_HZ / 3 = 20 messages a second
/** The longest step taken at once, when the server was busy: the ball never jumps further. */
const MAX_DT = 0.05;

/** What a phone measured: how long its `rod` messages take to come back in the snapshots, typical and worst, in ms. */
type Lag = [number, number];

/** One match's live side. `seen`: the last `rod` number each phone sent, for its lag measurement. */
type Match = {
  seed: number, live: Live, state: FoosballState, io: MinigameIo<FoosballAction>,
  controls: Record<string, Control>, seen: Record<string, number>, lag: Record<string, Lag>,
  timer: ReturnType<typeof setInterval>, ticks: number, at: number,
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const isLag = (v: unknown): v is Lag => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n) && n >= 0 && n < 60000);

/** Table football's round server code. */
export function makeFoosballServer(): RoundServer<FoosballState, FoosballAction> {
  let match: Match | null = null;

  function stop() {
    if (match) clearInterval(match.timer);
    match = null;
  }

  function tick() {
    const m = match;
    if (!m) return;
    const now = performance.now();
    const dt = Math.min(MAX_DT, (now - m.at) / 1000);
    m.at = now;
    const { live, goal } = step(m.live, holders(m.state), m.controls, dt, m.state.settings);
    const by = m.live.last;
    m.live = live;
    // a goal is saved; the io refuses it once the match is over, and onChange stops the loop
    if (goal) m.io.apply({ t: 'goal', team: goal, by });
    if (match !== m || ++m.ticks % SEND_EVERY !== 0) return;
    m.io.send({
      t: 'foosball', at: Date.now(), serves: live.serves,
      ball: [round1(live.ball.x), round1(live.ball.y)],
      rods: { a: live.rods.a.map((p) => Math.round(p * 1000) / 1000), b: live.rods.b.map((p) => Math.round(p * 1000) / 1000) },
      armed: Object.keys(live.armed).filter((id) => live.armed[id]),
      seen: m.seen, lag: m.lag,
    });
  }

  return {
    message(msg, { id, state }, io) {
      if (msg.t !== 'rod') return { refused: 'not-playing' };
      if (!Number.isFinite(msg.y) || typeof msg.power !== 'boolean' || !state.players[id] || state.players[id].done) return null;
      if (!match || match.seed !== state.seed) {
        stop();
        match = {
          seed: state.seed, live: startLive(state.seed, state.settings), state, io, controls: {}, seen: {}, lag: {},
          timer: setInterval(tick, 1000 / SIM_HZ), ticks: 0, at: performance.now(),
        };
      }
      match.controls[id] = { y: Math.max(0, Math.min(1, msg.y)), power: msg.power };
      if (Number.isInteger(msg.n)) match.seen[id] = msg.n;
      if (isLag(msg.lag)) match.lag[id] = [Math.round(msg.lag[0]), Math.round(msg.lag[1])];
      return null;
    },

    view: ({ seed: _seed, ...shown }) => shown,

    onChange(_prev, next) {
      if (!next || next.endReason !== null || (match && match.seed !== next.seed)) { stop(); return; }
      if (match) {
        match.state = next;
        for (const id of Object.keys(match.controls)) if (next.players[id]?.done) delete match.controls[id];
      }
    },
  };
}
