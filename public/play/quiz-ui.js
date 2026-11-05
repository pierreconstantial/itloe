// Phone quiz screens (Contract E), mounted by the frame (./minigames.js): render strictly from the view's
// PUBLIC quiz (shared/quiz/bank.js projectQuiz), which never carries an answer before the reveal. Between
// quizzes the party is in the room (main.js); phases here:
// question (4 big choices or a typed answer; one shot), reveal (my verdict + points, the answer, everyone's
// answers; host: overrides + next). The finished quiz is the frame's podium, with each player's right answers.
// Controls are built once per question, so a view arriving mid-typing never resets the text field.
import { $, addStylesheet } from './dom.js';
import * as haptics from './haptics.js';
import { createConfirm } from './confirm.js';
import { secondsLeft, mmss } from '../commun/clock.js';
import { SCORING, MAX_TEXT } from '../../shared/quiz/index.js';
import { QUIZ_SETTINGS } from './quiz-text.js';

/** @typedef {import('../../shared/quiz/bank.js').QuizView} QuizView */
/** @typedef {import('../../shared/quiz/bank.js').RoundView} RoundView */

const URGENT_SECONDS = 5;
const TICK_MS = 250; // the countdown's refresh
const PHASES = ['question', 'reveal'];

/** French typography: a narrow no-break space before ? ! : ; » (never orphaned at a line start). @param {string} s */
const frenchSpaces = (s) => s.replace(/\s+([?!:;»])/g, '\u202f$1').replace(/«\s+/g, '«\u202f');

