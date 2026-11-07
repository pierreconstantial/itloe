// Backgammon: two to four players play each other, up to two boards at a time, in rounds of games against
// a clock, then the podium ranks them by points. A round's rules for the plain lobby: one round there is the
// whole group phase. Pure JSDoc ESM, no I/O, no clock, no randomness outside the seed.
//
// A board's checkers: each side has its own array in its own numbering, `c[1..24]` its points (it moves
// from 24 down to 1), `c[25]` its bar and `c[0]` its checkers borne off. A side's point q is the other
// side's point 25 - q. On the TV, side `a` sits at the bottom.
//
// Actions (ids and now injected by the server, never from the wire):
//   roll { id }                  the player to move, before moving: their dice, from the seed
//   move { id, from, to }        the player to move, in their numbering (from 25: the bar; to 0: off): one
//                                checker, by one die or by several in a row (reach)
//   undo { id }                  the player to move: takes back the turn's last move
//   done { id }                  the player to move, once no move is left: the other side's turn
//   nextRound { id, now }        the game master, between rounds: the next round, or after the last the podium
//   timeUp { deadline }          the round's clock: every unfinished game is decided
//   endGame { id }               the game master: the standings so far, the games in progress don't count
// A player who leaves or is taken out (marked by the plain lobby, `out`) loses their game and every game left.
// A refused action returns the same state.

import { CHARACTERS } from './characters.js';
import { mulberry32 } from './rng.js';
import { mergeBySchema, settingsProblems } from './settings.js';

/** @typedef {import('./characters.js').CharacterId} CharacterId */
/** @typedef {'a' | 'b'} Side */
/** @typedef {{ minutes: number, games: number }} BackgammonSettings */
/** A side's checkers, in its own numbering: [off, points 1–24, bar]. @typedef {number[]} Checkers */
/** One checker moved by one die, in the mover's numbering. @typedef {{ from: number, to: number, die: number }} Step */
/**
 * How a game ended: `won` (borne off), `gammon` (borne off, the loser had none off), `time` (ahead when the
 * clock ran out), `draw` (level then), `left` (the opponent left or was taken out).
 * @typedef {'won' | 'gammon' | 'time' | 'draw' | 'left'} How
 */
/**
 * A game being played. `turn`: the side to move; `dice`: the dice it still has to use (four for doubles),
 * null before it rolls; `rolled`: its roll as rolled; `undo`: the checkers and dice before each move of the
 * turn; `opening`: the opening roll (a's die, b's die), on the first turn only; `end`: how it ended.
 * @typedef {{
 *   a: string, b: string, c: { a: Checkers, b: Checkers },
 *   turn: Side, dice: number[] | null, rolled: number[] | null,
 *   undo: { c: { a: Checkers, b: Checkers }, dice: number[] }[],
 *   opening: [number, number] | null,
 *   end: { winner: Side | null, points: number, how: How } | null,
 * }} Board
 */
/** A game that counts: its players, its winner (null: a draw), the points won, and the loser's pips left. @typedef {{ a: string, b: string, winner: string | null, points: number, how: How, pips: number }} Game */
/**
 * @typedef {{ character: CharacterId, name: string, color: number, score: number, rank: number,
 *   left?: boolean, done?: boolean, retired?: boolean }} BackgammonPlayer
 */
/**
 * The group phase. `slot`: the schedule's slot of the current round (schedule); `round`: the rounds played
 * so far, this one included; `phase`: a round being played, or its results until the game master starts the
 * next; `boards`: the round's games; `games`: every game that counts, in the order they ended; `gamesBefore`:
 * how many counted before this round (who climbed in it); `rolls`: the
 * dice rolled so far (each roll's dice come from the seed and this count; never in the view).
 * @typedef {{
 *   kind: 'backgammon', seed: number, rolls: number, settings: BackgammonSettings,
 *   order: string[], players: Record<string, BackgammonPlayer>,
 *   slot: number, round: number, phase: 'playing' | 'results', boards: Board[], deadline: number | null,
 *   games: Game[], gamesBefore: number,
 *   endReason: 'done' | 'gm' | 'left' | 'retired' | null,
 * }} BackgammonState
 */
/**
 * @typedef {{ t: 'roll', id: string }
 *   | { t: 'move', id: string, from: number, to: number }
 *   | { t: 'undo', id: string }
 *   | { t: 'done', id: string }
 *   | { t: 'nextRound', id: string, now: number }
 *   | { t: 'timeUp', deadline: number }
 *   | { t: 'endGame', id: string }} BackgammonAction
 */

