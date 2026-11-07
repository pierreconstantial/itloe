// Pyramide: two teams of two, one gives one-word clues, the other guesses the secret word. A round's
// rules, in two modes: the classic mode (four words per team, 13 bricks each) and the bidding duel (five
// words, the same for both teams, bricks bid for). Pure JSDoc ESM, no I/O, no clock, no randomness outside
// the seed.
//
// The round starts with its four players on the lobby's four spots (team 1's clue giver and guesser, team
// 2's) and the words it may draw (`inputs`: the server's bank minus the evening's asked words, by level).
// Words are drawn one at a time as they come up, so a word is never drawn twice and only drawn words are
// used up. The word in play travels in the view; the screens show it only to its clue givers.
//
// Actions (ids and verdicts are injected by the server, never from the wire):
//   clue { id, text }             the clue giver whose turn it is: one word, not the word (clueProblem); a brick
//   guess { id, text, found }     the guesser whose turn it is, after a clue; `found`: the server's judgeGuess
//   skip { id }                   classic: a clue giver, before the word's first clue: another word of its level
//   bid { id, n }                 duel: the bidding clue giver, 1..10, strictly lower than the last bid
//   pass { id }                   duel: the bidding clue giver, after the first bid: the last bid plays
//   leave { id }                  someone stopped being eligible: the round ends with the scores so far
//   retire { id, target }         the game master takes a player out: the same
//   endGame { id }                the game master: the same
// A refused action returns the same state.

import { CHARACTERS } from './characters.js';
import { mulberry32 } from './rng.js';
import { normalize } from './normalize.js';
import { ranking } from './ranking.js';

/** @typedef {import('./characters.js').CharacterId} CharacterId */
/** @typedef {'easy' | 'medium' | 'hard'} Level */
/** @typedef {'classic' | 'duel'} Mode */
/** @typedef {{ mode: Mode }} PyramideSettings */
/** A word of the bank. @typedef {{ id: string, word: string }} Word */
/** The words a round may draw, by level. @typedef {Record<Level, Word[]>} Pool */
/** A drawn word. @typedef {{ id: string, word: string, level: Level }} Drawn */
/**
 * A team. `clue`, `guess`: who has each role for the current word. `score`: words found (classic) or points
 * (duel). `bricks`: bricks left (classic: of 13 for the round; duel: of the bid, while it plays). `used`:
 * bricks spent in the round. `word`: the word its clue giver sees now, null when none (the duel: the same
 * word for both teams). `clues`: clues given on that word. Classic only: `at`, the current word's place in
 * its sequence (CLASSIC_LEVELS); `done`, the team stopped (all its words played, or out of bricks).
 * @typedef {{ clue: string, guess: string, score: number, bricks: number, used: number, word: Drawn | null,
 *   clues: number, at: number, done: boolean }} Team
 */
/**
 * One line of the round's log, everyone sees it: a clue, a guess, a bid, a pass, a skip (each with `id`, the
 * player who did it: roles rotate, so the team doesn't say), and a word found or lost, with the word.
 * @typedef {{ team: 0 | 1, t: 'clue', id: string, text: string }
 *   | { team: 0 | 1, t: 'guess', id: string, text: string, found: boolean }
 *   | { team: 0 | 1, t: 'bid', id: string, n: number }
 *   | { team: 0 | 1, t: 'pass', id: string }
 *   | { team: 0 | 1, t: 'skipped', id: string, word: Drawn }
 *   | { team: 0 | 1, t: 'found' | 'lost', word: Drawn }} LogLine
 */
/**
 * @typedef {{ character: CharacterId, name: string, color: number, team: 0 | 1, score: number, rank?: number,
 *   left?: boolean, done?: boolean, retired?: boolean }} PyramidePlayer
 */
/**
 * A round. `turn`: the team whose turn it is (classic: to give a clue or guess; duel: to bid, then the team
 * playing the word). `step`: what that team does next. Duel only: `index`, the word's number (0..4);
 * `opening`, the team that bid first on it; `bid`, the last bid. `pool`: the words still drawable, never in
 * the view. `drawn`: every word drawn, skipped ones too (the evening's asked ids).
 * @typedef {{
 *   kind: 'pyramide', mode: Mode, seed: number,
 *   order: string[], players: Record<string, PyramidePlayer>,
 *   teams: [Team, Team],
 *   turn: 0 | 1, step: 'clue' | 'guess' | 'bid',
 *   index: number, opening: 0 | 1, bid: { team: 0 | 1, n: number } | null,
 *   pool: Pool, drawn: string[], log: LogLine[],
 *   endReason: 'done' | 'gm' | 'left' | 'retired' | null,
 * }} PyramideState
 */
