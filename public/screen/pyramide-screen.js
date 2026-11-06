// Pyramide's TV screen, mounted by the plain lobby (./plain-lobby.js) while a round runs: a retro French TV
// game show. Each team has a golden pyramid of bricks that empties as clues are given, with its players, roles,
// score and bricks left; the middle shows whose turn it is (or the bidding) and the log of clues and guesses.
// A word found, lost or skipped flashes over the screen with the word (in #fx, so the last one outlives the
// round's screen and holds the podium back).
//
// The round's view carries the word in play (shared/pyramide.js); this screen never draws it: it reads a
// word's level only, and shows a word from the log's resolved lines.

import { h, addStylesheet, playerColor } from './dom.js';
import { avatarCanvas } from '../commun/avatar.js';
import { sfx } from './audio.js';
import { revealSchedule } from './podium-view.js';
import { CLASSIC_BRICKS, CLASSIC_LEVELS, DUEL_WORDS, MAX_BID, teamRanks } from '../../shared/pyramide.js';

/** @typedef {import('../../shared/pyramide.js').PyramideState} PyramideState */
/** @typedef {import('../../shared/pyramide.js').LogLine} LogLine */
/** The round's view: its state without the pool (server/pyramide.ts). @typedef {Omit<PyramideState, 'pool'>} PyramideView */

addStylesheet(new URL('./pyramide.css', import.meta.url));

/** A word found, lost or skipped holds the screen this long (a skip is a short one). */
const RESOLVED_MS = 2800;
const SKIPPED_MS = 1800;
/** The log shows its last lines. */
const LOG_LINES = 5;
/** A word's level, as stars. */
const STARS = { easy: '★☆☆', medium: '★★☆', hard: '★★★' };
const MODE_NAMES = { classic: 'Classic', duel: 'Bidding duel' };
/** Bricks per row of a pyramid, top to bottom: the classic mode's 13, and the duel's 10 (its highest bid). */
const PYRAMID_ROWS = /** @type {Record<number, number[]>} */ ({ [CLASSIC_BRICKS]: [1, 3, 4, 5], [MAX_BID]: [1, 2, 3, 4] });

/** @param {number} n @param {string} one @param {string} [many] */
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** @param {Pick<PyramideView, 'mode'>} s a pyramid's bricks: the most it ever holds */
const pyramidSize = (s) => (s.mode === 'classic' ? CLASSIC_BRICKS : MAX_BID);

/**
 * A team's pyramid: slots filled from the bottom, so the top bricks go first as clues are given.
 * @param {number} total
 */
function createPyramid(total) {
  /** @type {HTMLElement[]} by place from the bottom */
  const bricks = [];
  const rows = [];
  let base = 0;
  for (const width of [...PYRAMID_ROWS[total]].reverse()) {
    const row = h('div', 'pyr-row');
    for (let i = 0; i < width; i++) {
      const brick = h('span', 'pyr-brick', [h('span', 'pyr-fill')]);
      brick.style.setProperty('--i', String(base + i));
      bricks.push(brick);
      row.append(brick);
    }
    base += width;
    rows.unshift(row);
  }
  return {
    el: h('div', 'pyr-pyramid', rows),
    /** The first `lit` bricks from the bottom shine; one that goes out falls, if `animate`. @param {number} lit @param {boolean} animate */
    set(lit, animate) {
      bricks.forEach((brick, i) => {
        const on = i < lit;
        const was = brick.dataset.on;
        if (was === (on ? '1' : '0')) return;
        brick.dataset.on = on ? '1' : '0';
        brick.classList.toggle('is-gone', !on);
        brick.classList.toggle('is-falling', !on && was === '1' && animate);
      });
    },
  };
}

