// Table football: two teams of players, each moving rods from their phone, a slow ball on the TV
// (docs/foosball-brief.md). Two parts:
// - the round's rules for the plain lobby: the teams, the score and the end, saved like every minigame's;
// - the live match, which the server code runs in memory (server/foosball.ts): the ball and the rods, advanced by
//   `step`. Only goals reach the saved state, as actions.
// Pure JSDoc ESM, no I/O, no clock, no randomness outside the seed.
//
// Actions (ids injected by the server, never from the wire):
//   goal { team, by }    the server code's live match: `team` scored; `by`: the player whose rod touched it last
//   leave { id }         someone stopped being eligible, or was taken out: their rods pass to their teammates;
//                        a team with nobody left loses, and the match ends
//   endGame { id }       the game master: the match ends with the score so far
// A refused action returns the same state.

import { CHARACTERS } from './characters.js';
import { mulberry32 } from './rng.js';
import { ranking } from './ranking.js';
import { mergeBySchema, settingsProblems } from './settings.js';

/** @typedef {import('./characters.js').CharacterId} CharacterId */
/** @typedef {'a' | 'b'} Team */
/**
 * The tuning the game master sets in the lobby, in centimetres and seconds: a kick's speed, a power shot's, the
 * ball's top speed, the serve's speed, the speed lost per second rolling, how many men the midfield rods have, what a
 * man hit from behind does (`block`: the ball bounces off his back; `kick`: he kicks it on, past him), and how long
 * a dead ball waits before it is served again.
 * @typedef {{ kick: number, power: number, maxSpeed: number, serve: number, friction: number, midfieldMen: number,
 *   behind: 'block' | 'kick', deadAfter: number }} FoosballSettings
 */
/**
 * @typedef {{ character: CharacterId, name: string, color: number, team: Team, score: number,
 *   left?: boolean, done?: boolean }} FoosballPlayer
 */
/**
 * A match. `players[id].score`: their team's goals, so the shared ranking puts a team's players together;
 * `goals`: every goal in order, with the player whose rod touched the ball last.
 * @typedef {{
 *   kind: 'foosball', seed: number, settings: FoosballSettings,
 *   order: string[], players: Record<string, FoosballPlayer>,
 *   score: Record<Team, number>, goals: { team: Team, by: string | null }[],
 *   endReason: 'gm' | 'left' | null,
 * }} FoosballState
 */
/**
 * @typedef {{ t: 'goal', team: Team, by: string | null }
 *   | { t: 'leave', id: string }
 *   | { t: 'endGame', id: string }
 *   | { t: 'timeUp', deadline: number }} FoosballAction
 */

export const TEAMS = /** @type {const} */ (['a', 'b']);
export const MIN_PLAYERS = 2;
/** Three a team: each holds at least one rod. */
export const MAX_PLAYERS = 6;
/** How the screens name and colour the teams. */
export const TEAM_NAMES = Object.freeze({ a: 'Blue', b: 'Red' });
export const TEAM_COLORS = Object.freeze({ a: '#3d8bfd', b: '#f0524f' });

// ---------------------------------------------------------------- the table

/**
 * The live match's fixed values, in centimetres and seconds; the rest is in the settings. The table is 120 × 68,
 * team a defends the left goal (x = 0), team b the right one.
 */
export const TUNING = Object.freeze({
  width: 120, height: 68, goal: 20,
  ballRadius: 1.75,
  /** A man's reach: half his width across the table (y) and half his thickness along it (x). */
  manHalfWidth: 2.2, manHalfThickness: 1.4,
  /** How fast a rod follows its player's finger, in rod travels per second. */
  rodSpeed: 4,
  /** The steepest kick, at a man's edge. */
  maxAngle: (50 * Math.PI) / 180,
  /** Speed kept on a bounce. */
  bounce: 0.85,
  /** A ball slower than this is dead (served again after the settings' `deadAfter`). */
  deadSpeed: 4,
});

/**
 * The rods of a team, by role: goalie, defence, midfield, attack. Their men, the gap between them, and how far they
 * slide. The midfield's men and gap come from the settings (rodMen).
 */
export const ROLES = Object.freeze([
  { name: 'goalie', x: 7.5, men: 1, gap: 0, lo: 20, hi: 48 },
  { name: 'defence', x: 22.5, men: 2, gap: 24, lo: 3, hi: 65 },
  { name: 'midfield', x: 52.5, men: 3, gap: 20, lo: 3, hi: 65 },
  { name: 'attack', x: 82.5, men: 3, gap: 21, lo: 3, hi: 65 },
]);

