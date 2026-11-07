// Tiny DOM helpers shared by the /screen views.

import { WORLD } from '../../shared/world.js';

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElement}
 */
export function h(tag, className = '', children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

/**
 * CSS colour of a player colour index (N → --pN in base.css).
 * @param {number} color
 */
export function playerColor(color) {
  return `var(--p${color})`;
}

/** @param {number} color */
export function colorDot(color) {
  const dot = h('span', 'dot');
  dot.style.background = playerColor(color);
  return dot;
}

/** @param {number} n */
export function formatScore(n) {
  return n.toLocaleString('en-US');
}

/** Loads a stylesheet once, after the page's own (a minigame's screens bring theirs). @param {URL} url */
export function addStylesheet(url) {
  if (typeof document === 'undefined' || document.querySelector(`link[href="${url.href}"]`)) return;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url.href }));
}

/**
 * A box over the whole TV page with the world's projection (16 × 9 world units, letterboxed and centred, as the
 * avatars over a minigame's screen are drawn): a minigame's screen places its spots in it with placeInWorld, so
 * the characters walking onto them line up with them.
 * @param {string} [className]
 * @returns {HTMLElement}
 */
export function worldBox(className = '') {
  const box = h('div', className);
  Object.assign(box.style, {
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
    width: `min(100vw, calc(100vh * ${WORLD.w} / ${WORLD.h}))`, aspectRatio: `${WORLD.w} / ${WORLD.h}`,
  });
  return box;
}

/**
 * Places an element of a worldBox over an area in world units (a spot). @param {HTMLElement} el
 * @param {{ x: number, y: number, w: number, h: number }} area
 */
export function placeInWorld(el, area) {
  Object.assign(el.style, {
    position: 'absolute',
    left: `${(area.x / WORLD.w) * 100}%`, top: `${(area.y / WORLD.h) * 100}%`,
    width: `${(area.w / WORLD.w) * 100}%`, height: `${(area.h / WORLD.h) * 100}%`,
  });
}
