// Backgammon's phone screens (shared/backgammon.js), mounted by the plain lobby (./plain-lobby.js) while the group
// phase runs. A player at a board sees it from their side, turned upright: their points 12 to 1 down the left,
// 13 to 24 down the right, the bar across the middle and the trays below. They roll, tap a checker (the points it
// can reach light up) and tap where it goes; Undo takes a move back, Done ends the turn once no move is left. A
// player who sits out, or watches, sees the games and the standings. Between rounds: their result, their next game,
// the standings, and on the game master's phone the button that starts the next round (or shows the podium).
import { addStylesheet } from './dom.js';
import * as haptics from './haptics.js';
import { avatarCanvas } from '../commun/avatar.js';
import { secondsLeft, mmss } from '../commun/clock.js';
import { BACKGAMMON_SETTINGS_SCHEMA, BAR, OFF, allowedSteps, nextPairs, other, pips, reach, schedule, standings } from '../../shared/backgammon.js';

/** The round's view: its state without the seed and the rolls (server/backgammon.ts). @typedef {Omit<import('../../shared/backgammon.js').BackgammonState, 'seed' | 'rolls'>} View */
/** @typedef {import('../../shared/backgammon.js').Board} Board */
/** @typedef {import('../../shared/backgammon.js').Side} Side */
/** @typedef {import('../../shared/backgammon.js').How} How */

addStylesheet(new URL('./backgammon.css', import.meta.url));

const TICK_MS = 250;
/** A point shows this many checkers; more show as the count on the last one. */
const SHOWN = 5;
/** How a game was won, as its stamp. @type {Record<How, string>} */
const STAMPS = { won: 'WON', gammon: 'GAMMON!', time: 'TIME’S UP!', draw: 'DRAW', left: 'LEFT' };
/** What a refusal of each message means, in words (the server only says "refused"). @type {Record<string, string>} */
const REFUSALS = {
  roll: "You can't roll now.",
  move: "That move isn't allowed.",
  undo: 'Nothing to undo.',
  done: 'You still have a move to make.',
  nextRound: "The next round can't start yet.",
};

/** @param {string} tag @param {string} [cls] @param {(Node | string)[]} [children] */
function el(tag, cls, children = []) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...children);
  return e;
}
/** @param {View} s @param {string} id */
const colorOf = (s, id) => `var(--p${s.players[id].color})`;
/** A coloured dot and a name. @param {View} s @param {string} id */
const who = (s, id) => el('span', 'bg-who', [Object.assign(el('i'), { style: `background:${colorOf(s, id)}` }), s.players[id].name]);
/** @param {number[]} dice @param {number[]} [left] the dice still to use (the rest are dimmed) */
function diceEl(dice, left) {
  const unused = left ? [...left] : null;
  return el('span', 'bg-dice', dice.flatMap((d) => (dice[0] === dice[1] ? [d, d] : [d])).map((d) => {
    const at = unused ? unused.indexOf(d) : 0;
    if (unused && at >= 0) unused.splice(at, 1);
    return el('span', `bg-die${at < 0 ? ' used' : ''}`, [String(d)]);
  }));
}

/** The total rounds, when known in advance (one game per pair). @param {View} s */
const totalRounds = (s) => (s.settings.games === 1 ? schedule(s.order, 1).length : null);