/**
 * @typedef {{ t: 'clue', id: string, text: string }
 *   | { t: 'guess', id: string, text: string, found: boolean }
 *   | { t: 'skip', id: string }
 *   | { t: 'bid', id: string, n: number }
 *   | { t: 'pass', id: string }
 *   | { t: 'leave', id: string }
 *   | { t: 'retire', id: string, target: string }
 *   | { t: 'endGame', id: string }
 *   | { t: 'noClock', deadline: number }} PyramideAction   // noClock: never fired, Pyramide has no deadline
 */

/** The bank's levels, as Pierre's word list names them. @type {readonly Level[]} */
export const LEVELS = Object.freeze(['easy', 'medium', 'hard']);

/** A clue, and a word of the bank: one word, letters, hyphens and apostrophes ("arc-en-ciel", "aujourd'hui"). */
export const ONE_WORD = /^[\p{L}'’-]+$/u;
/** Longest clue, and longest guess kept. */
export const MAX_CLUE = 30;
export const MAX_GUESS = 40;

/** The classic mode: each team's words, in order, and its bricks for the round. */
export const CLASSIC_LEVELS = /** @type {readonly Level[]} */ (Object.freeze(['easy', 'medium', 'medium', 'hard']));
export const CLASSIC_BRICKS = 13;
/** The duel: its words (all medium) and the bids' range. */
export const DUEL_WORDS = 5;
export const DUEL_LEVEL = /** @type {Level} */ ('medium');
export const MAX_BID = 10;

/**
 * The lobby's four spots, in world units (16 × 9): team 1 on the left, team 2 on the right, the clue giver
 * outermost. The roles are for the first word; they rotate after that.
 */
export const PYRAMIDE_SPOTS = Object.freeze([
  { id: 'team1-clue', label: 'Team 1 · clue giver', x: 1, y: 6, w: 2, h: 1.6, team: /** @type {0} */ (0), role: /** @type {'clue'} */ ('clue') },
  { id: 'team1-guess', label: 'Team 1 · guesser', x: 3.6, y: 6, w: 2, h: 1.6, team: /** @type {0} */ (0), role: /** @type {'guess'} */ ('guess') },
  { id: 'team2-guess', label: 'Team 2 · guesser', x: 10.4, y: 6, w: 2, h: 1.6, team: /** @type {1} */ (1), role: /** @type {'guess'} */ ('guess') },
  { id: 'team2-clue', label: 'Team 2 · clue giver', x: 13, y: 6, w: 2, h: 1.6, team: /** @type {1} */ (1), role: /** @type {'clue'} */ ('clue') },
]);

/**
 * Where the lobby's walkers start: between the two teams' spots, clear of the settings panel above them, in two
 * rows whose names don't touch; the corners first for the evening's four players, the middle for the development
 * start's six.
 * @type {readonly import('./minigames.js').StartPosition[]}
 */
export const PYRAMIDE_START_POSITIONS = Object.freeze([
  { x: 6.7, y: 8.1 }, { x: 9.3, y: 8.1 }, { x: 6.7, y: 6.1 }, { x: 9.3, y: 6.1 }, { x: 8, y: 8.1 }, { x: 8, y: 6.1 },
]);

/** @type {PyramideSettings} */
export const PYRAMIDE_DEFAULTS = Object.freeze({ mode: 'classic' });

/** The lobby's one setting, as a schema (a settings sheet reads it). */
export const PYRAMIDE_SETTINGS_SCHEMA = Object.freeze({
  mode: { kind: /** @type {const} */ ('choice'), values: /** @type {readonly Mode[]} */ (['classic', 'duel']) },
});

/** @param {PyramideSettings} base @param {unknown} patch @returns {PyramideSettings} */
export function mergePyramideSettings(base, patch) {
  const mode = /** @type {any} */ (patch)?.mode;
  return PYRAMIDE_SETTINGS_SCHEMA.mode.values.includes(mode) ? { ...base, mode } : { ...base };
}

/** A content node's settings: problems, as readable lines. @param {unknown} settings @returns {string[]} */
export function validatePyramideSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return ['settings must be an object'];
  return Object.entries(settings).flatMap(([key, v]) => {
    if (key !== 'mode') return [`unknown setting "${key}"`];
    return mergePyramideSettings(PYRAMIDE_DEFAULTS, { mode: v }).mode === v ? [] : [`setting "mode" can't be ${JSON.stringify(v)}`];
  });
}