export const CHECKERS = 15;
export const OFF = 0;
export const BAR = 25;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** A side's checkers at the start: 2 on 24, 5 on 13, 3 on 8, 5 on 6. @returns {Checkers} */
export function startingCheckers() {
  const c = Array(26).fill(0);
  c[24] = 2; c[13] = 5; c[8] = 3; c[6] = 5;
  return c;
}

/** @type {BackgammonSettings} */
export const BACKGAMMON_DEFAULTS = Object.freeze({ minutes: 8, games: 1 });

/** The settings, as a schema (a settings sheet reads it). minutes 0: no time limit; games 3: best of 3. */
export const BACKGAMMON_SETTINGS_SCHEMA = Object.freeze({
  minutes: { kind: /** @type {const} */ ('choice'), values: /** @type {readonly number[]} */ ([5, 8, 12, 15, 0]) },
  games: { kind: /** @type {const} */ ('choice'), values: /** @type {readonly number[]} */ ([1, 3]) },
});

/** `base` with every valid key of `patch`. @param {BackgammonSettings} base @param {unknown} patch @returns {BackgammonSettings} */
export const mergeBackgammonSettings = (base, patch) => mergeBySchema(BACKGAMMON_SETTINGS_SCHEMA, base, patch);

/** A content node's settings: problems, as readable lines. @param {unknown} settings @returns {string[]} */
export const validateBackgammonSettings = (settings) => settingsProblems(BACKGAMMON_DEFAULTS, mergeBackgammonSettings, settings);

// ---------------------------------------------------------------- moves

/** The other side. @param {Side} side @returns {Side} */
export const other = (side) => (side === 'a' ? 'b' : 'a');

/** A side's pip count: what it still has to move, the bar counting 25. @param {Checkers} c */
export const pips = (c) => c.reduce((sum, n, q) => sum + n * q, 0);

/** Every checker in the home board (points 1–6) or off. @param {Checkers} c */
const allHome = (c) => c.every((n, q) => q <= 6 || n === 0);

/**
 * One checker of `c` from `from` by `die`, against `o`: the checkers after it, and where it landed, or null
 * when the rules forbid it. A checker on the bar must enter first; bearing off needs every checker home, and
 * a die larger than needed bears off only the highest checker; a point with two or more of `o` is closed, a
 * point with one is hit (that checker goes to `o`'s bar).
 * @param {Checkers} c @param {Checkers} o @param {number} from @param {number} die
 * @returns {{ c: Checkers, o: Checkers, to: number } | null}
 */
export function step(c, o, from, die) {
  if (from < 1 || from > BAR || !c[from]) return null;
  if (from !== BAR && c[BAR] > 0) return null;
  let to = from - die;
  if (to <= 0) {
    if (!allHome(c)) return null;
    if (to < 0 && c.slice(from + 1, 7).some((n) => n > 0)) return null;
    to = OFF;
  } else if (o[25 - to] >= 2) return null;
  const c2 = [...c];
  c2[from]--; c2[to]++;
  let o2 = o;
  if (to !== OFF && o[25 - to] === 1) {
    o2 = [...o];
    o2[25 - to] = 0; o2[BAR]++;
  }
  return { c: c2, o: o2, to };
}

/** The dice without one of `die`. @param {number[]} dice @param {number} die */
const without = (dice, die) => {
  const i = dice.indexOf(die);
  return [...dice.slice(0, i), ...dice.slice(i + 1)];
};

/** Most dice that can still be used, in any order. @param {Checkers} c @param {Checkers} o @param {number[]} dice @returns {number} */
function mostDice(c, o, dice) {
  let best = 0;
  for (const die of new Set(dice)) {
    for (let from = 1; from <= BAR; from++) {
      const m = step(c, o, from, die);
      if (!m) continue;
      best = Math.max(best, 1 + mostDice(m.c, m.o, without(dice, die)));
      if (best === dice.length) return best;
    }
  }
  return best;
}

/**
 * The single steps the rules allow now: those after which as many dice as possible can still be used; when
 * only one of two different dice can be used, the larger one if it can.
 * @param {Checkers} c @param {Checkers} o @param {number[]} dice @returns {Step[]}
 */
