// TV "show the QR again" timing (public/screen/join-qr.js): extend-only, hides at `until`, closes on hideJoin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJoinQr, joinQrState } from '../public/screen/join-qr.js';

const T = 1_700_000_000_000;

test('opens until `until`, the bar shrinks 1 → 0, hides by itself at until', () => {
  const w = applyJoinQr(null, T + 30_000, T);
  assert.deepEqual(w, { until: T + 30_000, from: T });
  assert.deepEqual(joinQrState(w, T), { visible: true, secondsLeft: 30, fraction: 1 });
  const half = joinQrState(w, T + 15_000);
  assert.equal(half.visible, true);
  assert.equal(half.fraction, 0.5);
  assert.equal(half.secondsLeft, 15);
  assert.equal(joinQrState(w, T + 29_999).visible, true);
  assert.equal(joinQrState(w, T + 30_000).visible, false, 'gone exactly at until');
});

test('a later joinQr extends (bar refills to the new span); an earlier one never shortens', () => {
  const w = applyJoinQr(null, T + 30_000, T);
  const ext = applyJoinQr(w, T + 40_000, T + 10_000);
  assert.deepEqual(ext, { until: T + 40_000, from: T + 10_000 });
  assert.equal(joinQrState(ext, T + 10_000).fraction, 1);
  assert.equal(applyJoinQr(ext, T + 35_000, T + 12_000), ext, 'shorter: same object');
  assert.equal(applyJoinQr(ext, T + 40_000, T + 12_000), ext, 'same until: same object');
});

test('hideJoin (until = now) closes an open window at once', () => {
  const w = applyJoinQr(null, T + 30_000, T);
  assert.equal(applyJoinQr(w, T + 10_000, T + 10_000), null);
});
