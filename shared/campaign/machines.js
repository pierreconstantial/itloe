// Story machines (Contract D v3, docs/story-engine.md): small state machines declared in the content, one per
// scene, NPC, quest or offer. Their current states live in the facts (`facts.machines`), so saving, resuming
// and conditions work as for any other fact. Pure: this file reads machines and answers questions about them;
// the campaign reducer (./index.js) applies their transitions and effects.

import { CHARACTERS } from '../characters.js';
import { holds } from './rules.js';
import { OBJECT_ACTIONS } from '../interactions.js';

/** @typedef {import('./types.js').Content} Content */
/** @typedef {import('./types.js').Facts} Facts */
/** @typedef {import('./types.js').Machine} Machine */
/** @typedef {import('./types.js').MachineState} MachineState */
/** @typedef {import('./types.js').Effect} Effect */
/** @typedef {import('./types.js').Pickup} Pickup */
/** @typedef {import('./types.js').Zone} Zone */
/** @typedef {import('./types.js').Npc} Npc */
/** @typedef {import('./types.js').Offer} Offer */
/** @typedef {import('../interactions.js').ObjectRule} ObjectRule */
/** @typedef {import('../interactions.js').ObjectAction} ObjectAction */

/** A transition the reducer applies: `machine` enters `to`, after the effects `effects`; `from`: the state it was
 *  computed in (a step whose machine has moved on since is stale and skipped). @typedef {{ machine: string, to: string,
 *  effects: Effect[], from?: string }} Step */
/** A machine's current state. @typedef {{ id: string, stateId: string, state: MachineState, since: number }} Current */

/** Every content machine in its initial state: what a new campaign's facts start with.
 * @param {Content} content @returns {Facts['machines']} */
export function initialMachines(content) {
  return Object.fromEntries(Object.entries(content.machines ?? {}).map(([id, m]) => [id, { state: m.initial, since: 0 }]));
}

/**
 * Saved machine states made safe for the content: a machine it no longer has is dropped, a missing machine or
 * a state it lost starts at its initial state.
 * @param {unknown} saved @param {Content} content @returns {Facts['machines']}
 */
export function safeMachines(saved, content) {
  const raw = /** @type {Record<string, { state?: unknown, since?: unknown }>} */ (saved && typeof saved === 'object' ? saved : {});
  return Object.fromEntries(Object.entries(content.machines ?? {}).map(([id, m]) => {
    const s = raw[id];
    const known = typeof s?.state === 'string' && Object.hasOwn(m.states, s.state);
    return [id, known ? { state: /** @type {string} */ (s.state), since: Number(s.since) || 0 } : { state: m.initial, since: 0 }];
  }));
}

/** @type {WeakMap<Facts, { content: Content, list: Current[] }>} */
const currentCache = new WeakMap();

/** Each machine's current state, in content order. @param {Facts} facts @param {Content} content @returns {Current[]} */
export function currentStates(facts, content) {
  const hit = currentCache.get(facts);
  if (hit && hit.content === content) return hit.list;
  const list = Object.entries(content.machines ?? {}).flatMap(([id, m]) => {
    const saved = facts.machines?.[id];
    const stateId = saved && Object.hasOwn(m.states, saved.state) ? saved.state : m.initial;
    return [{ id, stateId, state: m.states[stateId], since: saved?.since ?? 0 }];
  });
  currentCache.set(facts, { content, list });
  return list;
}

/** @param {string | { to: string, do?: Effect[] }} t @param {string} machine @param {string} from @returns {Step} */
const stepOf = (t, machine, from) => (typeof t === 'string' ? { machine, to: t, effects: [], from } : { machine, to: t.to, effects: t.do ?? [], from });

/** The transitions an event triggers: every machine whose current state listens to it, in content order.
 * @param {Facts} facts @param {Content} content @param {string} event @returns {Step[]} */
export function eventSteps(facts, content, event) {
  return currentStates(facts, content).flatMap((c) => {
    const t = c.state.on?.[event];
    return t ? [stepOf(t, c.id, c.stateId)] : [];
  });
}

/** The first condition transition that holds now, or null. @param {Facts} facts @param {Content} content @returns {Step | null} */
export function conditionStep(facts, content) {
  for (const c of currentStates(facts, content)) {
    const w = (c.state.when ?? []).find((x) => holds(x.if, facts));
    if (w) return { machine: c.id, to: w.to, effects: w.do ?? [], from: c.stateId };
  }
  return null;
}

/** The timed transitions due at `now`. @param {Facts} facts @param {Content} content @param {number} now @returns {Step[]} */
export function dueSteps(facts, content, now) {
  return currentStates(facts, content).flatMap((c) => (c.state.after && c.since + c.state.after.ms <= now
    ? [{ machine: c.id, to: c.state.after.to, effects: c.state.after.do ?? [], from: c.stateId }] : []));
}

