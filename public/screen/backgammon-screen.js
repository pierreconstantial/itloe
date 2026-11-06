// Backgammon's TV screen (shared/backgammon.js), mounted by the plain lobby (./plain-lobby.js) while the group phase
// runs, in the block game's flat look. While a round is played: its boards side by side (one centred with two or
// three players), each with its players' pips and checkers off, the dice on the mover's half, the round and its
// clock, and the standings. Between rounds it celebrates: each board's winner crowned with a stamp saying how
// ("GAMMON!", "TIME'S UP!"), the standings with who climbed, the next round's games as head-to-heads, and confetti.

import { h, addStylesheet, playerColor } from './dom.js';
import { avatarCanvas } from '../commun/avatar.js';
import { secondsLeft, mmss } from '../commun/clock.js';
import { sfx } from './audio.js';
import { BAR, OFF, nextPairs, pips, schedule, standings } from '../../shared/backgammon.js';

/** The round's view: its state without the seed and the rolls (server/backgammon.ts). @typedef {Omit<import('../../shared/backgammon.js').BackgammonState, 'seed' | 'rolls'>} View */
/** @typedef {import('../../shared/backgammon.js').Board} Board */
/** @typedef {import('../../shared/backgammon.js').Side} Side */
/** @typedef {import('../../shared/backgammon.js').How} How */

addStylesheet(new URL('./backgammon.css', import.meta.url));

const TICK_MS = 250;
/** A point shows this many checkers; more show as the count on the last one. */
const SHOWN = 5;
const CONFETTI = 60;
/** How a game was won, as its stamp. @type {Record<How, string>} */
const STAMPS = { won: 'WON', gammon: 'GAMMON!', time: 'TIME’S UP!', draw: 'DRAW', left: 'LEFT' };

/** @param {View} s @param {string} id */
const colorOf = (s, id) => playerColor(s.players[id].color);
/** @param {View} s @param {string} id */
const who = (s, id) => {
  const dot = h('i');
  dot.style.background = colorOf(s, id);
  return h('span', 'bgm-who', [dot, s.players[id].name]);
};
/** The total rounds, when known in advance (one game per pair). @param {View} s */
const totalRounds = (s) => (s.settings.games === 1 ? schedule(s.order, 1).length : null);

/** @param {number} n @param {string} color */
function stack(n, color) {
  return Array.from({ length: Math.min(n, SHOWN) }, (_, i) => {
    const ck = h('i', 'bgm-ck', [i === Math.min(n, SHOWN) - 1 && n > SHOWN ? String(n) : '']);
    ck.style.background = color;
    return ck;
  });
}

/** The board, side `a` at the bottom (its home bottom right), `b` on top, the trays on the right. @param {View} s @param {Board} b */
function boardEl(s, b) {
  const cells = [];
  const ca = b.c.a, cb = b.c.b;
  for (let p = 1; p <= 24; p++) {
    // a's point p holds a's checkers, or b's (their point 25 - p)
    const n = ca[p] || cb[25 - p];
    const color = ca[p] ? colorOf(s, b.a) : colorOf(s, b.b);
    const low = p <= 12;
    const col = low ? (p <= 6 ? 14 - p : 13 - p) : (p >= 19 ? p - 11 : p - 12);
    const cell = h('div', `bgm-pt${low ? ' low' : ''}${p % 2 ? ' odd' : ''}`, stack(n, color));
    cell.style.gridArea = `${low ? 3 : 1} / ${col}`;
    cells.push(cell);
  }
  const dice = (/** @type {Side} */ side) => {
    const half = h('div', 'bgm-mid');
    half.style.gridArea = side === 'a' ? '2 / 8 / 3 / 14' : '2 / 1 / 3 / 7';
    if (!b.end && b.turn === side && b.rolled) {
      const left = [.../** @type {number[]} */ (b.dice ?? [])];
      const shown = b.rolled[0] === b.rolled[1] ? [b.rolled[0], b.rolled[0], b.rolled[0], b.rolled[0]] : b.rolled;
      half.append(...shown.map((d) => {
        const at = left.indexOf(d);
        if (at >= 0) left.splice(at, 1);
        return h('span', `bgm-die${at < 0 ? ' used' : ''}`, [String(d)]);
      }));
    }
    return half;
  };
  const tray = (/** @type {number} */ n, /** @type {string} */ color, /** @type {string} */ cls) => {
    const bars = Array.from({ length: n }, () => { const bar = h('b'); bar.style.background = color; return bar; });
    return h('div', `bgm-tray ${cls}`, [...bars, h('span', '', [n ? String(n) : ''])]);
  };
  return h('div', 'bgm-board', [
    ...cells, dice('a'), dice('b'),
    h('div', 'bgm-bar', [h('span', '', stack(cb[BAR], colorOf(s, b.b))), h('span', '', stack(ca[BAR], colorOf(s, b.a)))]),
    tray(cb[OFF], colorOf(s, b.b), 'top'), tray(ca[OFF], colorOf(s, b.a), 'low'),
  ]);
}