/** Which roles each player of a team holds, by how many players the team has (in party order). */
const SPLITS = /** @type {Record<number, number[][]>} */ ({
  1: [[0, 1, 2, 3]],
  2: [[0, 1], [2, 3]],
  3: [[0, 1], [2], [3]],
});

/** Which way a team shoots along x. @param {Team} team */
export const attacks = (team) => (team === 'a' ? 1 : -1);

/** A rod's x on the table: team b's are mirrored. @param {Team} team @param {number} role */
export const rodX = (team, role) => (team === 'a' ? ROLES[role].x : TUNING.width - ROLES[role].x);

/** A rod's men and the gap between them: the midfield's as set, spread like the real table's five 12 cm apart. @param {number} role @param {FoosballSettings} settings */
export function rodMen(role, settings) {
  const r = ROLES[role];
  if (r.name !== 'midfield') return { men: r.men, gap: r.gap };
  return { men: settings.midfieldMen, gap: settings.midfieldMen > 1 ? 60 / settings.midfieldMen : 0 };
}

/** The y of each man of a rod at position `p` (0: top, 1: bottom). @param {number} role @param {number} p @param {FoosballSettings} settings */
export function menY(role, p, settings) {
  const { lo, hi } = ROLES[role];
  const { men, gap } = rodMen(role, settings);
  const first = lo + p * (hi - lo - (men - 1) * gap);
  return Array.from({ length: men }, (_, i) => first + i * gap);
}

/**
 * Who holds each rod: for each team, its playing players in party order, split by SPLITS. A player beyond the
 * third of a team holds none.
 * @param {FoosballState} s @returns {Record<Team, (string | null)[]>}
 */
export function holders(s) {
  /** @param {Team} team */
  const of = (team) => {
    const ids = s.order.filter((id) => s.players[id].team === team && !s.players[id].done);
    const rods = /** @type {(string | null)[]} */ ([null, null, null, null]);
    (SPLITS[Math.min(ids.length, 3)] ?? []).forEach((roles, i) => { for (const role of roles) rods[role] = ids[i]; });
    return rods;
  };
  return { a: of('a'), b: of('b') };
}

// ---------------------------------------------------------------- the live match

/**
 * The live match, in the server code's memory, never saved. `t`: seconds since it began; `rods`: each team's
 * rod positions (0: top, 1: bottom), by role; `held`: whose power
 * button is down; `armed`: whose next touch is a power shot (pressed since their last one); `still`: seconds
 * the ball has been dead; `serves`: serves so far (each one's direction comes from the seed and this count);
 * `last`: the player whose rod touched the ball last.
 * @typedef {{
 *   seed: number, t: number,
 *   ball: { x: number, y: number, vx: number, vy: number },
 *   rods: Record<Team, number[]>,
 *   held: Record<string, boolean>, armed: Record<string, boolean>,
 *   still: number, serves: number, last: string | null,
 * }} Live
 */
/** What a player's phone says: their finger's position on the strip (0: top, 1: bottom), and the power button. @typedef {{ y: number, power: boolean }} Control */

/** The ball in the middle, rolling a way the seed picks. @param {Live} live @param {FoosballSettings} settings @returns {Live} */
export function serve(live, settings) {
  const rnd = mulberry32(live.seed + live.serves * 7919);
  const angle = (rnd() - 0.5) * Math.PI / 3 + (rnd() < 0.5 ? 0 : Math.PI);
  return {
    ...live,
    ball: { x: TUNING.width / 2, y: TUNING.height / 2, vx: settings.serve * Math.cos(angle), vy: settings.serve * Math.sin(angle) },
    still: 0, serves: live.serves + 1, last: null,
  };
}

/** A live match, served. @param {number} seed @param {FoosballSettings} settings @returns {Live} */
export function startLive(seed, settings) {
  return serve({
    seed, t: 0, ball: { x: 0, y: 0, vx: 0, vy: 0 },
    rods: { a: [0.5, 0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5, 0.5] },
    held: {}, armed: {}, still: 0, serves: 0, last: null,
  }, settings);
}

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.max(lo, Math.min(hi, v));

/**
 * The live match `dt` seconds later: the rods follow their holders' fingers, the ball rolls, bounces off the
 * walls, is kicked by the men it touches (from behind, as the settings say), and may go in. `goal`: the team that scored, then the ball is
 * served again. Pure: the same match, controls and time give the same result.
 * @param {Live} live @param {Record<Team, (string | null)[]>} rodHolders @param {Record<string, Control>} controls @param {number} dt
 * @param {FoosballSettings} settings
 * @returns {{ live: Live, goal: Team | null }}
 */
