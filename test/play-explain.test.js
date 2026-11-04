// Phone "why locked" readout (public/play/campaign-view.js explain): Contract F `has` leaves in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../public/play/campaign-view.js';
import { emptyFacts } from '../shared/campaign/index.js';

/** Facts where Élodie holds one old key (the sample catalogue's 🗝️). */
const withKey = () => ({ ...emptyFacts(), inventory: { elodie: { 'old-key': 1 } } });

test('has: icon + item name + who, ✓/✗ from the inventory', () => {
  assert.equal(explain({ has: 'old-key', who: 'elodie' }, emptyFacts()), '🗝️ Old key (placeholder) — Élodie ✗');
  assert.equal(explain({ has: 'old-key', who: 'elodie' }, withKey()), '🗝️ Old key (placeholder) — Élodie ✓');
  assert.equal(explain({ has: 'old-key', who: 'sol' }, withKey()), '🗝️ Old key (placeholder) — Sol ✗', 'held by someone else');
});

test('has: anyone by default, and a count when more than one is needed', () => {
  assert.equal(explain({ has: 'old-key' }, withKey()), '🗝️ Old key (placeholder) — anyone ✓');
  assert.equal(explain({ has: 'old-key', who: 'anyone', gte: 2 }, withKey()), '×2 🗝️ Old key (placeholder) — anyone ✗');
});

test('has inside all/any reads naturally', () => {
  const text = explain({ all: [{ has: 'old-key' }, { flag: 'door-open' }] }, withKey());
  assert.equal(text, 'all of (🗝️ Old key (placeholder) — anyone ✓, flag door-open ✗)');
});