export function allowedSteps(c, o, dice) {
  const most = mostDice(c, o, dice);
  if (most === 0) return [];
  /** @type {Step[]} */
  let steps = [];
  for (const die of new Set(dice)) {
    for (let from = 1; from <= BAR; from++) {
      const m = step(c, o, from, die);
      if (m && 1 + mostDice(m.c, m.o, without(dice, die)) === most) steps.push({ from, to: m.to, die });
    }
  }
  if (most === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const high = Math.max(...dice);
    if (steps.some((s) => s.die === high)) steps = steps.filter((s) => s.die === high);
  }
  return steps;
}

/**
 * Where the checker on `from` can go now: by one die, or by several in a row when each step is allowed,
 * with the steps that get it there (the fewest, then the smallest dice first). What the phone lights up.
 * @param {Checkers} c @param {Checkers} o @param {number[]} dice @param {number} from
 * @returns {{ to: number, steps: Step[] }[]}
 */
export function reach(c, o, dice, from) {
  /** @type {Map<number, Step[]>} */
  const found = new Map();
  /** @param {Checkers} c @param {Checkers} o @param {number[]} dice @param {number} at @param {Step[]} path */
  const walk = (c, o, dice, at, path) => {
    const steps = allowedSteps(c, o, dice).filter((s) => s.from === at).sort((x, y) => x.die - y.die);
    for (const s of steps) {
      const m = /** @type {NonNullable<ReturnType<typeof step>>} */ (step(c, o, s.from, s.die));
      const next = [...path, s];
      const known = found.get(m.to);
      if (!known || known.length > next.length) found.set(m.to, next);
      if (m.to !== OFF) walk(m.c, m.o, without(dice, s.die), m.to, next);
    }
  };
  walk(c, o, dice, from, []);
  return [...found].map(([to, steps]) => ({ to, steps }));
}

// ---------------------------------------------------------------- the group phase

/** Each round's pairs, by player count, as indexes in party order: every pair once. */
const PAIRINGS = /** @type {Record<number, [number, number][][]>} */ ({
  2: [[[0, 1]]],
  3: [[[0, 1]], [[2, 0]], [[1, 2]]],
  4: [[[0, 2], [1, 3]], [[0, 1], [2, 3]], [[0, 3], [1, 2]]],
});

/**
 * The schedule: the pairings once per game a pair plays (games: 1 or 3), each pair's players swapping sides
 * the second time round. A slot is one round's pairs, as [side a, side b].
 * @param {string[]} order @param {number} games @returns {[string, string][][]}
 */
export function schedule(order, games) {
  const rounds = PAIRINGS[order.length] ?? [];
  return Array.from({ length: games }, (_, cycle) => rounds.map((pairs) =>
    pairs.map(([i, j]) => /** @type {[string, string]} */ (cycle % 2 ? [order[j], order[i]] : [order[i], order[j]])))).flat();
}

/** The games two players have played that count. @param {Pick<BackgammonState, 'games'>} s @param {string} p @param {string} q */
const between = (s, p, q) => s.games.filter((g) => (g.a === p && g.b === q) || (g.a === q && g.b === p));

/** Whether a pair still has a game to play: fewer than the setting's games, and nobody has won most of them. @param {Pick<BackgammonState, 'settings' | 'games'>} s @param {string} p @param {string} q */
function pairPlays(s, p, q) {
  const games = between(s, p, q);
  const most = Math.floor(s.settings.games / 2) + 1;
  return games.length < s.settings.games && ![p, q].some((id) => games.filter((g) => g.winner === id).length >= most);
}

/** Still in the group phase: neither left nor taken out. @param {Pick<BackgammonState, 'players'>} s @param {string} id */
const active = (s, id) => !s.players[id].done;

/** Two dice from the seed and the rolls so far. @param {BackgammonState} s @returns {{ s: BackgammonState, dice: [number, number] }} */
function rollDice(s) {
  const rnd = mulberry32((s.seed ^ Math.imul(s.rolls + 1, 0x9e3779b1)) >>> 0);
  const die = () => 1 + Math.floor(rnd() * 6);
  return { s: { ...s, rolls: s.rolls + 1 }, dice: [die(), die()] };
}

/** The dice a roll gives to use: four of a double. @param {number[]} rolled */
const toUse = (rolled) => (rolled[0] === rolled[1] ? [rolled[0], rolled[0], rolled[0], rolled[0]] : [...rolled]);

