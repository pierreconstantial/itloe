// Host settings sheet + one-line summary, both generated from shared SETTINGS_SCHEMA.
// A new schema entry gets a control and a summary slot with no change here: META only
// adds nicer wording, and unknown keys fall back to the key name and String(value).
import { SETTINGS_SCHEMA, DEFAULT_SETTINGS } from '../../shared/game.js';
import { $ } from './dom.js';
import { mmss } from '../commun/clock.js';

/** @typedef {import('../../shared/game.js').Settings} Settings */
/** @typedef {Record<string, unknown>} AnySettings */

/**
 * @typedef {{
 *   label: string,
 *   format?: (v: any) => string,
 *   summary?: (v: any, s: AnySettings) => string,  // '' leaves the key out of the summary
 *   showIf?: (s: AnySettings) => boolean,           // hide the control (and summary) when false
 * }} Meta
 * Without `summary`, a key shows in the summary only when it differs from DEFAULT_SETTINGS.
 */

/** @type {Record<string, Meta>} */
const META = {
  size: { label: 'Board', format: (v) => `${v}×${v}`, summary: (v) => `${v}×${v}` },
  mode: {
    label: 'Mode',
    format: (v) => (v === 'timed' ? 'Timed' : 'Marathon'),
    summary: (v, s) => (v === 'timed' ? `timed ${mmss(Number(s.timedSeconds))}` : 'marathon'),
  },
  timedSeconds: { label: 'Time limit', format: (v) => mmss(v), showIf: (s) => s.mode === 'timed', summary: () => '' },
  pieceSet: { label: 'Pieces', format: (v) => (v === 'simple' ? 'Simple' : 'Full'), summary: (v) => `${v} set` },
  grace: { label: 'Combo grace', format: (v) => String(v) },
  cleanBoardBonus: { label: 'Clean-board bonus', format: (v) => `+${v}` },
};

const DEFAULTS = /** @type {AnySettings} */ (/** @type {unknown} */ (DEFAULT_SETTINGS));

/** @param {string} key @returns {Meta} */
function describe(key) {
  return META[key] ?? { label: key };
}

/** @param {string} key @param {unknown} value */
function format(key, value) {
  const f = describe(key).format;
  return f ? f(value) : String(value);
}

/** "9×9 · timed 3:00 · simple set". @param {Settings} settings @returns {string} */
export function summarize(settings) {
  const s = /** @type {AnySettings} */ (/** @type {unknown} */ (settings));
  const parts = [];
  for (const key of Object.keys(SETTINGS_SCHEMA)) {
    const meta = describe(key);
    if (meta.showIf && !meta.showIf(s)) continue;
    const v = s[key];
    const text = meta.summary
      ? meta.summary(v, s)
      : v === DEFAULTS[key] ? '' : `${meta.label.toLowerCase()} ${format(key, v)}`;
    if (text) parts.push(text);
  }
  return parts.join(' · ');
}

/**
 * Fills #settings-body. Every tap sends one `config` patch; the controls show
 * state.settings only, so they update when the server's next view arrives.
 * @param {{ send: (msg: unknown) => void }} io
 */
export function createSettingsSheet(io) {
  /** @param {string} key @param {unknown} value */
  function patch(key, value) {
    io.send({ t: 'config', patch: { [key]: value } });
  }

  /** @param {string} key @param {readonly unknown[]} values @param {unknown} current */
  function choiceEl(key, values, current) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const value of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = format(key, value);
      if (value === current) b.classList.add('on');
      b.addEventListener('click', () => { if (value !== current) patch(key, value); });
      seg.append(b);
    }
    return seg;
  }

  /** @param {string} key @param {{ min: number, max: number, step: number }} spec @param {number} current */
  function rangeEl(key, spec, current) {
    const box = document.createElement('div');
    box.className = 'stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `Less ${describe(key).label.toLowerCase()}`);
    minus.disabled = current <= spec.min;
    minus.addEventListener('click', () => patch(key, Math.max(spec.min, current - spec.step)));
    const value = document.createElement('output');
    value.textContent = format(key, current);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `More ${describe(key).label.toLowerCase()}`);
    plus.disabled = current >= spec.max;
    plus.addEventListener('click', () => patch(key, Math.min(spec.max, current + spec.step)));
    box.append(minus, value, plus);
    return box;
  }

  return {
    /** @param {Settings} settings @param {boolean} editable */
    render(settings, editable) {
      const s = /** @type {AnySettings} */ (/** @type {unknown} */ (settings));
      const body = $('settings-body');
      body.replaceChildren();
      for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
        const meta = describe(key);
        if (meta.showIf && !meta.showIf(s)) continue;
        const row = document.createElement('div');
        row.className = 'setting';
        const label = document.createElement('span');
        label.className = 'setting-label';
        label.textContent = meta.label;
        row.append(label, spec.kind === 'choice'
          ? choiceEl(key, /** @type {readonly unknown[]} */ (spec.values), s[key])
          : rangeEl(key, spec, Number(s[key])));
        body.append(row);
      }
      if (!editable) for (const b of body.querySelectorAll('button')) b.disabled = true;
    },
  };
}