/** @param {number} team 0 | 1 @param {PyramideView} s */
function createTeam(team, s) {
  const pyramid = createPyramid(pyramidSize(s));
  const players = h('div', 'pyr-players');
  const name = h('h2', 'pyr-team-name', [`Team ${team + 1}`]);
  const badge = h('span', 'pyr-badge');
  const score = h('div', 'pyr-score');
  const scoreLabel = h('div', 'pyr-score-label');
  const bricks = h('div', 'pyr-bricks');
  const word = h('div', 'pyr-word');
  const el = h('article', 'pyr-team', [
    h('header', 'pyr-team-head', [name, badge]), players, pyramid.el,
    h('footer', 'pyr-team-foot', [h('div', 'pyr-scoreboard', [score, scoreLabel]), h('div', 'pyr-team-info', [bricks, word])]),
  ]);
  el.dataset.team = String(team);
  let seats = '';
  return {
    el,
    /** @param {PyramideView} s @param {boolean} animate */
    update(s, animate) {
      const t = s.teams[team];
      const classic = s.mode === 'classic';
      const playing = s.turn === team && s.endReason === null && (!classic || !t.done);
      el.classList.toggle('is-turn', playing);
      el.classList.toggle('is-done', classic && t.done);
      badge.textContent = playing ? (s.step === 'bid' ? '▶ BIDDING' : s.step === 'guess' ? '▶ GUESSING' : '▶ CLUE') : '';

      const key = `${t.clue}|${t.guess}`;
      if (key !== seats) { // the roles rotate after a word
        seats = key;
        players.replaceChildren(...[['clue', t.clue], ['guess', t.guess]].map(([role, id]) => {
          const p = s.players[id];
          const row = h('div', `pyr-role is-${role}`, [
            avatarCanvas(p.character, 5),
            h('span', 'pyr-role-name', [p.name]),
            h('span', 'pyr-role-tag', [role === 'clue' ? '💡 gives clues' : '❓ guesses']),
          ]);
          row.style.setProperty('--pc', playerColor(p.color));
          return row;
        }));
      }

      // the pyramid: the bricks left; in the duel's bidding, the bid on the table
      const bidding = s.mode === 'duel' && s.step === 'bid';
      pyramid.set(bidding ? (s.bid?.team === team ? s.bid.n : 0) : t.bricks, animate);

      score.textContent = String(t.score);
      scoreLabel.textContent = classic ? 'words found' : t.score === 1 ? 'point' : 'points';
      if (classic) {
        bricks.textContent = t.done ? (t.bricks === 0 ? 'Out of bricks' : 'All words played') : `${count(t.bricks, 'brick')} left`;
        word.textContent = !t.done && t.word ? `Word ${t.at + 1} of ${CLASSIC_LEVELS.length} · ${STARS[t.word.level]}` : '';
      } else {
        bricks.textContent = !bidding && s.turn === team && t.bricks > 0 ? `${count(t.bricks, 'brick')} left` : '';
        word.textContent = '';
      }
    },
  };
}

/** @param {PyramideView} s @param {string} id */
const nameOf = (s, id) => s.players[id].name;

/** The middle card: whose turn it is, the last clue while it's guessed, the bidding. @param {PyramideView} s @returns {Node[]} */
function turnCard(s) {
  const team = s.turn;
  const t = s.teams[team];
  const kicker = (/** @type {string} */ text) => h('p', 'pyr-kicker', [text]);
  if (s.mode === 'duel' && s.step === 'bid') {
    const bidder = nameOf(s, t.clue);
    return [
      kicker('Bidding · how few bricks?'),
      s.bid
        ? h('div', 'pyr-bid', [h('span', 'pyr-bid-n', [String(s.bid.n)]), h('span', 'pyr-bid-by', [`${count(s.bid.n, 'brick')} · Team ${s.bid.team + 1}`])])
        : h('div', 'pyr-bid is-none', [h('span', 'pyr-bid-n', ['–']), h('span', 'pyr-bid-by', ['no bid yet'])]),
      h('p', 'pyr-main', [s.bid ? `${bidder} bids lower than ${s.bid.n}, or passes` : `${bidder} opens the bidding`]),
    ];
  }
  if (s.step === 'guess') {
    const clue = [...s.log].reverse().find((l) => l.t === 'clue');
    return [
      kicker(`Team ${team + 1} · clue ${t.clues}`),
      h('div', 'pyr-clue', [clue?.t === 'clue' ? clue.text : '']),
      h('p', 'pyr-main', [`${nameOf(s, t.guess)} guesses`]),
    ];
  }
  return [
    kicker(`Team ${team + 1} · ${count(t.bricks, 'brick')} left`),
    h('p', 'pyr-main', [`${nameOf(s, t.clue)} gives a clue`]),
    h('p', 'pyr-mystery', ['?']),
  ];
}