/** When the next timed transition is due (server clock), or null. @param {Facts} facts @param {Content} content @returns {number | null} */
export function nextTimer(facts, content) {
  const due = currentStates(facts, content).flatMap((c) => (c.state.after ? [c.since + c.state.after.ms] : []));
  return due.length ? Math.min(...due) : null;
}

// ---------------------------------------------------------------- what the current states put in the world

/** The line shown at a node: a current state's hint for it, else the node's first matching hint, else null.
 * @param {Facts} facts @param {Content} content @param {string} node @returns {string | null} */
export function hintAt(facts, content, node) {
  for (const c of currentStates(facts, content)) {
    const hint = c.state.hints?.[node];
    if (hint) return hint;
  }
  return content.nodes[node]?.hints?.find((h) => !h.when || holds(h.when, facts))?.text ?? null;
}

/** Is the chooser held still at this node (a cutscene plays)? @param {Facts} facts @param {Content} content @param {string} node */
export const chooserHeld = (facts, content, node) => currentStates(facts, content).some((c) => c.state.holdChooser === node);

/** The pickups lying at a node. @param {Facts} facts @param {Content} content @param {string} node @returns {Pickup[]} */
export const pickupsAt = (facts, content, node) =>
  currentStates(facts, content).flatMap((c) => (c.state.pickups ?? []).filter((p) => p.node === node));

/** The zones open at a node. @param {Facts} facts @param {Content} content @param {string} node @returns {Zone[]} */
export const zonesAt = (facts, content, node) =>
  currentStates(facts, content).flatMap((c) => (c.state.zones ?? []).filter((z) => z.node === node));

/** NPC lines and emotes, by prop id. @param {Facts} facts @param {Content} content @returns {Record<string, Npc>} */
export const npcsAt = (facts, content) =>
  Object.assign({}, ...currentStates(facts, content).map((c) => c.state.npcs ?? {}));

/** The lines characters say in the current states, each keyed by when its state began (a TV says each one once).
 * @param {Facts} facts @param {Content} content @returns {{ key: string, character: string, text: string }[]} */
export const speechAt = (facts, content) => currentStates(facts, content).flatMap((c) =>
  Object.entries(c.state.speech ?? {}).map(([character, text]) => ({ key: `${c.id}:${c.stateId}:${c.since}:${character}`, character, text })));

/** Props gone from their rooms. @param {Facts} facts @param {Content} content @returns {Set<string>} */
export const hiddenProps = (facts, content) => new Set(currentStates(facts, content).flatMap((c) => c.state.hide ?? []));

/** The offer the chooser's phone shows at a node: one whose target is a child of it, or null.
 * @param {Facts} facts @param {Content} content @param {string} node @returns {Offer | null} */
export function offerAt(facts, content, node) {
  for (const c of currentStates(facts, content)) {
    const o = c.state.offer;
    if (o && content.nodes[o.node]?.parent === node) return o;
  }
  return null;
}

/** A position within reach of a spot. @param {{ x: number, y: number, radius: number }} spot @param {{ x: number, y: number }} pos */
export const within = (spot, pos) => Number.isFinite(pos.x) && Number.isFinite(pos.y) && Math.hypot(pos.x - spot.x, pos.y - spot.y) < spot.radius;

/** @type {WeakMap<Facts, { content: Content, rules: Record<string, ObjectRule> }>} */
const rulesCache = new WeakMap();

/**
 * Every object's interaction rule now: the shared furniture's (OBJECT_ACTIONS), with the current states'
 * objects over it. A state's action list becomes, per character, its first action that character may use and
 * whose condition holds. Machine actions carry `event: true`: using one is a campaign action (`use`).
 * @param {Facts} facts @param {Content} content @returns {Record<string, ObjectRule>}
 */
export function objectRules(facts, content) {
  const hit = rulesCache.get(facts);
  if (hit && hit.content === content) return hit.rules;
  /** @type {Record<string, ObjectRule>} */
  const rules = { ...OBJECT_ACTIONS };
  for (const c of currentStates(facts, content)) {
    for (const [prop, spec] of Object.entries(c.state.objects ?? {})) {
      const open = spec.actions.filter((a) => !a.if || holds(a.if, facts));
      /** @param {import('./types.js').MachineAction} a @returns {ObjectAction} */
      const asAction = (a) => ({ key: a.key, text: a.text, feedback: a.say ?? '', event: true, ...(a.speaker ? { speaker: a.speaker } : {}) });
      /** @param {string} character */
      const forCharacter = (character) => {
        const a = open.find((x) => {
          const by = x.by ?? 'chooser';
          return by === 'anyone' || by === character || (by === 'chooser' && character === content.chooser);
        });
        return a ? asAction(a) : null;
      };
      const anyone = open.find((a) => a.by === 'anyone');
      rules[prop] = {
        default: anyone ? asAction(anyone) : null,
        byCharacter: Object.fromEntries(Object.keys(CHARACTERS).map((ch) => [ch, forCharacter(ch)])),
      };
    }
  }
  rulesCache.set(facts, { content, rules });
  return rules;
}
