// Tiny DOM helpers shared by the /screen views.

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
 * CSS colour of a player colour index (1..4 → --p1..--p4 in base.css).
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