/** Backgammon's round screens, wrapped in the plain lobby in the phone's list (./minigames.js). @type {import('./minigames.js').RoundScreen} */
export const BACKGAMMON_SCREEN = {
  title: 'Backgammon',
  name: 'backgammon',
  rules: [
    ['🎲', 'Two to four players play each other, two boards at a time. A win is 1 point, a gammon (the loser has no checker off) 2.'],
    ['👆', 'On your turn, roll, then tap a checker: the points it can reach light up. Tap one to move there. Undo takes a move back; Done ends your turn.'],
    ['⏱️', 'When a round’s time runs out, whoever is ahead wins: more checkers off, then fewer pips.'],
    ['👑', 'After the last round the most points win; a tie goes to the games between the tied players.'],
  ].map(([emoji, text]) => ({ icon: () => el('span', 'rule-emoji', [emoji]), text })),
  settings: {
    schema: BACKGAMMON_SETTINGS_SCHEMA,
    text: (key) => ({ label: key === 'minutes' ? 'Time limit per round' : 'Games per pair' }),
    format: (key, value) => (key === 'minutes' ? (value === 0 ? 'None' : `${value} min`) : value === 3 ? 'Best of 3' : '1'),
    summarize: (s) => `${s.minutes ? `${s.minutes} min rounds` : 'No time limit'} · ${s.games === 3 ? 'best of 3' : 'one game per pair'}`,
  },

  mount(root, io) {
    const screen = el('section', '', []);
    screen.id = 'view-backgammon';
    root.append(screen);

    /** @type {View | null} */ let last = null;
    /** The point this phone picked a checker from, and the turn it was picked in. */
    let picked = /** @type {number | null} */ (null), pickKey = '';
    /** This player's turn, to buzz once when it comes. */
    let turnKey = '';
    /** The last message this phone sent, which an `err` refuses (until the next view). @type {string | null} */
    let pending = null;
    /** @type {HTMLElement | null} */ let clock = null;

    /** @param {string} t @param {Record<string, unknown>} [rest] */
    function send(t, rest = {}) {
      pending = t;
      io.send({ t, ...rest });
    }

    const tick = setInterval(() => {
      if (!clock || !last || last.deadline === null) return;
      const left = secondsLeft(last.deadline);
      clock.textContent = mmss(left);
      clock.classList.toggle('urgent', left <= 30);
    }, TICK_MS);

    /** The board this player plays at, with their side. @param {View} s @param {string} me */
    function seatOf(s, me) {
      const index = s.boards.findIndex((b) => b.a === me || b.b === me);
      return index < 0 ? null : { index, board: s.boards[index], side: /** @type {Side} */ (s.boards[index].a === me ? 'a' : 'b') };
    }

    /**
     * The board from `side`'s side: points as rows (12–1 down the left, 13–24 down the right), the bar across the
     * middle, the trays below. `movable`: points a checker can leave; `pick`: the picked point; `lit`: where it can go.
     * @param {View} s @param {Board} b @param {Side} side @param {Set<number>} movable @param {number | null} pick @param {number[]} lit
     */
    function boardEl(s, b, side, movable, pick, lit) {
      const mine = b.c[side], theirs = b.c[other(side)];
      const myColor = colorOf(s, b[side]), theirColor = colorOf(s, b[other(side)]);
      /** @param {number} n @param {string} color @param {boolean} [picked] */
      const stack = (n, color, picked = false) => Array.from({ length: Math.min(n, SHOWN) }, (_, i) => {
        const last = i === Math.min(n, SHOWN) - 1;
        return el('i', `bg-ck${picked && last ? ' picked' : ''}`, [last && n > SHOWN ? String(n) : '']);
      }).map((ck) => { ck.style.background = color; return ck; });
      /** @param {number} q @param {boolean} right */
      const point = (q, right) => {
        const own = mine[q], opp = theirs[25 - q];
        const cell = el('div', `bg-pt${right ? ' r' : ''}${q % 2 ? ' odd' : ''}${lit.includes(q) ? ' lit' : ''}${movable.has(q) ? ' can' : ''}`,
          own ? stack(own, myColor, pick === q) : stack(opp, theirColor));
        cell.dataset.q = String(q);
        return cell;
      };
      const cells = [];
      for (let i = 0; i < 6; i++) cells.push(point(12 - i, false), point(13 + i, true));
      const theirBar = el('div', 'bg-bar', stack(theirs[BAR], theirColor));
      const myBar = el('div', `bg-bar r${movable.has(BAR) ? ' can' : ''}`, stack(mine[BAR], myColor, pick === BAR));
      myBar.dataset.q = String(BAR);
      cells.push(theirBar, myBar);
      for (let i = 0; i < 6; i++) cells.push(point(6 - i, false), point(19 + i, true));
      /** @param {number} n @param {string} color */
      const tray = (n, color) => [...Array.from({ length: n }, () => Object.assign(el('b'), { style: `background:${color}` })), el('span', '', [n ? String(n) : ''])];
      const myTray = el('div', `bg-tray${lit.includes(OFF) ? ' lit' : ''}`, mine[OFF] || lit.includes(OFF) ? tray(mine[OFF], myColor) : [el('em', '', ['off'])]);
      myTray.dataset.q = String(OFF);
      cells.push(myTray, el('div', 'bg-tray r', tray(theirs[OFF], theirColor)));
      return el('div', 'bg-board', cells);
    }

    /** The player's game: the board, the dice, what to do. @param {View} s @param {NonNullable<ReturnType<typeof seatOf>>} seat */
    function playing(s, seat) {
      const { board: b, side } = seat;
      const opp = b[other(side)];
      const myTurn = b.turn === side && !b.end;
      const mine = b.c[side], theirs = b.c[other(side)];
      const steps = myTurn && b.dice ? allowedSteps(mine, theirs, b.dice) : [];
      const movable = new Set(steps.map((x) => x.from));
      // the pick lasts for one state of the turn; a single checker to move is picked for the player
      const key = `${s.round}:${seat.index}:${b.turn}:${b.undo.length}:${b.dice?.join() ?? ''}`;
      if (key !== pickKey) { pickKey = key; picked = movable.size === 1 ? [...movable][0] : null; }
      if (picked !== null && !movable.has(picked)) picked = null;
      const lit = picked !== null && b.dice ? reach(mine, theirs, b.dice, picked).map((r) => r.to) : [];

      /** @type {(Node | string)[]} */
      let status;
      if (b.end) {
        status = [el('b', '', [b.end.winner === side ? `You won! +${b.end.points}` : b.end.winner ? `${s.players[opp].name} won` : 'A draw']),
          el('span', 'hint', ['Waiting for the other game'])];
      } else if (myTurn) {
        status = !b.dice ? [el('b', '', ['Your turn']), el('span', 'hint', ['Roll the dice'])]
          : [el('b', '', ['Your turn ']), diceEl(/** @type {number[]} */ (b.rolled), b.dice),
            el('span', 'hint', [steps.length ? (picked === null ? 'Tap a checker' : 'Tap where it goes') : b.undo.length ? 'Tap Done' : 'No possible move: tap Done'])];
      } else {
        status = b.dice ? [el('span', 'hint', [`${s.players[opp].name} is playing `]), diceEl(/** @type {number[]} */ (b.rolled), b.dice)]
          : [el('span', 'hint', [`${s.players[opp].name} is rolling…`])];
      }
      if (b.opening && !b.end) {
        const [da, db] = b.opening;
        const mineDie = side === 'a' ? da : db, theirDie = side === 'a' ? db : da;
        status.push(el('span', 'hint bg-opening', [`Opening roll: you ${mineDie}, ${s.players[opp].name} ${theirDie}`]));
      }

      const buttons = [];
      if (myTurn && !b.dice) {
        const roll = el('button', 'primary', ['🎲 Roll']);
        roll.addEventListener('click', () => send('roll'));
        buttons.push(roll);
      } else if (myTurn) {
        const undo = el('button', '', ['Undo']);
        /** @type {HTMLButtonElement} */ (undo).disabled = b.undo.length === 0 || !io.connected();
        undo.addEventListener('click', () => send('undo'));
        const done = el('button', steps.length ? '' : 'primary', ['Done']);
        /** @type {HTMLButtonElement} */ (done).disabled = steps.length > 0 || !io.connected();
        done.addEventListener('click', () => send('done'));
        buttons.push(undo, done);
      } else {
        buttons.push(el('p', 'hint', [`${pips(mine)} pips · ${s.players[opp].name} ${pips(theirs)}`]));
      }

      const boardNode = boardEl(s, b, side, movable, picked, lit);
      boardNode.addEventListener('click', (e) => {
        const cell = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-q]'));
        if (!cell || !myTurn || !b.dice || !last) return;
        const q = Number(cell.dataset.q);
        if (picked !== null && lit.includes(q)) {
          send('move', { from: picked, to: q });
          picked = null;
          haptics.buzz('place');
          return;
        }
        picked = movable.has(q) && q !== picked ? q : null;
        render(last);
      });

      return [el('div', 'bg-status', status), boardNode, el('div', 'bg-buttons', buttons)];
    }

    /** The games being played, for a player who sits out or watches. @param {View} s */
    function watching(s) {
      const me = io.meId();
      const out = s.order.includes(me) ? (s.players[me].done ? 'You’re out of this game.' : 'You sit out this round.') : 'You’re watching.';
      return [
        el('h2', '', [out]),
        el('div', 'card', s.boards.map((b, i) => el('div', 'bg-game', [
          el('span', 'hint', [`Board ${i + 1}`]), who(s, b.a), ' vs ', who(s, b.b),
          el('span', 'hint', [b.end ? (b.end.winner ? ` · ${s.players[b[b.end.winner]].name} won` : ' · draw') : ` · ${s.players[b[b.turn]].name} to play`]),
        ]))),
        standingsEl(s),
      ];
    }

    /** @param {View} s */
    function standingsEl(s) {
      return el('div', 'card bg-standings', standings(s).map((r) => el('div', 'bg-row', [
        el('span', 'bg-rank', [String(r.rank)]), who(s, r.id), el('span', 'bg-pts', [`${r.points} pts · ${r.won}–${r.lost}`]),
      ])));
    }

    /** Between rounds: this player's result, their next game, the standings, the game master's button. @param {View} s */
    function results(s) {
      const me = io.meId();
      const seat = seatOf(s, me);
      const next = nextPairs(s);
      /** @type {Node[]} */
      const hero = [];
      if (seat?.board.end) {
        const { board: b, side } = seat;
        const end = /** @type {NonNullable<Board['end']>} */ (b.end);
        const opp = b[other(side)];
        if (end.winner === side) hero.push(el('span', 'bg-big-emoji', ['🎉']), avatarCanvas(s.players[me].character, 5), el('b', 'bg-big', [`You won! +${end.points}`]));
        else if (end.winner) hero.push(avatarCanvas(s.players[opp].character, 5), el('b', 'bg-big', [`${s.players[opp].name} got you!`]), el('span', 'hint', [`+${end.points} for ${s.players[opp].name}`]));
        else hero.push(el('b', 'bg-big', ['A draw']));
        hero.push(el('span', 'bg-stamp', [STAMPS[end.how]]));
      } else if (s.order.includes(me)) {
        hero.push(el('b', 'bg-big', [`Round ${s.round} is over`]), el('span', 'hint', ['You sat out this round.']));
      } else {
        hero.push(el('b', 'bg-big', [`Round ${s.round} is over`]));
      }

      const nextPair = next?.pairs.findIndex((pair) => pair.includes(me)) ?? -1;
      const upNext = !next ? el('span', '', ['That was the last round.'])
        : nextPair >= 0 ? el('span', '', ['You play ', who(s, next.pairs[nextPair].find((id) => id !== me) ?? me), ` on board ${nextPair + 1}.`])
          : el('span', '', [s.order.includes(me) ? 'You sit out the next round.' : `Round ${s.round + 1}: ${next.pairs.map(([a, b]) => `${s.players[a].name} vs ${s.players[b].name}`).join(', ')}`]);
      const what = next ? `start round ${s.round + 1}` : 'show the podium';
      /** @type {Node} */
      let action;
      if (io.isGameMaster()) {
        action = el('button', 'primary bg-action', [next ? `▶ Start round ${s.round + 1}` : '▶ Show the podium']);
        /** @type {HTMLButtonElement} */ (action).disabled = !io.connected();
        action.addEventListener('click', () => send('nextRound'));
      } else action = el('p', 'hint bg-wait bg-action', [`Waiting for ${io.gameMasterName()} to ${what}`]);

      return [
        el('div', 'bg-hero', hero),
        el('div', 'card', [el('b', '', [next ? `Up next: round ${s.round + 1}` : 'Up next: the podium']), upNext]),
        standingsEl(s),
        el('div', 'bg-spacer'),
        action,
      ];
    }

    /** @param {View} s */
    function render(s) {
      last = s;
      const me = io.meId();
      const seat = seatOf(s, me);
      const total = totalRounds(s);
      clock = s.phase === 'playing' && s.deadline !== null ? el('span', 'bg-clock') : null;
      const top = el('header', 'bg-top', [
        el('span', 'kicker', [`Round ${s.round}${total ? ` of ${total}` : ''}`, ...(seat ? [' · vs ', who(s, seat.board[other(seat.side)])] : [])]),
        ...(clock ? [clock] : []),
      ]);
      const body = s.phase === 'results' ? results(s) : seat ? playing(s, seat) : watching(s);
      const error = el('p', 'error', []);
      error.id = 'bg-error';
      error.hidden = true;
      error.setAttribute('role', 'alert');
      screen.replaceChildren(top, ...body, error);
      if (clock && s.deadline !== null) clock.textContent = mmss(secondsLeft(s.deadline));

      // buzz when it becomes this player's turn
      const mine = seat && !seat.board.end && seat.board.turn === seat.side && s.phase === 'playing';
      const key = mine ? `${s.round}:${seat.index}:${s.games.length}:${seat.board.undo.length === 0 && !seat.board.dice}` : '';
      if (mine && key !== turnKey && !seat.board.dice) haptics.buzz('bell');
      turnKey = key;
    }

    return {
      update(round) {
        pending = null;
        render(/** @type {View} */ (round.view));
      },
      message(msg) {
        if (msg?.t !== 'err' || !pending) return;
        const error = document.getElementById('bg-error');
        if (error) { error.hidden = false; error.textContent = REFUSALS[pending] ?? "That can't be done right now."; }
        pending = null;
      },
      unmount() {
        clearInterval(tick);
        last = null;
        root.replaceChildren();
      },
    };
  },

  /** The winner as the title, each player's games won and lost. */
  podium(round) {
    const s = /** @type {View} */ (round.view);
    const rows = standings(s);
    const first = rows.filter((r) => r.rank === 1);
    const kicker = s.endReason === 'left' ? 'Too few players were left: the game ended with the standings so far.'
      : s.endReason === 'retired' ? 'The game master took players out: the game ended with the standings so far.' : undefined;
    return {
      title: first.length === 1 ? `${s.players[first[0].id].name} wins! 🎉` : "It's a tie! 🎉",
      ...(kicker ? { kicker } : {}),
      rowExtra: (id) => {
        const r = rows.find((x) => x.id === id);
        return ` pt${r?.points === 1 ? '' : 's'} · ${r?.won ?? 0}–${r?.lost ?? 0}`;
      },
    };
  },
};
