// Slice 2b — TV presence debounce (public/screen/presence.js), on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresence } from '../public/screen/presence.js';

function harness() {
  let t = 0;
  /** @type {{ at: number, fn: () => void, id: number }[]} */
  let timers = [];
  let seq = 0;
  let changes = 0;
  const p = createPresence({
    onChange: () => { changes++; },
    graceMs: 2000,
    now: () => t,
    later: (fn, ms) => { const id = ++seq; timers.push({ at: t + ms, fn, id }); return id; },
    cancel: (id) => { timers = timers.filter((x) => x.id !== id); },
  });
  /** @param {number} ms */
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers = timers.filter((x) => x !== next);
      t = next.at;
      next.fn();
    }
    t = end;
  };
  return { p, advance, changes: () => changes };
}

test('a dropped player shows offline only after the grace period', () => {
  const { p, advance, changes } = harness();
  p.update(['a', 'b'], ['a', 'b']);
  p.update(['a'], ['a', 'b']);
  advance(1999);
  assert.equal(p.isOffline('b'), false);
  assert.equal(changes(), 0);
  advance(1);
  assert.equal(p.isOffline('b'), true);
  assert.equal(changes(), 1, 'one change, fired by the timer (no new view needed)');
});

test('a reconnect blip shorter than the grace never shows (no flicker)', () => {
  const { p, advance, changes } = harness();
  p.update(['a', 'b'], ['a', 'b']);
  p.update(['a'], ['a', 'b']);
  advance(1500);
  p.update(['a', 'b'], ['a', 'b']);
  advance(5000);
  assert.equal(p.isOffline('b'), false);
  assert.equal(changes(), 0);
});

test('back online clears at once; the grace restarts on the next drop', () => {
  const { p, advance } = harness();
  p.update([], ['a']);
  advance(2000);
  assert.equal(p.isOffline('a'), true);
  p.update(['a'], ['a']);
  assert.equal(p.isOffline('a'), false);
  p.update([], ['a']);
  advance(1000);
  assert.equal(p.isOffline('a'), false);
  advance(1000);
  assert.equal(p.isOffline('a'), true);
});

test('repeated views while missing keep the original drop time', () => {
  const { p, advance } = harness();
  p.update(['a'], ['a', 'b']);
  advance(1000);
  p.update(['a'], ['a', 'b']);
  advance(1000);
  assert.equal(p.isOffline('b'), true);
});

test('no `online` field (mock server) → nobody offline; players who left are forgotten', () => {
  const { p, advance } = harness();
  p.update(undefined, ['a', 'b']);
  advance(5000);
  assert.deepEqual([...p.offline()], []);
  p.update([], ['a', 'b']);
  advance(2000);
  assert.deepEqual([...p.offline()].sort(), ['a', 'b']);
  p.update([], ['a']);
  assert.deepEqual([...p.offline()], ['a']);
});