/**
 * A new game: the opening roll, repeated while both dice are equal; the higher die moves first, with both.
 * @param {BackgammonState} s @param {string} a @param {string} b @returns {{ s: BackgammonState, board: Board }}
 */
function newBoard(s, a, b) {
  let roll = rollDice(s);
  while (roll.dice[0] === roll.dice[1]) roll = rollDice(roll.s);
  const [da, db] = roll.dice;
  return {
    s: roll.s,
    board: {
      a, b, c: { a: startingCheckers(), b: startingCheckers() },
      turn: da > db ? 'a' : 'b', dice: [da, db], rolled: [da, db], undo: [], opening: [da, db], end: null,
    },
  };
}

/**
 * The next round's games: the next slot with a pair still to play, and those pairs; null when none is left.
 * @param {Pick<BackgammonState, 'order' | 'settings' | 'games' | 'players' | 'slot'>} s
 * @returns {{ slot: number, pairs: [string, string][] } | null}
 */
export function nextPairs(s) {
  const slots = schedule(s.order, s.settings.games);
  for (let slot = s.slot + 1; slot < slots.length; slot++) {
    const pairs = slots[slot].filter(([p, q]) => active(s, p) && active(s, q) && pairPlays(s, p, q));
    if (pairs.length > 0) return { slot, pairs };
  }
  return null;
}

/**
 * The next round: a board for each of its pairs; none left ends the group phase.
 * @param {BackgammonState} s @param {number} now @returns {BackgammonState}
 */
function startRound(s, now) {
  const next = nextPairs(s);
  if (!next) return { ...s, phase: 'results', deadline: null, endReason: 'done' };
  const gamesBefore = s.games.length;
  /** @type {Board[]} */
  const boards = [];
  for (const [p, q] of next.pairs) {
    const made = newBoard(s, p, q);
    s = made.s;
    boards.push(made.board);
  }
  const deadline = s.settings.minutes > 0 ? now + s.settings.minutes * 60_000 : null;
  return { ...s, slot: next.slot, round: s.round + 1, phase: 'playing', boards, deadline, gamesBefore };
}

/**
 * A game that counts is recorded, and the standings follow. A round whose games are all over shows its results.
 * @param {BackgammonState} s @param {number} index the board's @param {Side | null} winner @param {number} points @param {How} how
 * @returns {BackgammonState}
 */
function gameOver(s, index, winner, points, how) {
  const board = s.boards[index];
  const loser = winner && other(winner);
  const boards = s.boards.map((x, i) => (i === index ? { ...x, dice: null, undo: [], end: { winner, points, how } } : x));
  /** @type {Game} */
  const game = { a: board.a, b: board.b, winner: winner && board[winner], points, how, pips: loser && how !== 'left' ? pips(board.c[loser]) : 0 };
  const next = withStandings({ ...s, boards, games: [...s.games, game] });
  return boards.every((x) => x.end) ? { ...next, phase: 'results', deadline: null } : next;
}

/**
 * The standings: points, then among players level on points the points they scored against each other, then
 * the pips their opponents had left in the games they won; level after that, they share the rank.
 * @param {Pick<BackgammonState, 'order' | 'games'>} s @returns {{ id: string, points: number, won: number, lost: number, rank: number }[]}
 */
export function standings(s) {
  const pointsOf = (/** @type {string} */ id, /** @type {Game[]} */ games) => games.reduce((n, g) => n + (g.winner === id ? g.points : 0), 0);
  const rows = s.order.map((id) => ({
    id,
    points: pointsOf(id, s.games),
    won: s.games.filter((g) => g.winner === id).length,
    lost: s.games.filter((g) => g.winner !== null && g.winner !== id && (g.a === id || g.b === id)).length,
    margin: s.games.reduce((n, g) => n + (g.winner === id ? g.pips : 0), 0),
  }));
  const level = (/** @type {number} */ points) => rows.filter((r) => r.points === points).map((r) => r.id);
  const h2h = (/** @type {typeof rows[number]} */ r) => {
    const group = level(r.points);
    return pointsOf(r.id, s.games.filter((g) => group.includes(g.a) && group.includes(g.b)));
  };
  const key = (/** @type {typeof rows[number]} */ r) => [r.points, h2h(r), r.margin];
  const sorted = [...rows].sort((x, y) => {
    const [kx, ky] = [key(x), key(y)];
    return ky[0] - kx[0] || ky[1] - kx[1] || ky[2] - kx[2];
  });
  return sorted.map((r, i) => {
    const first = sorted.findIndex((q) => key(q).every((v, j) => v === key(r)[j]));
    return { id: r.id, points: r.points, won: r.won, lost: r.lost, rank: (first < 0 ? i : first) + 1 };
  });
}

