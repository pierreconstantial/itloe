// TV "show the QR again" timing (public/screen/join-qr.js): extend-only, hides at `until`, stale ignored.
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

test('until ≤ now closes (hideJoin) and never opens; invalid messages are ignored', () => {
  assert.equal(applyJoinQr(null, T - 1, T), null, 'past');
  assert.equal(applyJoinQr(null, T, T), null, 'exactly now');
  assert.equal(applyJoinQr(null, 'soon', T), null);
  assert.equal(applyJoinQr(null, Number.NaN, T), null);
  const w = applyJoinQr(null, T + 30_000, T);
  assert.equal(applyJoinQr(w, T + 5_000, T + 31_000), null, 'expired window + stale until → hidden');
  assert.equal(applyJoinQr(w, T + 10_000, T + 10_000), null, 'until = now on an OPEN window (hideJoin) → closed at once');
  assert.equal(applyJoinQr(w, T + 2_000, T + 10_000), null, 'until in the past on an open window → closed');
  assert.equal(applyJoinQr(w, undefined, T + 1_000), w, 'an invalid message keeps an open window');
  const again = applyJoinQr(w, T + 70_000, T + 40_000);
  assert.deepEqual(again, { until: T + 70_000, from: T + 40_000 }, 'after expiry a fresh request opens a fresh window');
});