/** One line of the log, in the phones' words. @param {PyramideView} s @param {LogLine} line @param {boolean} fresh */
function logLine(s, line, fresh) {
  /** @type {(Node | string)[]} */
  let body;
  switch (line.t) {
    case 'clue': body = [`💡 Clue from ${nameOf(s, line.id)}: `, h('b', '', [line.text])]; break;
    case 'guess': body = [`❓ Guess from ${nameOf(s, line.id)}: `, h('b', '', [line.text]), h('span', line.found ? 'pyr-ok' : 'pyr-no', [line.found ? '\u00a0✓' : '\u00a0✗'])]; break;
    case 'bid': body = [`Bid from ${nameOf(s, line.id)}: `, h('b', '', [String(line.n)])]; break;
    case 'pass': body = [`${nameOf(s, line.id)} passed`]; break;
    case 'skipped': body = [`Skipped by ${nameOf(s, line.id)}: `, h('b', '', [line.word.word])]; break;
    default: body = [line.t === 'found' ? 'Found: ' : 'Lost: ', h('b', '', [line.word.word])];
  }
  const resolved = line.t === 'found' || line.t === 'lost';
  return h('li', `pyr-line is-t${line.team} k-${line.t}${resolved ? ' is-resolved' : ''}${fresh ? ' is-new' : ''}`, body);
}

/**
 * A word resolved: the flash over the screen. @param {PyramideView} s the view that resolves it
 * @param {PyramideView} prev the view before @param {Extract<LogLine, { t: 'found' | 'lost' | 'skipped' }>} line
 */
function flash(s, prev, line) {
  const { team } = line;
  const duel = s.mode === 'duel';
  const bricks = prev.teams[team].clues;
  const skipped = line.t === 'skipped';
  const winner = line.t === 'found' ? team : 1 - team; // the duel's point
  const sub = skipped ? `Team ${team + 1} gets another word`
    : line.t === 'found'
      ? (duel ? `Point for Team ${winner + 1}, found in ${count(bricks, 'brick')}` : `Team ${team + 1} found it in ${count(bricks, 'brick')}`)
      : (duel ? `Out of bricks: point for Team ${winner + 1}` : `Team ${team + 1} didn't find it`);
  const next = duel && s.endReason === null ? [h('p', 'pyr-flash-next', [`Next: word ${s.index + 1} of ${DUEL_WORDS}`])] : [];
  const el = h('div', `pyr-flash is-${line.t} is-t${team}`, [h('div', 'pyr-flash-card', [
    h('p', 'pyr-flash-kicker', [{ found: 'FOUND!', lost: 'NOT FOUND', skipped: 'SKIPPED' }[line.t]]),
    h('p', 'pyr-flash-word', [line.word.word]),
    h('p', 'pyr-flash-sub', [sub]),
    ...next,
  ])]);
  el.style.setProperty('--hold', `${skipped ? SKIPPED_MS : RESOLVED_MS}ms`);
  el.addEventListener('animationend', (e) => { if (e.target === el) el.remove(); });
  document.getElementById('fx')?.append(el);
  if (line.t === 'found') sfx.cleanBoard(); else if (line.t === 'lost') sfx.done(); else sfx.reveal();
}

/**
 * @param {HTMLElement} root @param {import('./minigames.js').TvIo} io
 * @returns {import('./minigames.js').RoundMounted}
 */
function mount(root, io) {
  /** The round in the last view this screen showed. @type {PyramideView | null} */
  let view = null;
  /** @type {ReturnType<typeof createTeam>[] | null} */
  let teams = null;
  const mode = h('span', 'pyr-mode');
  const turn = h('section', 'pyr-turn');
  const log = h('ol', 'pyr-log');

  /** Builds the screen once the mode is known (the pyramids' size). @param {PyramideView} s */
  function build(s) {
    teams = [createTeam(0, s), createTeam(1, s)];
    root.replaceChildren(h('section', 'pyr', [
      h('header', 'pyr-head', [h('h1', 'pyr-logo', ['PYRAMIDE']), mode]),
      h('div', 'pyr-stage', [teams[0].el, h('div', 'pyr-center', [turn, log]), teams[1].el]),
    ]));
  }

  return {
    update(round) {
      const s = /** @type {PyramideView} */ (round.view);
      // after a gap (reconnect, page load) the previous view is stale: render, but don't replay what was missed
      const prev = io.continuous() ? view : null;
      const first = view === null;
      view = s;
      if (!teams) build(s);
      const animate = prev !== null;

      mode.textContent = s.mode === 'duel' ? `${MODE_NAMES.duel} · word ${Math.min(s.index + 1, DUEL_WORDS)} of ${DUEL_WORDS}` : MODE_NAMES.classic;
      /** @type {ReturnType<typeof createTeam>[]} */ (teams).forEach((t) => t.update(s, animate));
      turn.replaceChildren(...turnCard(s));
      const had = prev ? prev.log.length : s.log.length;
      // the newest entry first
      const shown = s.log.map((line, at) => logLine(s, line, at >= had)).slice(-LOG_LINES).reverse();
      log.replaceChildren(...shown);

      if (first && io.continuous() && s.log.length === 0) sfx.start();
      if (!prev) return;
      for (const line of s.log.slice(prev.log.length)) {
        if (line.t === 'found' || line.t === 'lost' || line.t === 'skipped') flash(s, prev, line);
        else if (line.t === 'clue') sfx.place();
        else if (line.t === 'bid' || line.t === 'pass') sfx.joined();
      }
    },
    message() {},
    unmount() {
      root.replaceChildren();
    },
  };
}

