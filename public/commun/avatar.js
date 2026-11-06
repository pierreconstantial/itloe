// Character sprites on the phone and the TV: crisp canvases drawn with shared/sprites.js (P4).
import { drawSprite, SPRITE_SIZE } from '../../shared/sprites.js';

/** @typedef {import('../../shared/characters.js').CharacterId} CharacterId */
/** @typedef {import('../../shared/world.js').Dir} Dir */

/**
 * A pixel-art canvas of a character.
 * @param {CharacterId} id @param {number} scale integer CSS px per sprite pixel
 * @param {Dir} [dir] @param {number} [frame] 0 = idle; a walk animates through WALK_FRAMES (shared/sprites.js)
 * @returns {HTMLCanvasElement}
 */
export function avatarCanvas(id, scale, dir = 'down', frame = 0) {
  const c = document.createElement('canvas');
  c.className = 'avatar';
  c.width = c.height = SPRITE_SIZE * scale;
  paintAvatar(c, id, dir, frame);
  return c;
}

/** Redraw an avatar canvas in place (e.g. a new facing). @param {HTMLCanvasElement} c @param {CharacterId} id @param {Dir} dir @param {number} [frame] */
export function paintAvatar(c, id, dir, frame = 0) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  drawSprite(ctx, id, dir, frame, 0, 0, c.width / SPRITE_SIZE);
}