/** Every player's score and rank from the standings (the frame's podium reads them). @param {BackgammonState} s @returns {BackgammonState} */
function withStandings(s) {
  /** @type {Record<string, BackgammonPlayer>} */
  const players = { ...s.players };
  for (const row of standings(s)) players[row.id] = { ...players[row.id], score: row.points, rank: row.rank };
  return { ...s, players };
}

/**
 * A player left or was taken out (marked by the plain lobby): they lose their game in progress and every game they
 * still had to play, 1 point each to the opponent. With fewer than two players left, the group phase ends.
 * @param {BackgammonState} s @param {string} id @returns {BackgammonState}
 */
function gone(s, id) {
  const index = s.boards.findIndex((x) => !x.end && (x.a === id || x.b === id));
  if (index >= 0) s = gameOver(s, index, s.boards[index].a === id ? 'b' : 'a', 1, 'left');
  for (const q of s.order) {
    while (q !== id && pairPlays(s, id, q)) s = { ...s, games: [...s.games, { a: q, b: id, winner: q, points: 1, how: 'left', pips: 0 }] };
  }
  s = withStandings(s);
  const endReason = s.players[id].left ? 'left' : 'retired';
  return s.order.filter((q) => active(s, q)).length < MIN_PLAYERS ? { ...s, phase: 'results', deadline: null, endReason } : s;
}

/**
 * A new group phase, its first round being played: MIN_PLAYERS to MAX_PLAYERS, as `players` in its rules says.
 * @param {import('./minigames.js').RoundStart<Partial<BackgammonSettings>>} start @returns {BackgammonState | null}
 */
export function startBackgammon({ seed, settings, players, now }) {
  /** @type {Record<string, BackgammonPlayer>} */
  const seated = {};
  for (const { id, character } of players) {
    const { name, color } = CHARACTERS[character];
    seated[id] = { character, name, color, score: 0, rank: 1 };
  }
  /** @type {BackgammonState} */
  const s = {
    kind: 'backgammon', seed: seed >>> 0, rolls: 0, settings: mergeBackgammonSettings(BACKGAMMON_DEFAULTS, settings),
    order: players.map((p) => p.id), players: seated,
    slot: -1, round: 0, phase: 'playing', boards: [], deadline: null, games: [], gamesBefore: 0, endReason: null,
  };
  return startRound(s, now);
}

/** Is the group phase still going? @param {BackgammonState} s */
const running = (s) => s.endReason === null;

/** The game master, passed in by the campaign. @param {import('./minigames.js').RoundCtx} ctx @param {string} id */
const isGameMaster = (ctx, id) => ctx.gameMasterId !== null && ctx.gameMasterId === id;

/** The board where `id` is to move in a game being played, with its index and side. @param {BackgammonState} s @param {string} id */
function moving(s, id) {
  if (!running(s) || s.phase !== 'playing') return null;
  const index = s.boards.findIndex((x) => !x.end && x[x.turn] === id);
  return index < 0 ? null : { index, board: s.boards[index], side: s.boards[index].turn };
}

/** @param {BackgammonState} s @param {number} index @param {Partial<Board>} patch @returns {BackgammonState} */
const withBoard = (s, index, patch) => ({ ...s, boards: s.boards.map((x, i) => (i === index ? { ...x, ...patch } : x)) });

/**
 * The time is up: every unfinished game is decided on its position at the start of the turn being played.
 * More checkers off wins, then fewer pips; level on both, it's a draw.
 * @param {BackgammonState} s @returns {BackgammonState}
 */
function timeUp(s) {
  s.boards.forEach((board, index) => {
    if (board.end) return;
    const c = board.undo[0]?.c ?? board.c;
    const diff = c.a[OFF] - c.b[OFF] || pips(c.b) - pips(c.a);
    s = gameOver(withBoard(s, index, { c }), index, diff > 0 ? 'a' : diff < 0 ? 'b' : null, diff === 0 ? 0 : 1, diff === 0 ? 'draw' : 'time');
  });
  return s;
}