/** A clue this long or longer is refused when the word contains it; a shorter one ("son" in maison) passes. */
export const MIN_CONTAINED_CLUE = 4;

/** Text compared without case, accents, spaces, hyphens and apostrophes. @param {string} text */
const squash = (text) => normalize(text).replace(/ /g, '');

/**
 * Why a clue is refused for a word, or null when it's fine: `form`, not one word (letters, hyphens and
 * apostrophes, at most MAX_CLUE); `contains`, ignoring case and accents, it contains the word (ensoleillé for
 * soleil), or the word contains it and it has MIN_CONTAINED_CLUE letters or more (pluie for parapluie, but not
 * son for maison). The reducer refuses with it, and the phone says why before sending.
 * @param {string} word @param {unknown} clue @returns {'form' | 'contains' | null}
 */
export function clueProblem(word, clue) {
  const text = typeof clue === 'string' ? clue.trim() : '';
  if (!text || text.length > MAX_CLUE || !ONE_WORD.test(text)) return 'form';
  const c = squash(text), w = squash(word);
  if (!c) return 'form';
  return c.includes(w) || (c.length >= MIN_CONTAINED_CLUE && w.includes(c)) ? 'contains' : null;
}

/** The other team. @param {0 | 1} team @returns {0 | 1} */
const other = (team) => (team === 0 ? 1 : 0);

/** How many words of each level a round needs at its start (skips aside). @param {Mode} mode @returns {Record<Level, number>} */
function needed(mode) {
  /** @type {Record<Level, number>} */
  const n = { easy: 0, medium: 0, hard: 0 };
  if (mode === 'duel') n[DUEL_LEVEL] = DUEL_WORDS;
  else for (const level of CLASSIC_LEVELS) n[level] += 2;
  return n;
}

/** The pool from the round's inputs: well-formed words of the levels the mode uses. @param {unknown} inputs @param {Mode} mode @returns {Pool} */
function poolOf(inputs, mode) {
  const n = needed(mode);
  /** @type {Pool} */
  const pool = { easy: [], medium: [], hard: [] };
  for (const level of LEVELS) {
    const list = /** @type {any} */ (inputs)?.[level];
    if (n[level] === 0 || !Array.isArray(list)) continue;
    pool[level] = list.filter((w) => typeof w?.id === 'string' && typeof w?.word === 'string').map(({ id, word }) => ({ id, word }));
  }
  return pool;
}

/**
 * The next word of a level, a seeded pick from the pool, which loses it. null when the level is empty.
 * @param {PyramideState} s @param {Level} level @returns {{ word: Drawn, s: PyramideState } | null}
 */
function draw(s, level) {
  const list = s.pool[level];
  if (list.length === 0) return null;
  const i = Math.floor(mulberry32((s.seed ^ Math.imul(s.drawn.length + 1, 0x9e3779b1)) >>> 0)() * list.length);
  const { id, word } = list[i];
  return {
    word: { id, word, level },
    s: { ...s, pool: { ...s.pool, [level]: list.filter((_, j) => j !== i) }, drawn: [...s.drawn, id] },
  };
}

/**
 * Classic: words of a level still to be drawn by the teams' next words (not their current ones), so a skip
 * never takes a word a team will need.
 * @param {PyramideState} s @param {Level} level
 */
function stillNeeded(s, level) {
  return s.teams.reduce((n, t) => n + (t.done ? 0 : CLASSIC_LEVELS.slice(t.at + 1).filter((l) => l === level).length), 0);
}

/** @param {PyramideState} s @param {0 | 1} team @param {Partial<Team>} patch @returns {PyramideState} */
function withTeam(s, team, patch) {
  const teams = /** @type {[Team, Team]} */ ([...s.teams]);
  teams[team] = { ...teams[team], ...patch };
  return { ...s, teams };
}

/** Every player's score is their team's (the frame's podium and presence read players' scores). @param {PyramideState} s */
function withScores(s) {
  /** @type {Record<string, PyramidePlayer>} */
  const players = {};
  for (const id of s.order) players[id] = { ...s.players[id], score: s.teams[s.players[id].team].score };
  return { ...s, players };
}

