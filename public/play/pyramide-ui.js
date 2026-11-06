// Pyramide's phone screens (shared/pyramide.js), mounted by the plain lobby (./plain-lobby.js) while a round runs.
// The round's view is the same for everyone and carries each team's word in play (docs/minigames.md,
// "Hidden information"): THIS screen draws it only on the phone of a player who gives clues and holds it. The phone is enough to
// play (Nico has no TV): both teams' scores and bricks, whose turn it is, and the log, then by role:
//   gives clues  the word, the clue field (saying why a clue is refused before sending), Skip in the classic mode
//   guesses      the guess field when it's their turn
//   duel bidding the bid control (what the rules accept) and Pass, for the player who gives clues
//   everyone else watching
// Controls are built once, so a view arriving mid-typing never resets a field.
import { $, addStylesheet } from './dom.js';
import * as haptics from './haptics.js';
import { CLASSIC_BRICKS, CLASSIC_LEVELS, DUEL_WORDS, MAX_BID, MAX_CLUE, MAX_GUESS, PYRAMIDE_SETTINGS_SCHEMA, clueProblem, teamRanks } from '../../shared/pyramide.js';

/** The round's view: its state without the words still drawable (server/pyramide.ts). @typedef {Omit<import('../../shared/pyramide.js').PyramideState, 'pool'>} View */
/** @typedef {import('../../shared/pyramide.js').LogLine} LogLine */

addStylesheet(new URL('./pyramide.css', import.meta.url));

/** The opening bid the control starts from. */
const OPENING_BID = 5;
/** Log lines that close a word. */
const RESOLVED = ['found', 'lost', 'skipped'];

/** Why a clue is refused, in words. @type {Record<'form' | 'contains', string>} */
const CLUE_PROBLEMS = {
  form: 'A clue is one word: letters, hyphens and apostrophes, no spaces.',
  contains: "Too close to the word: a clue can't contain it, nor be a part of it (four letters or more).",
};

/** What a refusal of each message means, in words (the server only says "refused"). @type {Record<string, string>} */
const REFUSALS = {
  clue: "The clue wasn't accepted. It may not be your turn, or the word is too close.",
  guess: "The guess wasn't accepted. It may not be your turn to guess.",
  skip: 'No skip: only before the first clue, and only if another word is left.',
  bid: "That bid isn't allowed. It must be lower than the last bid, and it may not be your turn.",
  pass: "You can't pass: it isn't your turn to bid, or you open the bidding.",
};

/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A team's players, by name: "Élodie & Nico". @param {View} s @param {number} team */
const teamNames = (s, team) => s.order.filter((id) => s.players[id].team === team).map((id) => s.players[id].name).join(' & ');

/** Is a view's round over? @param {View} s */
const over = (s) => s.endReason !== null;

const MARKUP = `
  <section id="view-pyramide">
    <header class="pyr-top">
      <span id="pyr-kicker" class="kicker"></span>
    </header>
    <div id="pyr-teams" class="pyr-teams"></div>
    <p id="pyr-status" class="pyr-status"></p>

    <div id="pyr-word" class="pyr-word" hidden>
      <small id="pyr-word-caption"></small>
      <strong id="pyr-word-text"></strong>
    </div>

    <form id="pyr-clue-form" class="pyr-form" hidden>
      <input id="pyr-clue" type="text" lang="fr" inputmode="text" enterkeyhint="send" placeholder="Your clue (one word)"
             autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" aria-label="Your clue">
      <button id="pyr-clue-send" type="submit" class="primary">Give the clue</button>
      <p id="pyr-clue-problem" class="error" hidden></p>
    </form>
    <button id="pyr-skip" type="button" hidden>Skip this word</button>

    <form id="pyr-guess-form" class="pyr-form" hidden>
      <input id="pyr-guess" type="text" lang="fr" inputmode="text" enterkeyhint="send" placeholder="Your guess"
             autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" aria-label="Your guess">
      <button id="pyr-guess-send" type="submit" class="primary">Guess</button>
    </form>

    <div id="pyr-bid" class="pyr-bid" hidden>
      <div class="stepper">
        <button id="pyr-bid-less" type="button" aria-label="Bid less">−</button>
        <output id="pyr-bid-n"></output>
        <button id="pyr-bid-more" type="button" aria-label="Bid more">+</button>
      </div>
      <button id="pyr-bid-send" type="button" class="primary"></button>
      <button id="pyr-pass" type="button"></button>
    </div>

    <p id="pyr-error" class="error" role="alert" hidden></p>
    <ol id="pyr-log" class="pyr-log" aria-label="Clues and guesses so far"></ol>
  </section>
`;

