// The game master's settings sheet, generated from the tableau's minigame's settings schema and wording (its entry in
// ./minigames.js). Any minigame with a schema and a text table gets its sheet for free.
import { $ } from './dom.js';

/** @typedef {Record<string, unknown>} AnySettings */
/**
 * What the sheet needs to show one minigame's settings, and the one-line summary the room and the podium show.
 * @typedef {{
 *   schema: Readonly<Record<string, { kind: string, min?: number, max?: number, step?: number, values?: readonly unknown[] }>>,
 *   text: (key: string) => { label: string, showIf?: (s: AnySettings) => boolean },
 *   format: (key: string, value: unknown) => string,
 *   summarize: (settings: any) => string,
 * }} SettingsKind
 */

/**
 * Fills #settings-body. Every tap sends one `config` patch; the controls show
 * the tableau's settings only (campaign.at.settings), so they update when the server's next view arrives.
 * @param {{ send: (msg: unknown) => void }} io
 */
export function createSettingsSheet(io) {
  /** @param {string} key @param {unknown} value */
  function patch(key, value) {
    io.send({ t: 'config', patch: { [key]: value } });
  }

  /** The kind being shown (labels and formats follow it). @type {SettingsKind | null} */
  let kind = null;

  /** @param {string} key @param {readonly unknown[]} values @param {unknown} current */
  function choiceEl(key, values, current) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const value of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = /** @type {SettingsKind} */ (kind).format(key, value);
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
    minus.setAttribute('aria-label', `Less ${/** @type {SettingsKind} */ (kind).text(key).label.toLowerCase()}`);
    minus.disabled = current <= spec.min;
    minus.addEventListener('click', () => patch(key, Math.max(spec.min, current - spec.step)));
    const value = document.createElement('output');
    value.textContent = /** @type {SettingsKind} */ (kind).format(key, current);
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `More ${/** @type {SettingsKind} */ (kind).text(key).label.toLowerCase()}`);
    plus.disabled = current >= spec.max;
    plus.addEventListener('click', () => patch(key, Math.min(spec.max, current + spec.step)));
    box.append(minus, value, plus);
    return box;
  }

  return {
    /**
     * @param {AnySettings} settings
     * @param {boolean} editable
     * @param {SettingsKind} which the minigame's schema and text
     */
    render(settings, editable, which) {
      kind = which;
      const s = settings;
      const body = $('settings-body');
      body.replaceChildren();
      for (const [key, spec] of Object.entries(which.schema)) {
        const meta = which.text(key);
        if (meta.showIf && !meta.showIf(s)) continue;
        const row = document.createElement('div');
        row.className = 'setting';
        const label = document.createElement('span');
        label.className = 'setting-label';
        label.textContent = meta.label;
        row.append(label, spec.kind === 'choice'
          ? choiceEl(key, /** @type {readonly unknown[]} */ (spec.values), s[key])
          : rangeEl(key, /** @type {{ min: number, max: number, step: number }} */ (spec), Number(s[key])));
        body.append(row);
      }
      if (!editable) for (const b of body.querySelectorAll('button')) b.disabled = true;
    },
  };
}
