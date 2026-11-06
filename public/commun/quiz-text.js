// Quiz settings wording for every client: the game master's sheet (labels, values) and the one-line summary
// on the TV lobby and the phone ("10 questions · 20 s each · mixed answers"). Driven by
// QUIZ_SETTINGS_SCHEMA: a new key gets a label and its raw value with no change here.
import { QUIZ_SETTINGS_SCHEMA } from '../../shared/quiz/index.js';

/** @type {Record<string, { label: string, format: (v: any) => string }>} */
export const QUIZ_TEXT = {
  count: { label: 'Questions', format: (v) => String(v) },
  seconds: { label: 'Time per question', format: (v) => `${v} s` },
  mode: { label: 'Answers', format: (v) => (v === 'choice' ? 'Choices' : v === 'text' ? 'Typed' : 'Mixed') },
};

/** @param {string} key */
export const quizText = (key) => QUIZ_TEXT[key] ?? { label: key, format: (/** @type {unknown} */ v) => String(v) };

/** Value as the settings sheet shows it. @param {string} key @param {unknown} value */
export const formatQuizSetting = (key, value) => quizText(key).format(value);

export { QUIZ_SETTINGS_SCHEMA };

/** "10 questions · 20 s each · mixed answers". @param {{ count: number, seconds: number, mode: string }} s */
export function summarizeQuiz(s) {
  const answers = s.mode === 'choice' ? 'multiple choice' : s.mode === 'text' ? 'typed answers' : 'choices and typed answers';
  return `${s.count} questions · ${s.seconds} s each · ${answers}`;
}