/** The mode in one line, for the lobby and its last game. @param {{ mode?: string }} settings */
const summarize = (settings) => (settings.mode === 'duel' ? MODE_NAMES.duel : MODE_NAMES.classic);

/** @param {PyramideView} s @param {0 | 1} team "Élodie & Nico" */
const teamNames = (s, team) => s.order.filter((id) => s.players[id].team === team).map((id) => s.players[id].name).join(' & ');

/** @param {PyramideView} s @returns {0 | 1 | null} the winning team, null in a draw */
function winnerOf(s) {
  const ranks = teamRanks(/** @type {PyramideState} */ (s));
  return ranks[0] === ranks[1] ? null : ranks[0] === 1 ? 0 : 1;
}

/** What a team scored: its words found and bricks used (classic), its points (duel). @param {PyramideView} s @param {0 | 1} team */
const stat = (s, team) => (s.mode === 'classic'
  ? `${count(s.teams[team].score, 'word')} found · ${count(s.teams[team].used, 'brick')} used`
  : count(s.teams[team].score, 'point'));

/** The victory moment under the podium: a golden pyramid, and the winning team's score (both, in a draw). @param {PyramideView} s */
function victory(s) {
  const winner = winnerOf(s);
  const pyramid = createPyramid(MAX_BID);
  pyramid.set(MAX_BID, false);
  const lines = winner === null
    ? [`Team 1 · ${stat(s, 0)}`, `Team 2 · ${stat(s, 1)}`]
    : [stat(s, winner), `Team ${2 - winner} · ${stat(s, /** @type {0 | 1} */ (1 - winner))}`];
  const banner = h('div', 'pyr-victory', [
    pyramid.el,
    h('div', 'pyr-victory-text', [
      h('p', 'pyr-victory-title', [winner === null ? '🤝 Honours even' : `👑 Team ${winner + 1}`]),
      h('p', 'pyr-victory-stat', [lines[0]]),
      h('p', 'pyr-victory-stat is-dim', [lines[1]]),
    ]),
  ]);
  // arrives with the champions
  banner.classList.add('reveal');
  banner.style.setProperty('--delay', `${Math.min(...revealSchedule(s).filter((r) => r.rank === 1).map((r) => r.atMs))}ms`);
  return banner;
}

/** Pyramide's round screen, wrapped in the plain lobby in the TV's list (./minigames.js). @type {import('./minigames.js').RoundScreen} */
export const PYRAMIDE_SCREEN = {
  title: 'Pyramide',
  name: 'Pyramide',
  settings: { summarize },
  mount,
  /** The winning team as the title (or a draw), each player's team (and bricks used), and a pause after a last word so it shows first. */
  podium(round) {
    const s = /** @type {PyramideView} */ (round.view);
    const last = s.log[s.log.length - 1];
    const winner = winnerOf(s);
    return {
      title: winner === null ? "It's a draw!" : `${teamNames(s, winner)} win!`,
      rowExtra: (id) => {
        const { team } = s.players[id];
        return [h('span', `pyr-podium-team is-t${team}`, [s.mode === 'classic' ? `Team ${team + 1} · ${count(s.teams[team].used, 'brick')}` : `Team ${team + 1}`])];
      },
      lines: [victory(s)],
      delayMs: s.endReason === 'done' && (last?.t === 'found' || last?.t === 'lost') ? RESOLVED_MS : 0,
    };
  },
};