/**
 * @param {BackgammonState} s @param {BackgammonAction} a @param {import('./minigames.js').RoundCtx} ctx
 * @returns {BackgammonState} the SAME object when the action is refused
 */
export function reduceBackgammon(s, a, ctx) {
  switch (a.t) {
    case 'roll': {
      const m = moving(s, a.id);
      if (!m || m.board.dice) return s;
      const roll = rollDice(s);
      return withBoard(roll.s, m.index, { dice: toUse(roll.dice), rolled: roll.dice, opening: null });
    }

    case 'move': {
      const m = moving(s, a.id);
      const rolled = m?.board.dice;
      if (!m || !rolled || !Number.isInteger(a.from) || !Number.isInteger(a.to)) return s;
      const { board, side } = m;
      const path = reach(board.c[side], board.c[other(side)], rolled, a.from).find((r) => r.to === a.to);
      if (!path) return s;
      let mine = board.c[side], theirs = board.c[other(side)], dice = rolled;
      for (const st of path.steps) {
        const done = /** @type {NonNullable<ReturnType<typeof step>>} */ (step(mine, theirs, st.from, st.die));
        mine = done.c; theirs = done.o; dice = without(dice, st.die);
      }
      const c = /** @type {Board['c']} */ ({ [side]: mine, [other(side)]: theirs });
      const next = withBoard(s, m.index, { c, dice, undo: [...board.undo, { c: board.c, dice: rolled }] });
      if (mine[OFF] < CHECKERS) return next;
      const gammon = theirs[OFF] === 0;
      return gameOver(next, m.index, side, gammon ? 2 : 1, gammon ? 'gammon' : 'won');
    }

    case 'undo': {
      const m = moving(s, a.id);
      const last = m?.board.undo.at(-1);
      if (!m || !last) return s;
      return withBoard(s, m.index, { c: last.c, dice: last.dice, undo: m.board.undo.slice(0, -1) });
    }

    case 'done': {
      const m = moving(s, a.id);
      if (!m || !m.board.dice) return s;
      if (allowedSteps(m.board.c[m.side], m.board.c[other(m.side)], m.board.dice).length > 0) return s;
      return withBoard(s, m.index, { turn: other(m.side), dice: null, rolled: null, undo: [], opening: null });
    }

    case 'nextRound':
      if (!isGameMaster(ctx, a.id) || !running(s) || s.phase !== 'results' || !Number.isFinite(a.now)) return s;
      return startRound(s, a.now);

    case 'timeUp':
      if (!running(s) || s.phase !== 'playing' || s.deadline === null || a.deadline !== s.deadline) return s;
      return timeUp(s);

    case 'endGame':
      return isGameMaster(ctx, a.id) && running(s) ? { ...s, phase: 'results', deadline: null, endReason: 'gm' } : s;

    default:
      return s;
  }
}

/**
 * The round's rules, in the rules list inside a lobby (shared/minigames.js).
 * @type {import('./minigames.js').RoundRules<BackgammonState, BackgammonAction, BackgammonSettings>}
 */
export const BACKGAMMON_RULES = {
  init: startBackgammon,
  reduce: reduceBackgammon,
  status: (s) => (s?.kind !== 'backgammon' ? null : running(s) ? 'running' : 'finished'),
  result: (s) => ({
    ranking: standings(s).map((r) => ({ character: s.players[r.id].character, score: r.points, rank: r.rank })),
    endReason: s.endReason,
  }),
  settings: (patch, base = BACKGAMMON_DEFAULTS) => mergeBackgammonSettings(base, patch),
  validateSettings: validateBackgammonSettings,
  sampleSettings: { minutes: 8, games: 1 },
  deadline: (s) => (running(s) && s.phase === 'playing' ? s.deadline : null),
  deadlineAction: (deadline) => ({ t: 'timeUp', deadline }),
  shiftDeadline: (s, by) => (running(s) && s.phase === 'playing' && s.deadline !== null ? { ...s, deadline: s.deadline + by } : s),
  out: gone,
  players: { min: MIN_PLAYERS, max: MAX_PLAYERS },
  describe: (s) => `backgammon round ${s.round}, ${s.phase}, ${s.games.length} games counted`
    + ` (${standings(s).map((r) => `${s.players[r.id].name} ${r.points}`).join(', ')})`,
};