/** Swaps a team's roles. @param {Team} t @returns {Partial<Team>} */
const swapped = (t) => ({ clue: t.guess, guess: t.clue });

/** @param {PyramideState} s @param {LogLine} line @returns {PyramideState} */
const logged = (s, line) => ({ ...s, log: [...s.log, line] });

/**
 * A new round, running: the four players on the four spots, the mode's first words drawn. null without a
 * player on each spot, or without enough words for the mode.
 * @param {import('./minigames.js').RoundStart<Partial<PyramideSettings>>} start @returns {PyramideState | null}
 */
export function startPyramide({ seed, settings, players, inputs }) {
  const { mode } = mergePyramideSettings(PYRAMIDE_DEFAULTS, settings);
  const at = (/** @type {string} */ spot) => players.find((p) => p.spot === spot);
  const seated = PYRAMIDE_SPOTS.map((spot) => ({ spot, player: at(spot.id) }));
  if (players.length !== PYRAMIDE_SPOTS.length || seated.some((x) => !x.player)) return null;
  const pool = poolOf(inputs, mode);
  const n = needed(mode);
  if (LEVELS.some((level) => pool[level].length < n[level])) return null;

  /** @type {Record<string, PyramidePlayer>} */
  const seats = {};
  /** @type {{ clue: string, guess: string }[]} */
  const roles = [{ clue: '', guess: '' }, { clue: '', guess: '' }];
  for (const { spot, player } of seated) {
    const { id, character } = /** @type {NonNullable<typeof player>} */ (player);
    const { name, color } = CHARACTERS[character];
    seats[id] = { character, name, color, team: spot.team, score: 0 };
    roles[spot.team][spot.role] = id;
  }
  /** @type {Team} */
  const fresh = { clue: '', guess: '', score: 0, bricks: mode === 'classic' ? CLASSIC_BRICKS : 0, used: 0, word: null, clues: 0, at: 0, done: false };
  /** @type {PyramideState} */
  let s = {
    kind: 'pyramide', mode, seed: seed >>> 0,
    order: players.map((p) => p.id), players: seats,
    teams: [{ ...fresh, ...roles[0] }, { ...fresh, ...roles[1] }],
    turn: 0, step: mode === 'classic' ? 'clue' : 'bid', index: 0, opening: 0, bid: null,
    pool, drawn: [], log: [], endReason: null,
  };
  if (mode === 'classic') {
    for (const team of /** @type {const} */ ([0, 1])) {
      const d = /** @type {NonNullable<ReturnType<typeof draw>>} */ (draw(s, CLASSIC_LEVELS[0]));
      s = withTeam(d.s, team, { word: d.word });
    }
    return s;
  }
  return duelWord(s, 0);
}

/** Duel: word `index`, both teams on it, the opening team bidding first. @param {PyramideState} s @param {number} index */
function duelWord(s, index) {
  const d = /** @type {NonNullable<ReturnType<typeof draw>>} */ (draw(s, DUEL_LEVEL));
  const opening = /** @type {0 | 1} */ (index % 2);
  const next = { ...d.s, index, opening, turn: opening, step: /** @type {const} */ ('bid'), bid: null };
  return withTeam(withTeam(next, 0, { word: d.word, clues: 0, bricks: 0 }), 1, { word: d.word, clues: 0, bricks: 0 });
}

/** Is the round still being played? @param {PyramideState} s */
const running = (s) => s.endReason === null;

/** The game master, passed in by the campaign. @param {import('./minigames.js').RoundCtx} ctx @param {string} id */
const isGameMaster = (ctx, id) => ctx.gameMasterId !== null && ctx.gameMasterId === id;

/** Classic: the turn passes to the other team if it still plays, else stays; both done ends the round. @param {PyramideState} s @returns {PyramideState} */
function nextClassicTurn(s) {
  const turn = !s.teams[other(s.turn)].done ? other(s.turn) : !s.teams[s.turn].done ? s.turn : null;
  return turn === null ? { ...s, endReason: 'done' } : { ...s, turn, step: 'clue' };
}

/**
 * Classic: the team whose turn it is guessed. Found: its next word, roles swapped; out of bricks after a
 * miss: the word is lost and the team stops. Then the other team's turn.
 * @param {PyramideState} s @param {boolean} found @returns {PyramideState}
 */
