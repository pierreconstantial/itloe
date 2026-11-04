// Quiz settings for the phone's settings sheet. The wording lives in ONE place, public/commun/quiz-text.js
// (shared with the TV); this only adapts it to the sheet's SettingsKind shape.
import { QUIZ_SETTINGS_SCHEMA, quizText, formatQuizSetting, summarizeQuiz } from '../commun/quiz-text.js';

export { summarizeQuiz };

/** @type {import('./settings-ui.js').SettingsKind} */
export const QUIZ_SETTINGS = { schema: QUIZ_SETTINGS_SCHEMA, text: quizText, format: formatQuizSetting };
