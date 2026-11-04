// One settings summary for TV and phone (public/commun/settings-text.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../shared/game.js';
import { formatSetting, summarizeSettings } from '../public/commun/settings-text.js';

test('defaults: size and mode only (no "full set")', () => {
  assert.equal(summarizeSettings(DEFAULT_SETTINGS), `${DEFAULT_SETTINGS.size}×${DEFAULT_SETTINGS.size} · marathon`);
});

test('non-defaults appear, timed carries its time', () => {
  const s = { ...DEFAULT_SETTINGS, size: /** @type {const} */ (9), mode: /** @type {const} */ ('timed'), timedSeconds: 90, pieceSet: /** @type {const} */ ('simple'), grace: /** @type {const} */ (0), cleanBoardBonus: DEFAULT_SETTINGS.cleanBoardBonus + 50 };
  assert.equal(summarizeSettings(s), `9×9 · timed 1:30 · simple set · no combo grace · clean board +${s.cleanBoardBonus}`);
});

test('a timedSeconds change in marathon mode is not shown', () => {
  assert.equal(summarizeSettings({ ...DEFAULT_SETTINGS, timedSeconds: 60 }), summarizeSettings(DEFAULT_SETTINGS));
});

test('sheet values', () => {
  assert.equal(formatSetting('size', 9), '9×9');
  assert.equal(formatSetting('pieceSet', 'simple'), 'Simple');
  assert.equal(formatSetting('unknownKey', 3), '3');
});