function classicGuessed(s, found) {
  const team = s.turn;
  const t = s.teams[team];
  const word = /** @type {Drawn} */ (t.word);
  if (found) {
    s = logged(withTeam(s, team, { score: t.score + 1, ...swapped(t), word: null, clues: 0, at: t.at + 1 }), { team, t: 'found', word });
    const at = t.at + 1;
    if (at >= CLASSIC_LEVELS.length || t.bricks === 0) s = withTeam(s, team, { done: true });
    else {
      const d = /** @type {NonNullable<ReturnType<typeof draw>>} */ (draw(s, CLASSIC_LEVELS[at]));
      s = withTeam(d.s, team, { word: d.word });
    }
  } else if (t.bricks === 0) {
    s = logged(withTeam(s, team, { word: null, done: true }), { team, t: 'lost', word });
  }
  return nextClassicTurn(withScores(s));
}

/**
 * Duel: the word is resolved (found by the playing team, or its bricks spent): the point, both teams'
 * roles rotated, then the next word, or the end after the last.
 * @param {PyramideState} s @param {boolean} found @returns {PyramideState}
 */
function duelResolved(s, found) {
  const team = s.turn;
  const word = /** @type {Drawn} */ (s.teams[team].word);
  const winner = found ? team : other(team);
  s = withTeam(s, winner, { score: s.teams[winner].score + 1 });
  s = logged(s, { team, t: found ? 'found' : 'lost', word });
  for (const t of /** @type {const} */ ([0, 1])) s = withTeam(s, t, { ...swapped(s.teams[t]), word: null, bricks: 0, clues: 0 });
  s = withScores(s);
  return s.index + 1 >= DUEL_WORDS ? { ...s, bid: null, endReason: 'done' } : duelWord(s, s.index + 1);
}

/** Duel: the bidding is over, the last bid plays. @param {PyramideState} s @returns {PyramideState} */
function duelPlays(s) {
  const { team, n } = /** @type {{ team: 0 | 1, n: number }} */ (s.bid);
  return withTeam({ ...s, turn: team, step: 'clue' }, team, { bricks: n });
}

/**
 * The round ends at once with the scores so far (a player left or was taken out, or the game master ended it).
 * @param {PyramideState} s @param {'gm' | 'left' | 'retired'} endReason
 */
const ended = (s, endReason) => ({ ...s, endReason });

/**
 * The round's rules, with the ranks set when it ends: each player's is their team's (teamRanks), so teammates
 * share it, and the podium and the result rank them with the one shared rule.
 * @param {PyramideState} s @param {PyramideAction} a @param {import('./minigames.js').RoundCtx} ctx
 * @returns {PyramideState} the SAME object when the action is refused
 */
export function reducePyramide(s, a, ctx) {
  const next = reduceStep(s, a, ctx);
  return next !== s && next.endReason !== null && s.endReason === null ? ranked(next) : next;
}

/** Every player holds their team's rank. @param {PyramideState} s @returns {PyramideState} */
export function ranked(s) {
  const ranks = teamRanks(s);
  /** @type {Record<string, PyramidePlayer>} */
  const players = {};
  for (const id of s.order) players[id] = { ...s.players[id], rank: ranks[s.players[id].team] };
  return { ...s, players };
}