/** A round's identity on this phone (the projection has no question id): index + question text. @param {RoundView} r */
const roundKey = (r) => `${r.index}|${r.question.q}`;

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** @param {{ send: (msg: unknown) => void }} io */
export function createQuizUi(io) {
  /** @type {QuizView | null} */ let last = null;
  /** @type {string} */ let meId = '';
  /** Am I the party's host (the quiz stores no host)? */ let amHost = false;
  /** What I sent this round (the view only says THAT I answered). @type {{ key: string, choice?: number, text?: string } | null} */
  let mine = null;
  /** Round whose question controls are built. */ let builtKey = '';
  /** Round whose verdict already buzzed. */ let buzzedKey = '';
  const confirm = createConfirm(() => { if (last) render(last, meId); });

  const input = /** @type {HTMLInputElement} */ ($('quiz-text'));
  input.maxLength = MAX_TEXT;

  $('quiz-text-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const r = last?.round;
    if (!text || !r || last?.phase !== 'question' || mine?.key === roundKey(r)) return;
    mine = { key: roundKey(r), text };
    io.send({ t: 'answer', text });
    haptics.buzz('place');
    input.blur(); // the keyboard goes away: the answer is sent
    render(/** @type {QuizView} */ (last), meId);
  });
  $('quiz-next').addEventListener('click', () => io.send({ t: 'next' }));

  /** @param {number} choice @param {RoundView} r */
  function pick(choice, r) {
    if (last?.phase !== 'question' || mine?.key === roundKey(r)) return;
    mine = { key: roundKey(r), choice };
    io.send({ t: 'answer', choice });
    haptics.buzz('place');
    render(/** @type {QuizView} */ (last), meId);
  }

  /** Builds the question's controls once per round (choices, or the text field emptied). @param {RoundView} r */
  function buildQuestion(r) {
    const key = roundKey(r);
    if (builtKey === key) return;
    builtKey = key;
    const box = $('quiz-choices');
    box.replaceChildren(...(r.question.choices ?? []).map((c, i) => {
      const b = /** @type {HTMLButtonElement} */ (el('button', `quiz-choice c${(i % 4) + 1}`, c));
      b.type = 'button';
      b.dataset.choice = String(i);
      b.addEventListener('click', () => pick(i, r));
      return b;
    }));
    input.value = '';
  }

  /** Who answered (question) — chips, never what. @param {QuizView} v @param {RoundView} r */
  function renderAnswered(v, r) {
    const ul = $('quiz-answered');
    ul.replaceChildren(...v.order.filter((id) => !v.players[id].left).map((id) => {
      const done = r.answered.includes(id);
      return el('li', done ? 'done' : '', `${done ? '✓ ' : '… '}${v.players[id].name}`);
    }));
  }

  /** @param {QuizView} v @param {RoundView} r */
  function renderQuestion(v, r) {
    buildQuestion(r);
    $('quiz-category').textContent = r.question.category ? `${r.question.category}${r.question.level ? ` · ${'★'.repeat(r.question.level)}` : ''}` : '';
    $('quiz-q').textContent = frenchSpaces(r.question.q);
    const out = !!v.players[meId]?.left; // taken out by the host: no more answers, the score counts
    const sent = out || r.answered.includes(meId) || mine?.key === roundKey(r);
    const asChoice = !!r.question.choices;
    $('quiz-choices').hidden = !asChoice;
    $('quiz-text-form').hidden = asChoice;
    for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('#quiz-choices button'))) {
      b.disabled = sent;
      b.classList.toggle('mine', mine?.key === roundKey(r) && mine.choice === Number(b.dataset.choice));
    }
    input.disabled = sent;
    /** @type {HTMLButtonElement} */ ($('quiz-send')).disabled = sent;
    if (sent && mine?.text !== undefined && mine.key === roundKey(r)) input.value = mine.text;
    $('quiz-sent').hidden = !sent;
    $('quiz-sent').textContent = out ? 'The host took you out — your score counts' : 'Answer sent ✓';
    renderAnswered(v, r);
  }

  /** @param {QuizView} v @param {RoundView} r @param {string} id */
  function answerShown(v, r, id) {
    const a = r.answers?.[id];
    if (!a) return '—';
    if (a.choice !== undefined) return r.question.choices?.[a.choice] ?? '?';
    return a.text ?? '?';
  }

  /** @param {QuizView} v @param {RoundView} r */
  function renderReveal(v, r) {
    const key = roundKey(r);
    const a = r.answers?.[meId];
    const verdict = $('quiz-verdict');
    const seated = !!v.players[meId];
    if (!seated) { verdict.textContent = ''; verdict.className = 'quiz-verdict'; }
    else if (!a) { verdict.textContent = 'No answer'; verdict.className = 'quiz-verdict none'; }
    else if (a.ok === null) { verdict.textContent = 'Judging…'; verdict.className = 'quiz-verdict pending'; }
    else if (a.ok) {
      const bonus = a.points - SCORING.right;
      verdict.textContent = `✓ Right! +${a.points}`;
      if (bonus > 0) verdict.append(el('small', 'bonus', `incl. ${bonus} speed bonus`));
      verdict.className = 'quiz-verdict right';
    } else { verdict.textContent = '✗ Wrong'; verdict.className = 'quiz-verdict wrong'; }
    // buzz once per round, when my verdict is known
    if (a && a.ok !== null && buzzedKey !== key) { buzzedKey = key; haptics.buzz(a.ok ? 'right' : 'wrong'); }

    $('quiz-answer').textContent = r.answer?.choice != null ? (r.question.choices?.[r.answer.choice] ?? r.answer.text) : (r.answer?.text ?? '');
    $('quiz-reveal-q').textContent = frenchSpaces(r.question.q);
    const anecdote = $('quiz-anecdote');
    anecdote.hidden = !r.answer?.anecdote;
    anecdote.textContent = r.answer?.anecdote ? `💡 ${frenchSpaces(r.answer.anecdote)}` : '';

    const host = amHost;
    const ul = $('quiz-results');
    ul.replaceChildren(...v.order.map((id) => {
      const p = v.players[id];
      const ans = r.answers?.[id];
      const li = el('li', id === meId ? 'me' : '');
      const mark = !ans ? '·' : ans.ok === null ? '…' : ans.ok ? '✓' : '✗';
      li.append(
        el('span', `mark ${!ans ? '' : ans.ok === null ? 'pending' : ans.ok ? 'right' : 'wrong'}`, mark),
        el('span', 'who', p.name),
        el('span', 'what', answerShown(v, r, id)),
        el('span', 'pts', ans?.ok ? `+${ans.points}` : ''),
      );
      if (host && ans && v.phase === 'reveal') {
        const to = !(ans.ok === true); // flip: right ↔ wrong (a pending one is marked right)
        const k = `ovr:${key}:${id}:${to}`;
        const b = /** @type {HTMLButtonElement} */ (el('button', 'override', confirm.isArmed(k) ? 'Tap again' : to ? 'Mark right' : 'Mark wrong'));
        b.type = 'button';
        b.dataset.override = id;
        b.classList.toggle('armed', confirm.isArmed(k));
        b.addEventListener('click', () => confirm.tap(k, () => io.send({ t: 'override', target: id, ok: to })));
        li.append(b);
      }
      return li;
    }));
    const isLast = r.index + 1 >= r.total;
    $('quiz-next').hidden = !host || v.phase !== 'reveal';
    $('quiz-next').textContent = isLast ? 'See the results' : 'Next question';
    $('quiz-reveal-hint').hidden = host || v.phase !== 'reveal';
  }

  /** @param {QuizView} v @param {string} id @param {boolean} [host] am I the party's host (default: as last time) */
  function render(v, id, host = amHost) {
    last = v;
    meId = id;
    amHost = host;
    for (const ph of PHASES) $(`quiz-${ph}`).hidden = v.phase !== ph;
    const r = v.round;
    $('quiz-progress').textContent = r ? `Question ${r.index + 1}/${r.total}` : 'Quiz';
    const me = v.players[id];
    $('quiz-score').textContent = me ? `${me.score} pts` : '';

    if (v.phase === 'question' && r) renderQuestion(v, r);
    if (v.phase === 'reveal' && r) renderReveal(v, r);
    tick();
  }

  /** The countdown, every clock tick (deadline from the server, corrected by the clock skew). */
  function tick() {
    const v = last;
    const clock = $('quiz-clock');
    const open = v?.phase === 'question' && v.round;
    clock.hidden = !open;
    if (!open || !v?.round) return;
    const left = secondsLeft(v.round.deadline);
    clock.textContent = mmss(left);
    clock.classList.toggle('urgent', left <= URGENT_SECONDS);
  }

  return { render, tick, stop: confirm.disarm };
}