/** One board's panel: `b` above, `a` below, with pips and checkers off; a finished game's stamp over it. @param {View} s @param {Board} b @param {number} i */
function panelEl(s, b, i) {
  const line = (/** @type {Side} */ side) => {
    const on = !b.end && b.turn === side;
    return h('div', `bgm-side${on ? ' on' : ''}`, [
      who(s, b[side]),
      h('span', 'bgm-dim', [on ? (b.dice ? 'to play' : 'to roll') : '']),
      h('span', 'bgm-stat', [`${pips(b.c[side])} pips · ${b.c[side][OFF]} off`]),
    ]);
  };
  const panel = h('article', `bgm-panel${b.end ? ' is-over' : ''}`, [h('span', 'bgm-dim', [`Board ${i + 1}`]), line('b'), boardEl(s, b), line('a')]);
  if (b.end) {
    const winner = b.end.winner ? s.players[b[b.end.winner]].name : null;
    panel.append(h('div', 'bgm-over', [h('span', 'bgm-stamp', [STAMPS[b.end.how]]), h('b', '', [winner ? `${winner} wins` : 'A draw'])]));
  }
  return panel;
}

/** The standings strip. @param {View} s */
const strip = (s) => h('div', 'bgm-strip', [h('span', 'bgm-dim', ['Standings']), ...standings(s).map((r) =>
  h('span', 'bgm-card', [who(s, r.id), h('b', 'bgm-pts', [String(r.points)]), h('span', 'bgm-dim', [`${r.won}–${r.lost}`])]))]);

/** A round being played. @param {View} s @param {HTMLElement} clock */
function playing(s, clock) {
  const total = totalRounds(s);
  return [
    h('div', 'bgm-top', [h('span', '', [`Round ${s.round}${total ? ` of ${total}` : ''}`]), clock]),
    h('div', `bgm-boards n${s.boards.length}`, s.boards.map((b, i) => panelEl(s, b, i))),
    ...sitsOut(s, s.boards.map((b) => /** @type {[string, string]} */ ([b.a, b.b]))),
    strip(s),
  ];
}

/** One board's result: the winner crowned and big, the loser small, the stamp. @param {View} s @param {Board} b @param {number} i */
function resultCard(s, b, i) {
  const end = /** @type {NonNullable<Board['end']>} */ (b.end);
  const winner = end.winner ? b[end.winner] : null;
  const loser = end.winner ? b[end.winner === 'a' ? 'b' : 'a'] : null;
  const figure = (/** @type {string} */ id, /** @type {boolean} */ won) => h('figure', won ? 'won' : 'lost', [
    ...(won ? [h('span', 'bgm-crown', ['👑'])] : []),
    avatarCanvas(s.players[id].character, won ? 10 : 6),
    h('figcaption', '', [s.players[id].name, ...(won ? [' ', h('b', '', [`+${end.points}`])] : [])]),
  ]);
  const card = h('article', 'bgm-result', [
    h('span', 'bgm-dim', [`Board ${i + 1}`]),
    h('span', 'bgm-stamp', [STAMPS[end.how]]),
    winner && loser
      ? h('div', 'bgm-duel', [figure(winner, true), h('span', 'bgm-beats', ['beats']), figure(loser, false)])
      : h('div', 'bgm-duel', [figure(b.a, false), h('span', 'bgm-beats', ['draw']), figure(b.b, false)]),
    h('span', 'bgm-how', [howText(s, b)]),
  ]);
  if (winner) card.style.setProperty('--pc', colorOf(s, winner));
  return card;
}