/** @param {PyramideState} s @param {PyramideAction} a @param {import('./minigames.js').RoundCtx} ctx @returns {PyramideState} */
function reduceStep(s, a, ctx) {
  const t = s.teams[s.turn];
  switch (a.t) {
    case 'clue': {
      if (!running(s) || s.step !== 'clue' || a.id !== t.clue || !t.word || t.bricks <= 0) return s;
      if (clueProblem(t.word.word, a.text) !== null) return s;
      const text = a.text.trim();
      return logged(withTeam({ ...s, step: 'guess' }, s.turn, { bricks: t.bricks - 1, used: t.used + 1, clues: t.clues + 1 }), { team: s.turn, t: 'clue', id: a.id, text });
    }

    case 'guess': {
      if (!running(s) || s.step !== 'guess' || a.id !== t.guess || typeof a.found !== 'boolean') return s;
      const text = typeof a.text === 'string' ? a.text.trim().slice(0, MAX_GUESS) : '';
      if (!text) return s;
      const next = logged(s, { team: s.turn, t: 'guess', id: a.id, text, found: a.found });
      if (s.mode === 'classic') return classicGuessed(next, a.found);
      if (a.found || t.bricks === 0) return duelResolved(next, a.found);
      return { ...next, step: 'clue' };
    }

    case 'skip': {
      if (!running(s) || s.mode !== 'classic') return s;
      const team = s.teams.findIndex((x) => x.clue === a.id);
      if (team < 0) return s;
      const own = s.teams[team];
      if (own.done || !own.word || own.clues > 0) return s;
      const { level } = own.word;
      if (s.pool[level].length <= stillNeeded(s, level)) return s; // no word to spare
      const skipped = own.word;
      const d = /** @type {NonNullable<ReturnType<typeof draw>>} */ (draw(s, level));
      return logged(withTeam(d.s, /** @type {0 | 1} */ (team), { word: d.word }), { team: /** @type {0 | 1} */ (team), t: 'skipped', id: a.id, word: skipped });
    }

    case 'bid': {
      if (!running(s) || s.step !== 'bid' || a.id !== t.clue) return s;
      if (!Number.isInteger(a.n) || a.n < 1 || a.n > MAX_BID || (s.bid && a.n >= s.bid.n)) return s;
      const next = logged({ ...s, bid: { team: s.turn, n: a.n } }, { team: s.turn, t: 'bid', id: a.id, n: a.n });
      return a.n === 1 ? duelPlays(next) : { ...next, turn: other(s.turn) };
    }

    case 'pass': {
      if (!running(s) || s.step !== 'bid' || a.id !== t.clue || !s.bid) return s;
      return duelPlays(logged(s, { team: s.turn, t: 'pass', id: a.id }));
    }

    case 'leave': {
      const p = s.players[a.id];
      if (!p || p.left) return s;
      const next = { ...s, players: { ...s.players, [a.id]: { ...p, left: true, done: true } } };
      return running(s) ? ended(next, 'left') : next;
    }

    case 'retire': {
      const p = s.players[a.target];
      if (!isGameMaster(ctx, a.id) || !running(s) || !p) return s;
      return ended({ ...s, players: { ...s.players, [a.target]: { ...p, retired: true, done: true } } }, 'retired');
    }

    case 'endGame':
      return isGameMaster(ctx, a.id) && running(s) ? ended(s, 'gm') : s;

    default:
      return s;
  }
}

/**
 * The teams ranked: more words found, then fewer bricks used (classic); more points (duel). Equal teams
 * share first place.
 * @param {PyramideState} s @returns {[number, number]} each team's rank
 */
export function teamRanks(s) {
  const [a, b] = s.teams;
  const diff = b.score - a.score || (s.mode === 'classic' ? a.used - b.used : 0);
  return diff === 0 ? [1, 1] : diff < 0 ? [1, 2] : [2, 1];
}

/**
 * The round's rules, in the rules list inside a lobby (shared/minigames.js).
 * @type {import('./minigames.js').RoundRules<PyramideState, PyramideAction, PyramideSettings>}
 */
export const PYRAMIDE_RULES = {
  init: startPyramide,
  reduce: reducePyramide,
  status: (s) => (s?.kind !== 'pyramide' ? null : running(s) ? 'running' : 'finished'),
  result: (s) => {
    return {
      ranking: ranking(s).map((r) => ({ character: s.players[r.id].character, score: r.score, rank: r.rank })),
      endReason: s.endReason, asked: [...s.drawn],
    };
  },
  settings: (patch, base = PYRAMIDE_DEFAULTS) => mergePyramideSettings(base, patch),
  validateSettings: validatePyramideSettings,
  sampleSettings: { mode: 'classic' },
  deadline: () => null,
  deadlineAction: (deadline) => ({ t: 'noClock', deadline }),
  shiftDeadline: (s) => s,
  retire: true,
  spots: PYRAMIDE_SPOTS,
  players: { min: PYRAMIDE_SPOTS.length, max: PYRAMIDE_SPOTS.length }, // a clue giver and a guesser per team
  startPositions: PYRAMIDE_START_POSITIONS,
  describe: (s) => `pyramide ${s.mode} ${s.endReason ? 'finished' : `word ${s.mode === 'duel' ? s.index + 1 : '…'}`}`
    + ` (team 1 ${s.teams[0].score}, team 2 ${s.teams[1].score})`,
};
