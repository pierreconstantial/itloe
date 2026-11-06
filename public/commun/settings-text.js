// How settings read, for every client: the game master's settings sheet (labels, values) and the one-line
// summary on the TV and the phone ("9×9 · timed 3:00 · simple set"). Driven by SETTINGS_SCHEMA: a new
// schema key gets a label and a summary slot with no change here (TEXT only adds nicer wording).
// Summary rule: size and mode always; any other key only when it differs from DEFAULT_SETTINGS.
import { SETTINGS_SCHEMA, DEFAULT_SETTINGS } from '../../shared/game.js';
import { mmss } from './clock.js';

/** @typedef {import('../../shared/game.js').Settings} Settings */
/** @typedef {Record<string, unknown>} AnySettings */

/**
 * @typedef {{
 *   label: string,                                   // settings sheet row
 *   format?: (v: any) => string,                     // settings sheet value
 *   always?: boolean,                                // in the summary even at its default
 *   summary?: (v: any, s: AnySettings) => string,    // summary wording ('' = leave out)
 *   showIf?: (s: AnySettings) => boolean,            // control + summary only when true
 * }} SettingText
 */

/** @type {Record<string, SettingText>} */
export const SETTING_TEXT = {
  size: { label: 'Board', format: (v) => `${v}×${v}`, always: true, summary: (v) => `${v}×${v}` },
  mode: {
    label: 'Mode',
    format: (v) => (v === 'timed' ? 'Timed' : 'Marathon'),
    always: true,
    summary: (v, s) => (v === 'timed' ? `timed ${mmss(Number(s.timedSeconds))}` : 'marathon'),
  },
  timedSeconds: { label: 'Time limit', format: (v) => mmss(v), showIf: (s) => s.mode === 'timed', summary: () => '' }, // inside mode
  pieceSet: { label: 'Pieces', format: (v) => (v === 'simple' ? 'Simple' : 'Full'), summary: (v) => `${v} set` },
  grace: { label: 'Combo grace', format: (v) => String(v), summary: (v) => (v === 0 ? 'no combo grace' : `combo grace ${v}`) },
  cleanBoardBonus: { label: 'Clean-board bonus', format: (v) => `+${v}`, summary: (v) => `clean board +${v}` },
};

const DEFAULTS = /** @type {AnySettings} */ (/** @type {unknown} */ (DEFAULT_SETTINGS));

/** @param {string} key @returns {SettingText} */
export function settingText(key) {
  return SETTING_TEXT[key] ?? { label: key };
}

/** Value as the settings sheet shows it. @param {string} key @param {unknown} value */
export function formatSetting(key, value) {
  const f = settingText(key).format;
  return f ? f(value) : String(value);
}

/** "9×9 · timed 3:00 · simple set". @param {Settings} settings @returns {string} */
export function summarizeSettings(settings) {
  const s = /** @type {AnySettings} */ (/** @type {unknown} */ (settings));
  const parts = [];
  for (const key of Object.keys(SETTINGS_SCHEMA)) {
    const t = settingText(key);
    if (t.showIf && !t.showIf(s)) continue;
    const v = s[key];
    if (!t.always && v === DEFAULTS[key]) continue;
    const text = t.summary ? t.summary(v, s) : `${t.label.toLowerCase()} ${formatSetting(key, v)}`;
    if (text) parts.push(text);
  }
  return parts.join(' · ');
}