export function step(live, rodHolders, controls, dt, settings) {
  const T = TUNING;
  const held = { ...live.held }, armed = { ...live.armed };
  for (const [id, c] of Object.entries(controls)) {
    if (c.power && !held[id]) armed[id] = true;
    if (!c.power) armed[id] = false;
    held[id] = c.power;
  }
  /** @type {Record<Team, number[]>} */
  const rods = { a: [], b: [] };
  for (const team of TEAMS) {
    live.rods[team].forEach((p, role) => {
      const id = rodHolders[team][role];
      const target = id && controls[id] ? clamp(controls[id].y, 0, 1) : p;
      const most = T.rodSpeed * dt;
      rods[team][role] = p + clamp(target - p, -most, most);
    });
  }

  let { x, y, vx, vy } = live.ball;
  let last = live.last;
  // slowed by rolling
  const speed0 = Math.hypot(vx, vy);
  if (speed0 > 0) {
    const slowed = Math.max(0, speed0 - settings.friction * dt) / speed0;
    vx *= slowed; vy *= slowed;
  }
  // in small steps, so the ball never passes through a man
  const steps = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / 0.5));
  const h = dt / steps;
  const r = T.ballRadius;
  const mouth = (/** @type {number} */ yy) => Math.abs(yy - T.height / 2) < T.goal / 2;
  for (let i = 0; i < steps; i++) {
    x += vx * h; y += vy * h;
    if (y < r) { y = r; vy = Math.abs(vy) * T.bounce; }
    if (y > T.height - r) { y = T.height - r; vy = -Math.abs(vy) * T.bounce; }
    if (x < 0 && mouth(y)) return { live: serve({ ...live, t: live.t + dt, rods, held, armed }, settings), goal: 'b' };
    if (x > T.width && mouth(y)) return { live: serve({ ...live, t: live.t + dt, rods, held, armed }, settings), goal: 'a' };
    if (x < r && !mouth(y)) { x = r; vx = Math.abs(vx) * T.bounce; }
    if (x > T.width - r && !mouth(y)) { x = T.width - r; vx = -Math.abs(vx) * T.bounce; }
    for (const team of TEAMS) {
      for (let role = 0; role < 4; role++) {
        const mx = rodX(team, role), dir = attacks(team);
        if (Math.abs(x - mx) > T.manHalfThickness + r) continue;
        const man = menY(role, rods[team][role], settings).find((my) => Math.abs(y - my) <= T.manHalfWidth + r);
        if (man === undefined) continue;
        const id = rodHolders[team][role];
        last = id;
        // the ball ends up just clear of the man, on the side it touched him from, so it never passes through him
        if ((x - mx) * dir < 0 && settings.behind === 'block') {
          // from behind: it bounces off his back
          x = mx - dir * (T.manHalfThickness + r + 0.01);
          if (vx * dir > 0) vx = -vx * T.bounce;
          continue;
        }
        // from the front: kicked toward the other goal, steeper the further from the man's middle
        const power = id !== null && armed[id] === true;
        if (power && id !== null) armed[id] = false;
        const angle = clamp((y - man) / (T.manHalfWidth + r), -1, 1) * T.maxAngle;
        const v = Math.min(power ? settings.power : settings.kick, settings.maxSpeed);
        vx = dir * v * Math.cos(angle); vy = v * Math.sin(angle);
        x = mx + dir * (T.manHalfThickness + r + 0.01);
      }
    }
  }
  const still = Math.hypot(vx, vy) < T.deadSpeed ? live.still + dt : 0;
  const next = { ...live, t: live.t + dt, ball: { x, y, vx, vy }, rods, held, armed, still, last };
  return { live: still >= settings.deadAfter ? serve(next, settings) : next, goal: null };
}

// ---------------------------------------------------------------- the round's rules

/** @type {FoosballSettings} */
export const FOOSBALL_DEFAULTS = Object.freeze({
  kick: 40, power: 75, maxSpeed: 80, serve: 25, friction: 2, midfieldMen: 3, behind: /** @type {const} */ ('block'), deadAfter: 2,
});