addStylesheet(new URL('./quiz.css', import.meta.url));

const MARKUP = `
  <section id="view-quiz">
    <header class="quiz-top">
      <span id="quiz-progress" class="kicker">Quiz</span>
      <span id="quiz-clock" class="clock" hidden></span>
      <span id="quiz-score" class="quiz-score"></span>
    </header>

    <div id="quiz-question" class="quiz-pane" hidden>
      <p id="quiz-category" class="dim"></p>
      <h2 id="quiz-q"></h2>
      <div id="quiz-choices" class="quiz-choices"></div>
      <form id="quiz-text-form" class="quiz-text-form" hidden>
        <input id="quiz-text" type="text" lang="fr" inputmode="text" enterkeyhint="send" placeholder="Your answer"
               autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" aria-label="Your answer">
        <button id="quiz-send" type="submit" class="primary">Send</button>
      </form>
      <p id="quiz-sent" class="quiz-sent" hidden>Answer sent ✓</p>
      <ul id="quiz-answered" class="quiz-chips"></ul>
    </div>

    <div id="quiz-reveal" class="quiz-pane" hidden>
      <p id="quiz-verdict" class="quiz-verdict"></p>
      <p id="quiz-reveal-q" class="dim"></p>
      <p class="quiz-correct">Answer: <strong id="quiz-answer"></strong></p>
      <p id="quiz-anecdote" class="quiz-anecdote" hidden></p>
      <ul id="quiz-results" class="quiz-results"></ul>
      <button id="quiz-next" type="button" class="primary" hidden>Next question</button>
      <p id="quiz-reveal-hint" class="dim">Waiting for the host…</p>
    </div>
  </section>
`;

/** The quiz's entry in the phone's list (./minigames.js). @type {import('./minigames.js').PhoneScreen} */
export const QUIZ_SCREEN = {
  title: 'Quiz!',
  settings: QUIZ_SETTINGS,
  mount(root, io) {
    root.insertAdjacentHTML('beforeend', MARKUP);
    const ui = createQuizUi(io);
    const clock = setInterval(ui.tick, TICK_MS);
    return {
      update: (round) => ui.render(round.view, io.meId(), io.isHost()),
      message: () => {},
      unmount() {
        clearInterval(clock);
        ui.stop();
        root.replaceChildren();
      },
    };
  },
  /** Each player's right answers; the host's end in the quiz's words. */
  podium(round) {
    const v = /** @type {QuizView} */ (round.view);
    return {
      ...(v.endReason === 'host' ? { kicker: 'The host ended the quiz.' } : {}),
      rowExtra: (id) => ` (${v.players[id].correct} ✓)`,
    };
  },
};