/** Pyramide's round screens, wrapped in the plain lobby in the phone's list (./minigames.js). @type {import('./minigames.js').RoundScreen} */
export const PYRAMIDE_SCREEN = {
  title: 'Pyramide',
  name: 'Pyramide',
  rules: [
    ['🧱', 'Two teams of two. One player gives one-word clues, the other guesses the secret word. Every clue costs a brick.'],
    ['⭐', `Classic: each team plays four words with ${CLASSIC_BRICKS} bricks. The team with the most words found wins, then the fewest bricks used. Skip a word before its first clue.`],
    ['🤐', "A clue is one word and can't contain the secret word, nor be a part of it (four letters or more)."],
    ['🔨', `Bidding duel: ${DUEL_WORDS} words, the same for both teams. The teams bid how few clues they need, each bid lower than the last, or pass. The last bid plays: found, a point for that team; not found, a point for the other.`],
    ['👣', 'Take your place in a lobby by stepping onto a spot, or tapping it on your phone.'],
  ].map(([emoji, text]) => ({ icon: () => el('span', 'rule-emoji', emoji), text })),
  settings: {
    schema: PYRAMIDE_SETTINGS_SCHEMA,
    text: () => ({ label: 'Mode' }),
    format: (_key, value) => (value === 'duel' ? 'Bidding duel' : 'Classic'),
    summarize: (s) => (s.mode === 'duel' ? 'Bidding duel' : 'Classic'),
  },

  mount(root, io) {
    root.insertAdjacentHTML('beforeend', MARKUP);
    const clueInput = /** @type {HTMLInputElement} */ ($('pyr-clue'));
    const guessInput = /** @type {HTMLInputElement} */ ($('pyr-guess'));
    clueInput.maxLength = MAX_CLUE;
    guessInput.maxLength = MAX_GUESS;

    /** The word of the clue giver's team in play (the only place a screen keeps it), null for anyone else. @type {string | null} */
    let word = null;
    /** @type {View | null} */ let last = null;
    /** The bid control's value, and the bidding turn it was set for. */
    let bidN = OPENING_BID, bidKey = '';
    /** What the player can do now, to buzz once when it becomes theirs; null before the first view. @type {string | null} */
    let actKey = null;
    /** The view's turn, to clear a refusal once the game moves on. */
    let moveKey = '';
    /** The last message this phone sent, which an `err` refuses (until the next view). @type {string | null} */
    let pending = null;

    /** @param {string} t @param {Record<string, unknown>} [rest] */
    function send(t, rest = {}) {
      showError('');
      pending = t;
      io.send({ t, ...rest });
    }

    /** @param {string} text */
    function showError(text) {
      $('pyr-error').hidden = text === '';
      $('pyr-error').textContent = text;
    }

    /** The clue field's reason to wait, before anything is sent. */
    function checkClue() {
      const problem = word !== null && clueInput.value.trim() !== '' ? clueProblem(word, clueInput.value) : null;
      $('pyr-clue-problem').hidden = problem === null;
      $('pyr-clue-problem').textContent = problem ? CLUE_PROBLEMS[problem] : '';
      /** @type {HTMLButtonElement} */ ($('pyr-clue-send')).disabled = !io.connected() || problem !== null || clueInput.value.trim() === '';
    }

    clueInput.addEventListener('input', checkClue);
    $('pyr-clue-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = clueInput.value.trim();
      if (!text || word === null || clueProblem(word, text) !== null) return;
      send('clue', { text });
      clueInput.value = '';
      checkClue();
      haptics.buzz('place');
    });
    $('pyr-guess-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = guessInput.value.trim();
      if (!text) return;
      send('guess', { text });
      guessInput.value = '';
      haptics.buzz('place');
    });
    $('pyr-skip').addEventListener('click', () => send('skip'));
    $('pyr-pass').addEventListener('click', () => send('pass'));
    $('pyr-bid-less').addEventListener('click', () => { bidN = Math.max(1, bidN - 1); drawBid(); });
    $('pyr-bid-more').addEventListener('click', () => { bidN = Math.min(maxBid(), bidN + 1); drawBid(); });
    $('pyr-bid-send').addEventListener('click', () => send('bid', { n: bidN }));

    /** The highest bid the rules accept: strictly lower than the last. */
    const maxBid = () => (last?.bid ? last.bid.n - 1 : MAX_BID);

    function drawBid() {
      const max = maxBid();
      bidN = Math.min(Math.max(bidN, 1), max);
      $('pyr-bid-n').textContent = String(bidN);
      /** @type {HTMLButtonElement} */ ($('pyr-bid-less')).disabled = bidN <= 1;
      /** @type {HTMLButtonElement} */ ($('pyr-bid-more')).disabled = bidN >= max;
      $('pyr-bid-send').textContent = `Bid ${bidN}`;
    }

    /** One team's card: its name and players, whose turn, score, bricks. @param {View} s @param {number} i */
    function teamCard(s, i) {
      const t = s.teams[i];
      const duel = s.mode === 'duel';
      const card = el('div', `pyr-team t${i + 1}`);
      card.classList.toggle('turn', !over(s) && s.turn === i);
      card.classList.toggle('mine', s.players[io.meId()]?.team === i);
      const names = el('small', '', teamNames(s, i));
      const score = el('b', 'pyr-score', String(t.score));
      const unit = el('small', '', duel ? plural(t.score, 'point') : `of ${CLASSIC_LEVELS.length} words`);

      // the bricks: the 13 of the round (classic), or the bid being played (duel)
      const total = duel ? (s.step !== 'bid' && s.turn === i && s.bid ? s.bid.n : 0) : CLASSIC_BRICKS;
      const strip = el('span', 'pyr-bricks');
      for (let b = 0; b < total; b++) strip.append(el('i', b < t.bricks ? 'left' : ''));
      const bricks = el('small', 'pyr-bricks-text',
        duel ? (total ? `${plural(t.bricks, 'brick')} left` : s.bid?.team === i ? `bid ${s.bid.n}` : '')
          : t.done ? 'finished' : `${plural(t.bricks, 'brick')} left`);
      card.append(el('strong', 'pyr-team-name', `Team ${i + 1}`), names, score, unit, strip, bricks);
      return card;
    }

    /** What is going on, for this phone. @param {View} s @param {string} me */
    function statusOf(s, me) {
      if (over(s)) return 'The round is over.';
      const t = s.teams[s.turn];
      const name = (/** @type {string} */ id) => s.players[id].name;
      if (s.step === 'bid') {
        if (t.clue === me) return s.bid ? `Team ${s.bid.team + 1} bid ${s.bid.n}. Bid lower, or pass and let them play.` : 'You open the bidding: how many clues do you need to get the word across?';
        return `${name(t.clue)} is bidding…`;
      }
      if (s.step === 'clue') return t.clue === me ? `Give ${name(t.guess)} a one-word clue.` : `${name(t.clue)} is giving ${name(t.guess)} a clue.`;
      return t.guess === me ? `Guess ${name(t.clue)}'s word.` : `${name(t.guess)} is guessing.`;
    }

    /** The log, newest first; the playing team's lines on the word in play stand out. @param {View} s */
    function drawLog(s) {
      const duel = s.mode === 'duel';
      const resolved = s.log.findLastIndex((l) => RESOLVED.includes(l.t) && (duel || l.team === s.turn));
      const items = s.log.map((l, i) => {
        const li = el('li', `t${l.team + 1}`);
        li.classList.toggle('now', i > resolved && (duel || l.team === s.turn));
        li.append(el('span', 'pyr-chip', `T${l.team + 1}`), el('span', 'pyr-line', lineText(l, s)));
        if (l.t === 'guess') li.classList.add(l.found ? 'right' : 'wrong');
        if (RESOLVED.includes(l.t)) li.classList.add('resolved');
        return li;
      }).reverse();
      $('pyr-log').replaceChildren(...(items.length ? items : [el('li', 'dim', 'No clues yet.')]));
    }

    /** @param {LogLine} l @param {View} s */
    function lineText(l, s) {
      const who = 'id' in l ? s.players[l.id].name : '';
      switch (l.t) {
        case 'clue': return `💡 Clue from ${who}: ${l.text}`;
        case 'guess': return `❓ Guess from ${who}: ${l.text} ${l.found ? '✓' : '✗'}`;
        case 'bid': return `Bid from ${who}: ${l.n}`;
        case 'pass': return `${who} passed`;
        case 'found': return `Found: ${l.word.word}`;
        case 'lost': return `Lost: ${l.word.word}`;
        default: return `Skipped by ${who}: ${l.word.word}`;
      }
    }

    /** @param {View} s */
    function render(s) {
      last = s;
      pending = null;
      const me = io.meId();
      const online = io.connected();
      const mine = s.players[me]?.team ?? null; // null: not in this round (the game master sitting it out)
      const t = s.teams[s.turn];
      const live = !over(s);
      const clueTurn = live && s.step === 'clue' && t.clue === me;
      const guessTurn = live && s.step === 'guess' && t.guess === me;
      const bidTurn = live && s.step === 'bid' && t.clue === me;

      $('pyr-kicker').textContent = s.mode === 'duel' ? `Bidding duel · word ${Math.min(s.index + 1, DUEL_WORDS)} of ${DUEL_WORDS}` : 'Classic';
      $('pyr-teams').replaceChildren(teamCard(s, 0), teamCard(s, 1));
      $('pyr-status').textContent = statusOf(s, me);

      // the word: only its clue giver's phone keeps it (a team's clue giver holds its team's word in play)
      word = live && mine !== null && s.teams[mine].clue === me ? s.teams[mine].word?.word ?? null : null;
      $('pyr-word').hidden = word === null;
      $('pyr-word-text').textContent = word ?? '';
      $('pyr-word-caption').textContent = s.mode === 'duel' ? 'Your word · only the players who give clues see it' : 'Your word · only you can see it';

      $('pyr-clue-form').hidden = !clueTurn;
      /** @type {HTMLButtonElement} */ ($('pyr-clue-send')).textContent = `Give the clue (${plural(t.bricks, 'brick')} left)`;
      checkClue();
      $('pyr-skip').hidden = !(clueTurn && s.mode === 'classic' && t.clues === 0);
      /** @type {HTMLButtonElement} */ ($('pyr-skip')).disabled = !online;
      $('pyr-guess-form').hidden = !guessTurn;
      /** @type {HTMLButtonElement} */ ($('pyr-guess-send')).disabled = !online;

      $('pyr-bid').hidden = !bidTurn;
      if (bidTurn) {
        const key = `${s.index}:${s.log.length}`;
        if (key !== bidKey) { bidKey = key; bidN = s.bid ? s.bid.n - 1 : OPENING_BID; }
        drawBid();
        $('pyr-pass').textContent = s.bid ? `Pass: Team ${s.bid.team + 1} plays with ${plural(s.bid.n, 'brick')}` : '';
        $('pyr-pass').hidden = !s.bid; // the opening bid can't pass
        /** @type {HTMLButtonElement} */ ($('pyr-pass')).disabled = !online;
        /** @type {HTMLButtonElement} */ ($('pyr-bid-send')).disabled = !online;
      }

      drawLog(s);

      // a refusal is for the move it answered: gone once the game moves on
      const move = `${s.log.length}:${s.step}:${s.turn}`;
      if (move !== moveKey) { moveKey = move; showError(''); }
      // buzz when it becomes this player's turn to do something
      const act = clueTurn ? 'clue' : guessTurn ? 'guess' : bidTurn ? 'bid' : '';
      const key = act ? `${act}:${move}` : '';
      if (actKey !== null && key && key !== actKey) haptics.buzz('bell');
      actKey = key;
    }

    return {
      update: (round) => render(/** @type {View} */ (round.view)),
      message(msg) {
        if (msg?.t !== 'err' || !pending) return;
        showError(REFUSALS[pending] ?? "That can't be done right now.");
        pending = null;
      },
      unmount() {
        word = null;
        last = null;
        root.replaceChildren();
      },
    };
  },

  /** The teams with their words and bricks used (classic) or points (duel). */
  podium(round) {
    const s = /** @type {View} */ (round.view);
    const duel = s.mode === 'duel';
    const lines = s.teams.map((t, i) => `Team ${i + 1} · ${teamNames(s, i)}: ${duel
      ? plural(t.score, 'point')
      : `${plural(t.score, 'word')} found, ${plural(t.used, 'brick')} used`}`);
    const kicker = s.endReason === 'left' ? 'A player left: the round ended with the scores so far.'
      : s.endReason === 'retired' ? 'The game master took a player out: the round ended with the scores so far.' : undefined;
    const ranks = teamRanks(/** @type {any} */ (s));
    return {
      title: ranks[0] === ranks[1] ? "It's a draw! 🎉" : `${teamNames(s, ranks[0] === 1 ? 0 : 1)} win! 🎉`,
      ...(kicker ? { kicker } : {}), lines, rowExtra: (id) => ` ${duel ? 'pt' : 'word'}${s.players[id].score === 1 ? '' : 's'}`,
    };
  },
};
