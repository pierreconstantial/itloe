/** @typedef {{ key: string, text: string, feedback: string }} ObjectAction */
/** @typedef {{ statuses?: string[], items?: Record<string, number> }} InteractionCondition */
/** @typedef {{ when: InteractionCondition, action: ObjectAction | null }} ConditionalAction */
/** @typedef {{ default: ObjectAction | null, byPlayer?: Record<string, ObjectAction | null>, byCharacter?: Record<string, ObjectAction | null>, variants?: ConditionalAction[] }} ObjectRule */
/** @typedef {{ id: string, character?: string | null, statuses?: string[], inventory?: Record<string, number> }} Actor */

/** Scene objects expose a default action. A null default means only listed players can act. */
export const TRAM_5_MAN_NAME = 'Tschick-Toni';
/** @type {Readonly<Record<string, ObjectRule>>} */
export const OBJECT_ACTIONS = Object.freeze({
  sofa: { default: { key: 'sit', text: '🛋 Sit', feedback: 'Comfy!' } },
  table: { default: { key: 'blow-candles', text: '🎂 Blow candles', feedback: 'Make a wish!' } },
  plant: { default: { key: 'shake', text: '🪴 Shake plant', feedback: 'Rustle!' } },
  'tram-5-tram': { default: null, byCharacter: { elodie: {
    key: 'quiz-offer', text: '🚋 Tram 5', feedback: 'A ticket for a quizz!',
  } } },
  'tram-5-weird-man': { default: null, byCharacter: { elodie: {
    key: 'talk', text: `💬 Talk to ${TRAM_5_MAN_NAME}`,
    feedback: `${TRAM_5_MAN_NAME}: Host a Tschick? I brauch dringend ane!`,
  } } },
  'memory-key-intro': { default: null, byCharacter: { elodie: { key: 'collect', text: '🗝️ Pick up key', feedback: 'A key of memory!' } } },
});

/** @param {Actor | null | undefined} actor @param {InteractionCondition} condition */
export function matchesInteraction(actor, condition) {
  if (!actor) return false;
  return (condition.statuses ?? []).every((status) => actor.statuses?.includes(status))
    && Object.entries(condition.items ?? {}).every(([item, count]) => (actor.inventory?.[item] ?? 0) >= count);
}

/** Player overrides take priority, then character overrides, then the first matching condition, then default.
 * A null override denies interaction. Conditions may require several statuses and inventory items.
 * @param {ObjectRule} rule @param {Actor | null | undefined} actor @returns {ObjectAction | null} */
export function resolveObjectAction(rule, actor) {
  if (actor && Object.hasOwn(rule.byPlayer ?? {}, actor.id)) return rule.byPlayer?.[actor.id] ?? null;
  if (actor?.character && Object.hasOwn(rule.byCharacter ?? {}, actor.character)) {
    return rule.byCharacter?.[actor.character] ?? null;
  }
  for (const variant of rule.variants ?? []) if (matchesInteraction(actor, variant.when)) return variant.action;
  return rule.default;
}

/** Attach the current character inventory to a player for interaction resolution.
 * @param {{id: string, character?: string | null, statuses?: string[]}} member
 * @param {{inventory?: Record<string, Record<string, number>>} | null | undefined} facts @returns {Actor} */
export function interactionActor(member, facts) {
  return { id: member.id, character: member.character, statuses: member.statuses ?? [],
    inventory: facts?.inventory?.[member.character ?? ''] ?? {} };
}

/** @param {string} object @param {Actor | null | undefined} actor @returns {ObjectAction | null} */
export function objectAction(object, actor) {
  if (actor?.statuses?.includes('wisp')) return null;
  const rule = OBJECT_ACTIONS[object];
  return rule ? resolveObjectAction(rule, actor) : null;
}

/** Find the closest physical prop by distance from the player's feet to its base.
 * @param {import('./scene.js').Scene} scene @param {{x: number, y: number}} position
 * @param {(prop: import('./scene.js').Prop) => boolean} eligible
 * @returns {import('./scene.js').Prop | null} */
function closestProp(scene, position, eligible) {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  let best = null;
  let bestDistance = 0.8;
  for (const prop of scene.props) {
    if (!eligible(prop)) continue;
    const base = prop.solid ?? prop.box;
    const dx = Math.max(base.x - position.x, 0, position.x - base.x - base.w);
    const dy = Math.max(base.y - position.y, 0, position.y - base.y - base.h);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) { best = prop; bestDistance = distance; }
  }
  return best;
}

/** A Wisp can shine near furniture without using that furniture's action.
 * @param {import('./scene.js').Scene} scene @param {{x: number, y: number}} position */
export const nearbyProp = (scene, position) => closestProp(scene, position, () => true);

/** Find the closest object this actor may use.
 * @param {import('./scene.js').Scene} scene @param {{x: number, y: number}} position
 * @param {Actor | null} [actor] @returns {import('./scene.js').Prop | null} */
export const nearbyObject = (scene, position, actor = null) => closestProp(scene, position, (prop) => !!objectAction(prop.id, actor));