/** How a game ended, in words. @param {View} s @param {Board} b */
function howText(s, b) {
  const end = /** @type {NonNullable<Board['end']>} */ (b.end);
  const name = (/** @type {Side} */ side) => s.players[b[side]].name;
  const w = end.winner, l = w && (w === 'a' ? 'b' : 'a');
  switch (end.how) {
    case 'gammon': return `${name(/** @type {Side} */ (l))} hadn’t borne off a single checker`;
    case 'time': return `${name(/** @type {Side} */ (w))} was ahead: ${b.c[/** @type {Side} */ (w)][OFF]} off to ${b.c[/** @type {Side} */ (l)][OFF]}, ${pips(b.c[/** @type {Side} */ (w)])} pips to ${pips(b.c[/** @type {Side} */ (l)])}`;
    case 'draw': return 'Level when time ran out';
    case 'left': return `${name(/** @type {Side} */ (l))} left the game`;
    default: return `${name(/** @type {Side} */ (w))} bore off first`;
  }
}

/** Who sits out a round of these pairs, as a line (none: nothing). @param {View} s @param {[string, string][]} pairs */
function sitsOut(s, pairs) {
  const out = s.order.filter((id) => !s.players[id].done && !pairs.some((pair) => pair.includes(id)));
  return out.length ? [h('p', 'bgm-out', [...out.flatMap((id) => [who(s, id), ' ']), 'sits out'])] : [];
}

/** Between rounds. @param {View} s @param {string} gameMaster */
function results(s, gameMaster) {
  const before = new Map(standings({ order: s.order, games: s.games.slice(0, s.gamesBefore) }).map((r) => [r.id, r]));
  const rows = standings(s);
  const next = nextPairs(s);
  const leaderboard = h('section', 'bgm-lboard', [h('h2', '', ['Standings']), ...rows.map((r) => {
    const was = before.get(r.id);
    const moved = was && s.gamesBefore > 0 ? was.rank - r.rank : 0; // before any game, everyone was level
    const gained = r.points - (was?.points ?? 0);
    const row = h('div', `bgm-lrow${r.rank === 1 ? ' top' : ''}`, [
      h('span', 'bgm-rank', [['🥇', '🥈', '🥉'][r.rank - 1] ?? String(r.rank)]),
      avatarCanvas(s.players[r.id].character, 3),
      h('span', 'bgm-name', [s.players[r.id].name]),
      h('span', `bgm-move${moved > 0 ? ' up' : moved < 0 ? ' down' : ''}`, [moved > 0 ? '▲' : moved < 0 ? '▼' : '']),
      h('span', 'bgm-gain', [gained ? `+${gained}` : '']),
      h('span', 'bgm-pts', [String(r.points)]),
      h('span', 'bgm-dim', [`${r.won}–${r.lost}`]),
    ]);
    return row;
  })]);
  const matchup = (/** @type {[string, string]} */ [a, b], /** @type {number} */ i) => h('div', 'bgm-match', [
    h('span', 'bgm-dim', [`Board ${i + 1}`]),
    h('span', 'bgm-vside', [avatarCanvas(s.players[a].character, 4), s.players[a].name]),
    h('span', 'bgm-vs', ['VS']),
    h('span', 'bgm-vside r', [s.players[b].name, avatarCanvas(s.players[b].character, 4)]),
  ]);
  const upNext = h('section', 'bgm-next', next
    ? [h('h2', '', [`Up next · Round ${s.round + 1}`]), ...next.pairs.map(matchup), ...sitsOut(s, next.pairs),
      h('p', 'bgm-wait', ['Waiting for ', h('b', '', [gameMaster]), ` to start round ${s.round + 1}`])]
    : [h('h2', '', ['That was the last round']), h('p', 'bgm-wait', ['Waiting for ', h('b', '', [gameMaster]), ' to show the podium'])]);
  upNext.querySelectorAll('.bgm-vside').forEach((side, i) => {
    const pair = next?.pairs[Math.floor(i / 2)];
    if (pair) /** @type {HTMLElement} */ (side).style.color = colorOf(s, pair[i % 2]);
  });
  return [
    h('div', 'bgm-title', [`Round ${s.round} results`]),
    h('div', 'bgm-results', s.boards.map((b, i) => (b.end ? resultCard(s, b, i) : h('span')))),
    h('div', 'bgm-bottom', [leaderboard, upNext]),
  ];
}

