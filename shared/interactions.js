/** `event`: a story machine's action, sent to the campaign as `use`; `speaker`: the prop (`'object'`) or the
 * character acted on (`'target'`) says the feedback, not the actor.
 * @typedef {{ key: string, text: string, feedback: string, event?: true, speaker?: 'object' | 'target' }} ObjectAction */
/** @typedef {{ statuses?: string[], items?: Record<string, number> }} InteractionCondition */
/** @typedef {{ when: InteractionCondition, action: ObjectAction | null }} ConditionalAction */
/** @typedef {{ default: ObjectAction | null, byPlayer?: Record<string, ObjectAction | null>, byCharacter?: Record<string, ObjectAction | null>, variants?: ConditionalAction[] }} ObjectRule */
/** @typedef {{ id: string, character?: string | null, statuses?: string[], inventory?: Record<string, number> }} Actor */

/** The shared furniture's actions. A null default means only listed players can act. Story objects come from
 *  the content's machines (shared/campaign/machines.js: objectRules), which pass the full rule set here.
 * @type {Readonly<Record<string, ObjectRule>>} */
export const OBJECT_ACTIONS = Object.freeze({
  sofa: { default: { key: 'sit', text: '🛋 Sit', feedback: 'Comfy!' } },
  table: { default: { key: 'blow-candles', text: '🎂 Blow candles', feedback: 'Make a wish!' } },
  plant: { default: { key: 'shake', text: '🪴 Shake plant', feedback: 'Rustle!' } },
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

/** @param {string} object @param {Actor | null | undefined} actor
 * @param {Readonly<Record<string, ObjectRule>>} [rules] the rules in force (objectRules), default the furniture's
 * @returns {ObjectAction | null} */
export function objectAction(object, actor, rules = OBJECT_ACTIONS) {
  if (actor?.statuses?.includes('wisp')) return null;
  const rule = rules[object];
  return rule ? resolveObjectAction(rule, actor) : null;
}

/** How far a player reaches: from their feet to a prop's base, or to another character's feet. */
export const REACH = 0.8;

/** Another character's feet within reach of a player's. @param {{x: number, y: number}} a @param {{x: number, y: number}} b */
export const feetInReach = (a, b) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(b.x) && Number.isFinite(b.y)
  && Math.hypot(a.x - b.x, a.y - b.y) < REACH;

/** Find the closest physical prop by distance from the player's feet to its base.
 * @param {import('./scene.js').Scene} scene @param {{x: number, y: number}} position
 * @param {(prop: import('./scene.js').Prop) => boolean} eligible
 * @returns {import('./scene.js').Prop | null} */
function closestProp(scene, position, eligible) {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  let best = null;
  let bestDistance = REACH;
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
 * @param {Actor | null} [actor] @param {Readonly<Record<string, ObjectRule>>} [rules]
 * @returns {import('./scene.js').Prop | null} */
export const nearbyObject = (scene, position, actor = null, rules = OBJECT_ACTIONS) =>
  closestProp(scene, position, (prop) => !!objectAction(prop.id, actor, rules));
