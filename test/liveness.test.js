// Liveness watchdog (public/commun/liveness.js), on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveness } from '../public/commun/liveness.js';

function harness(timeoutMs = 25_000) {
  let t = 0;
  /** @type {{ at: number, fn: () => void, id: number }[]} */
  let timers = [];
  let seq = 0;
  let dead = 0;
  const live = createLiveness({
    onDead: () => { dead++; },
    timeoutMs,
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
  return { live, advance, dead: () => dead, pending: () => timers.length };
}

test('silence for the timeout → onDead once, then stopped', () => {
  const { live, advance, dead, pending } = harness();
  live.start();
  advance(24_999);
  assert.equal(dead(), 0);
  advance(1);
  assert.equal(dead(), 1);
  advance(100_000);
  assert.equal(dead(), 1, 'fires once');
  assert.equal(pending(), 0);
});

test('a message every 10 s (the tick) keeps it alive; silence after the last one counts from it', () => {
  const { live, advance, dead } = harness();
  live.start();
  for (let k = 0; k < 10; k++) { advance(10_000); live.feed(); }
  assert.equal(dead(), 0);
  advance(24_999);
  assert.equal(dead(), 0);
  advance(1);
  assert.equal(dead(), 1);
});

test('feed costs no timer: one pending timer however many messages', () => {
  const { live, advance, pending } = harness();
  live.start();
  for (let k = 0; k < 500; k++) { advance(10); live.feed(); }
  assert.equal(pending(), 1);
});

test('stop() cancels; start() again counts from the restart', () => {
  const { live, advance, dead, pending } = harness();
  live.start();
  advance(20_000);
  live.stop();
  assert.equal(pending(), 0);
  advance(60_000);
  assert.equal(dead(), 0);
  live.start();
  advance(24_000);
  assert.equal(dead(), 0);
  advance(1_000);
  assert.equal(dead(), 1);
});
