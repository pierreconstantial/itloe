// The quiz's TV screen, mounted by the frame (./minigames.js) while a quiz runs: question → reveal → …,
// drawn by quiz-view.js from the round's view, the PUBLIC projection (no answer before the reveal); this
// module owns the countdown ring's timer and the sounds. The finished quiz is the frame's podium, with
// each player's right answers and the dataset credits.

import { renderQuestion, renderReveal, creditsOf } from './quiz-view.js';
import { sfx } from './audio.js';
import { secondsLeft } from '../commun/clock.js';
import { summarizeQuiz } from '../commun/quiz-text.js';
import { h, addStylesheet } from './dom.js';

/** @typedef {import('../../shared/quiz/bank.js').QuizView} QuizView */

const RING_MS = 100;

addStylesheet(new URL('./quiz.css', import.meta.url));

/**
 * @param {HTMLElement} root @param {import('./minigames.js').TvIo} _io
 * @returns {import('./minigames.js').Mounted}
 */
function mount(root, _io) {
  /** The quiz in the last view this screen showed. @type {QuizView | null} */
  let quiz = null;
  let lastTick = Infinity;

  /** Countdown ring of the open question: server deadline + clock skew; ticks in the last 5 s. */
  function drawRing() {
    const ring = /** @type {HTMLElement | null} */ (root.querySelector('.quiz-ring'));
    if (!quiz || quiz.phase !== 'question' || !quiz.round || !ring) return;
    const total = Math.max(1, quiz.rules?.seconds ?? 20);
    const left = Math.max(0, secondsLeft(quiz.round.deadline));
    const whole = Math.ceil(left);
    ring.style.setProperty('--left', String(Math.min(1, left / total)));
    ring.classList.toggle('is-urgent', left <= 5);
    const num = ring.querySelector('.quiz-ring-num');
    if (num) num.textContent = String(whole);
    if (left <= 5 && whole > 0 && whole < lastTick) sfx.tick(whole);
    lastTick = Math.min(lastTick, whole);
  }
  const ring = setInterval(drawRing, RING_MS);

  return {
    update(round) {
      const q = /** @type {QuizView} */ (round.view);
      const prev = quiz;
      quiz = q;
      const roundChanged = q.round && (!prev?.round || prev.round.index !== q.round.index);
      if (q.phase === 'question' && roundChanged) { lastTick = Infinity; sfx.start(); }
      if (q.phase === 'reveal' && prev?.phase === 'question') sfx.reveal();
      if (q.phase === 'question' && q.round) root.replaceChildren(renderQuestion(q));
      else if (q.phase === 'reveal' && q.round) root.replaceChildren(renderReveal(q));
      drawRing();
    },
    message() {},
    unmount() {
      clearInterval(ring);
      root.replaceChildren();
    },
  };
}

/** The quiz's entry in the TV's list (./minigames.js). @type {import('./minigames.js').TvScreen} */
export const QUIZ_SCREEN = {
  title: 'Quiz!',
  settings: { summarize: summarizeQuiz },
  mount,
  /** Each player's right answers, and the dataset attribution (licences such as CC BY-SA require it). */
  podium(round) {
    const q = /** @type {QuizView} */ (round.view);
    const credits = creditsOf(q);
    return {
      title: 'Quiz podium',
      rowExtra: (id) => [h('span', 'rank-correct', [`${q.players[id].correct}/${q.total} ✓`])],
      lines: credits.length ? [h('p', 'quiz-credits', [credits.join(' · ')])] : [], // the lines say what they credit
    };
  },
};