/** Confetti falling once over the screen. */
function confetti() {
  return h('div', 'bgm-confetti', Array.from({ length: CONFETTI }, (_, i) => {
    const piece = h('i');
    piece.style.left = `${(i * 37) % 100}%`;
    piece.style.background = `var(--p${1 + (i % 6)})`;
    piece.style.animationDelay = `${(i * 53) % 900}ms`;
    piece.style.setProperty('--turn', `${(i * 71) % 360}deg`);
    return piece;
  }));
}

/**
 * @param {HTMLElement} root @param {import('./minigames.js').TvIo} io
 * @returns {import('./minigames.js').RoundMounted}
 */
function mount(root, io) {
  /** @type {View | null} */
  let view = null;
  const clock = h('span', 'bgm-clock');
  const stage = h('div', 'bgm-stage');
  root.replaceChildren(h('section', 'bgm', [h('header', 'bgm-head', [h('h1', 'bgm-logo', ['BACKGAMMON'])]), stage]));

  const tick = setInterval(() => {
    if (!view || view.phase !== 'playing' || view.deadline === null) { clock.textContent = ''; return; }
    const left = secondsLeft(view.deadline);
    clock.textContent = mmss(left);
    clock.classList.toggle('urgent', left <= 30);
  }, TICK_MS);

  /** Sounds for what changed since the last view. @param {View} prev @param {View} s */
  function sounds(prev, s) {
    if (prev.phase === 'playing' && s.phase === 'results') {
      if (s.boards.some((b) => b.end?.how === 'time' || b.end?.how === 'draw')) sfx.bell();
      sfx.cleanBoard();
      return;
    }
    if (prev.round !== s.round) { sfx.start(); return; }
    s.boards.forEach((b, i) => {
      const was = prev.boards[i];
      if (!was) return;
      if (b.end && !was.end) sfx.done();
      else if (b.rolled && !was.rolled) sfx.joined();
      else if (JSON.stringify(b.c) !== JSON.stringify(was.c)) sfx.place();
    });
  }

  return {
    update(round) {
      const s = /** @type {View} */ (round.view);
      const prev = io.continuous() ? view : null;
      view = s;
      if (s.phase === 'results') {
        stage.replaceChildren(...results(s, io.gameMasterName()));
        if (prev?.phase === 'playing') stage.append(confetti());
      } else {
        stage.replaceChildren(...playing(s, clock));
      }
      if (s.deadline !== null && s.phase === 'playing') clock.textContent = mmss(secondsLeft(s.deadline));
      if (prev) sounds(prev, s);
    },
    message() {},
    unmount() {
      clearInterval(tick);
      root.replaceChildren();
    },
  };
}

/** The settings in one line, for the lobby and its last game. @param {{ minutes?: number, games?: number }} settings */
const summarize = (settings) => `${settings.minutes ? `${settings.minutes} min rounds` : 'No time limit'} · ${settings.games === 3 ? 'best of 3' : 'one game per pair'}`;

/** Backgammon's round screen, wrapped in the plain lobby in the TV's list (./minigames.js). @type {import('./minigames.js').RoundScreen} */
export const BACKGAMMON_SCREEN = {
  title: 'Backgammon',
  name: 'backgammon',
  settings: { summarize },
  mount,
  /** The winner as the title, each player's games won and lost. */
  podium(round) {
    const s = /** @type {View} */ (round.view);
    const rows = standings(s);
    const first = rows.filter((r) => r.rank === 1);
    return {
      title: first.length === 1 ? `${s.players[first[0].id].name} wins!` : "It's a tie!",
      rowExtra: (id) => {
        const r = rows.find((x) => x.id === id);
        return [h('span', 'bgm-podium', [`${r?.won ?? 0}–${r?.lost ?? 0}`])];
      },
    };
  },
};