/** The settings, as a schema (a settings sheet reads it). */
export const FOOSBALL_SETTINGS_SCHEMA = Object.freeze({
  kick: { kind: /** @type {const} */ ('range'), min: 15, max: 100, step: 5 },
  power: { kind: /** @type {const} */ ('range'), min: 30, max: 200, step: 5 },
  maxSpeed: { kind: /** @type {const} */ ('range'), min: 30, max: 200, step: 10 },
  serve: { kind: /** @type {const} */ ('range'), min: 10, max: 60, step: 5 },
  friction: { kind: /** @type {const} */ ('range'), min: 0, max: 20, step: 1 },
  midfieldMen: { kind: /** @type {const} */ ('range'), min: 1, max: 5, step: 1 },
  behind: { kind: /** @type {const} */ ('choice'), values: /** @type {readonly ('block' | 'kick')[]} */ (['block', 'kick']) },
  deadAfter: { kind: /** @type {const} */ ('range'), min: 1, max: 5, step: 1 },
});

/** `base` with every valid key of `patch`. @param {FoosballSettings} base @param {unknown} patch @returns {FoosballSettings} */
export const mergeFoosballSettings = (base, patch) => mergeBySchema(FOOSBALL_SETTINGS_SCHEMA, base, patch);

/** The settings in one line, for the lobby. @param {FoosballSettings} s */
export const summarizeFoosballSettings = (s) =>
  `Kick ${s.kick} · power ${s.power} · top ${s.maxSpeed} · serve ${s.serve} · rolling −${s.friction} · ${s.midfieldMen} midfielders`
  + ` · from behind: ${s.behind} · dead ball ${s.deadAfter} s`;

/**
 * A new match: the players alternate between the teams in party order. null outside MIN_PLAYERS to MAX_PLAYERS, as
 * `players` in its rules says.
 * @param {import('./minigames.js').RoundStart<FoosballSettings>} start @returns {FoosballState | null}
 */
export function startFoosball({ seed, settings, players }) {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) return null;
  /** @type {Record<string, FoosballPlayer>} */
  const all = {};
  players.forEach(({ id, character }, i) => {
    const c = CHARACTERS[character];
    all[id] = { character, name: c.name, color: c.color, team: i % 2 === 0 ? 'a' : 'b', score: 0 };
  });
  return {
    kind: 'foosball', seed, settings, order: players.map((p) => p.id), players: all,
    score: { a: 0, b: 0 }, goals: [], endReason: null,
  };
}

const running = (/** @type {FoosballState} */ s) => s.endReason === null;

/** @param {FoosballState} s @param {FoosballAction} a @param {import('./minigames.js').RoundCtx} ctx @returns {FoosballState} */
export function reduceFoosball(s, a, ctx) {
  if (!running(s)) return s;
  switch (a.t) {
    case 'goal': {
      if (!TEAMS.includes(a.team) || (a.by !== null && !Object.hasOwn(s.players, a.by))) return s;
      const score = { ...s.score, [a.team]: s.score[a.team] + 1 };
      const players = Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, score: score[p.team] }]));
      return { ...s, score, players, goals: [...s.goals, { team: a.team, by: a.by }] };
    }

    case 'leave': {
      const p = s.players[a.id];
      if (!p || p.left) return s;
      const players = { ...s.players, [a.id]: { ...p, left: true, done: true } };
      const emptied = TEAMS.some((team) => !s.order.some((id) => players[id].team === team && !players[id].done));
      return { ...s, players, endReason: emptied ? 'left' : null };
    }

    case 'endGame':
      return ctx.gameMasterId !== null && a.id === ctx.gameMasterId ? { ...s, endReason: 'gm' } : s;

    default:
      return s;
  }
}

/** @type {import('./minigames.js').RoundRules<FoosballState, FoosballAction, FoosballSettings>} */
export const FOOSBALL_RULES = {
  init: startFoosball,
  players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
  reduce: reduceFoosball,
  status: (s) => (s?.kind !== 'foosball' ? null : running(s) ? 'running' : 'finished'),
  result: (s) => ({
    ranking: ranking(s).map((r) => ({ character: s.players[r.id].character, score: r.score, rank: r.rank })),
    endReason: s.endReason,
  }),
  settings: (patch, base = FOOSBALL_DEFAULTS) => mergeFoosballSettings(base, patch),
  validateSettings: (settings) => settingsProblems(FOOSBALL_DEFAULTS, mergeFoosballSettings, settings),
  sampleSettings: {},
  deadline: () => null,
  deadlineAction: (deadline) => ({ t: 'timeUp', deadline }),
  shiftDeadline: (s) => s,
  describe: (s) => `table football ${s.score.a}–${s.score.b}`,
};
