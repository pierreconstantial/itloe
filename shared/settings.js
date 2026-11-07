// A minigame's settings against its schema (the data a settings sheet reads, public/play/settings-ui.js): what a
// patch may change, and what's wrong with a content node's settings. Pure JSDoc ESM.

/**
 * A schema: per key, a choice among `values`, or an integer from `min` to `max` in steps of `step` from `min`.
 * @typedef {Readonly<Record<string, { kind: 'range', min: number, max: number, step: number } | { kind: 'choice', values: readonly unknown[] }>>} SettingsSchema
 */

/**
 * `base` with every key of `patch` the schema allows at that value; the rest is dropped.
 * @template {object} T
 * @param {SettingsSchema} schema @param {T} base @param {unknown} patch @returns {T}
 */
export function mergeBySchema(schema, base, patch) {
  const out = /** @type {Record<string, unknown>} */ ({ ...base });
  if (!patch || typeof patch !== 'object') return /** @type {T} */ (out);
  const p = /** @type {Record<string, unknown>} */ (patch);
  for (const [key, spec] of Object.entries(schema)) {
    const v = p[key];
    if (v === undefined) continue;
    if (spec.kind === 'range' && typeof v === 'number' && Number.isInteger(v) && v >= spec.min && v <= spec.max && (v - spec.min) % spec.step === 0) out[key] = v;
    if (spec.kind === 'choice' && spec.values.includes(v)) out[key] = v;
  }
  return /** @type {T} */ (out);
}

/**
 * Problems in a content node's settings, as readable lines (empty: valid): a key `defaults` doesn't have, or a
 * value `merge` would drop or change.
 * @template {object} T
 * @param {T} defaults @param {(base: T, patch: unknown) => T} merge @param {unknown} settings @returns {string[]}
 */
export function settingsProblems(defaults, merge, settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return ['settings must be an object'];
  return Object.entries(settings).flatMap(([key, v]) => {
    if (!Object.hasOwn(defaults, key)) return [`unknown setting "${key}"`];
    const kept = /** @type {Record<string, unknown>} */ (merge(defaults, { [key]: v }))[key];
    return JSON.stringify(kept) === JSON.stringify(v) ? [] : [`setting "${key}" can't be ${JSON.stringify(v)}`];
  });
}
