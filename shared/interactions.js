/** Actions tied to the room's visible furniture. */
export const OBJECT_ACTIONS = Object.freeze({
  sofa: { label: '🛋 Sit', feedback: 'Comfy!' },
  table: { label: '🎂 Blow candles', feedback: 'Make a wish!' },
  plant: { label: '🪴 Shake plant', feedback: 'Rustle!' },
});

/** Find the closest reachable-looking prop by distance from the avatar's feet to its base.
 * @param {import('./scene.js').Scene} scene @param {{x: number, y: number}} position
 * @returns {import('./scene.js').Prop | null}
 */
export function nearbyObject(scene, position) {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  let best = null;
  let bestDistance = 0.8;
  for (const prop of scene.props) {
    if (!Object.hasOwn(OBJECT_ACTIONS, prop.id)) continue;
    const base = prop.solid ?? prop.box;
    const dx = Math.max(base.x - position.x, 0, position.x - base.x - base.w);
    const dy = Math.max(base.y - position.y, 0, position.y - base.y - base.h);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) { best = prop; bestDistance = distance; }
  }
  return best;
}
