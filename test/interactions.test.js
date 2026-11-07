import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTY_ROOM, TRAM_5_ROOM } from '../shared/scene.js';
import { interactionActor, nearbyObject, nearbyProp, objectAction, resolveObjectAction } from '../shared/interactions.js';

test('context action follows the closest furniture and disappears out of reach', () => {
  assert.equal(nearbyObject(PARTY_ROOM, { x: 1.25, y: 6.5 })?.id, 'sofa');
  assert.equal(nearbyObject(PARTY_ROOM, { x: 11, y: 7.6 })?.id, 'table');
  assert.equal(nearbyObject(PARTY_ROOM, { x: 14.9, y: 6 })?.id, 'plant');
  assert.equal(nearbyObject(PARTY_ROOM, { x: 7, y: 7 }), null);
  assert.equal(nearbyObject(PARTY_ROOM, { x: NaN, y: 7 }), null);
});

test('object actions default to everyone and can differ or be denied per player', () => {
  const pierre = { id: 'p-pierre', character: 'pierre' };
  const elo = { id: 'p-elo', character: 'elodie' };
  assert.equal(objectAction('sofa', pierre)?.text, '🛋 Sit');
  assert.equal(objectAction('sofa', elo)?.text, '🛋 Sit');
  assert.equal(objectAction('memory-key-intro', pierre), null);
  assert.equal(objectAction('memory-key-intro', elo)?.text, '🗝️ Pick up key');

  const rule = {
    default: { key: 'look', text: 'Look', feedback: 'Seen.' },
    byCharacter: { elodie: { key: 'remember', text: 'Remember', feedback: 'A memory.' } },
    byPlayer: { 'p-elo': { key: 'open', text: 'Open', feedback: 'Opened.' }, 'p-pierre': null },
  };
  assert.deepEqual(resolveObjectAction(rule, { id: 'p-guest', character: 'anna' }), rule.default);
  assert.deepEqual(resolveObjectAction(rule, { id: 'p-another-elo', character: 'elodie' }), rule.byCharacter.elodie);
  assert.deepEqual(resolveObjectAction(rule, elo), rule.byPlayer['p-elo']);
  assert.equal(resolveObjectAction(rule, pierre), null);
});

test('status and inventory together can change the action on an object', () => {
  const rule = {
    default: { key: 'look', text: 'Look', feedback: 'Seen.' },
    variants: [
      { when: { statuses: ['charged'], items: { 'memory-key-intro': 1 } },
        action: { key: 'illuminate', text: 'Illuminate', feedback: 'The room glows.' } },
      { when: { statuses: ['charged'] }, action: null },
    ],
  };
  const member = { id: 'p-sol', character: 'sol', statuses: ['charged'] };
  const actor = interactionActor(member, { inventory: { sol: { 'memory-key-intro': 1 } } });
  assert.equal(resolveObjectAction(rule, actor)?.key, 'illuminate');
  assert.equal(resolveObjectAction(rule, { ...actor, statuses: [] })?.key, 'look');
  assert.equal(resolveObjectAction(rule, { ...actor, inventory: {} }), null);
  assert.equal(objectAction('table', actor)?.key, 'blow-candles');
  assert.equal(objectAction('table', { ...actor, statuses: ['wisp'] }), null);
  assert.equal(nearbyObject(PARTY_ROOM, { x: 11, y: 7.6 }, { ...actor, statuses: ['wisp'] }), null);
  assert.equal(nearbyProp(PARTY_ROOM, { x: 11, y: 7.6 })?.id, 'table', 'a Wisp can find furniture to shine beside');
});

test('Élodie can talk to the man and request the tram quiz; the dog and automat are scenery', () => {
  const elo = { id: 'p-elo', character: 'elodie', statuses: [] };
  const pierre = { id: 'p-pierre', character: 'pierre', statuses: [] };
  assert.equal(nearbyObject(TRAM_5_ROOM, { x: 10.5, y: 8 }, elo)?.id, 'tram-5-weird-man');
  assert.equal(objectAction('tram-5-weird-man', elo)?.feedback, 'Tschick-Toni: Host a Tschick? I brauch dringend ane!');
  assert.equal(nearbyObject(TRAM_5_ROOM, { x: 10.5, y: 8 }, pierre), null);
  assert.equal(nearbyObject(TRAM_5_ROOM, { x: 10.5, y: 8 }, { ...elo, statuses: ['wisp'] }), null);
  assert.equal(objectAction('tram-5-dog', elo), null);
  assert.equal(objectAction('tram-5-cigarette-automat', elo), null);
  assert.equal(nearbyObject(TRAM_5_ROOM, { x: 7.5, y: 6.8 }, elo)?.id, 'tram-5-tram');
  assert.equal(objectAction('tram-5-tram', elo)?.feedback, 'A ticket for a quizz!');
  assert.equal(objectAction('tram-5-tram', pierre), null);
  assert.equal(TRAM_5_ROOM.props.length, 4);
});
