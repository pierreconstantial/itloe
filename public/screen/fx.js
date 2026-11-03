// Transient visual effects. They live in #fx (fixed overlay, outside #app) so a re-render caused by
// another player's move never cuts them short. Positions come from the freshly rendered DOM.

const layer = /** @type {HTMLElement} */ (document.getElementById('fx'));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('fx-canvas'));
const app = /** @type {HTMLElement} */ (document.getElementById('app'));
const g2d = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

/** Design-px → CSS px (same scale as --u in screen-main.css). */
const u = () => Math.min(innerHeight / 1080, innerWidth / 1920);

/** @param {number} color player colour index */
export function colorHex(color) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--p${color}`).trim() || '#ffffff';
}

// ---- geometry ---------------------------------------------------------------------

/** @param {string} playerId */
function panelOf(playerId) {
  return [...document.querySelectorAll('.panel')].find((el) => /** @type {HTMLElement} */ (el).dataset.id === playerId);
}

/**
 * @param {string} playerId
 * @returns {{ board: DOMRect, cells: DOMRect[] } | null}
 */
function boardGeometry(playerId) {
  const board = panelOf(playerId)?.querySelector('.board');
  if (!board) return null;
  return {
    board: board.getBoundingClientRect(),
    cells: [...board.querySelectorAll(':scope > .cell')].map((c) => c.getBoundingClientRect()),
  };
}

/**
 * @param {string} className
 * @param {DOMRect | { left: number, top: number, width: number, height: number }} r
 * @param {number} lifeMs removed after this
 */
function place(className, r, lifeMs) {
  const el = document.createElement('div');
  el.className = className;
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  layer.append(el);
  setTimeout(() => el.remove(), lifeMs);
  return el;
}

/** @param {DOMRect[]} rects */
function union(rects) {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return {
    left, top,
    width: Math.max(...rects.map((r) => r.right)) - left,
    height: Math.max(...rects.map((r) => r.bottom)) - top,
  };
}

// ---- clear: ghost cells, sweep, particles ------------------------------------------

/**
 * @param {import("./events.js").Move} m
 * @param {number} size
 */
export function clearEffect(m, size) {
  const geo = boardGeometry(m.id);
  if (!geo || m.cleared.size === 0) return;
  const hex = colorHex(m.color);

  for (const [i, was] of m.cleared) {
    const r = geo.cells[i];
    if (!r) continue;
    const ghost = place('fx-ghost', r, 700);
    ghost.style.background = colorHex(was);
    ghost.style.animationDelay = `${sweepDelay(i, size, m) * 1000}ms`;
    burst(r.left + r.width / 2, r.top + r.height / 2, hex, 5);
  }

  for (const row of m.rows) {
    const bar = place('fx-sweep fx-sweep-row', union(geo.cells.slice(row * size, row * size + size)), 700);
    bar.style.setProperty('--sc', hex);
  }
  for (const col of m.cols) {
    const cells = geo.cells.filter((_, i) => i % size === col);
    const bar = place('fx-sweep fx-sweep-col', union(cells), 700);
    bar.style.setProperty('--sc', hex);
  }
}

/**
 * Ghost cells pop in a wave along the cleared line (when known), otherwise all at once.
 * @param {number} i
 * @param {number} size
 * @param {{ rows: number[], cols: number[] }} m
 */
function sweepDelay(i, size, m) {
  const x = i % size;
  const y = Math.floor(i / size);
  if (m.rows.includes(y)) return x * 0.025;
  if (m.cols.includes(x)) return y * 0.025;
  return 0;
}

// ---- call-outs, floaters, shake ---------------------------------------------------

/**
 * @param {string} playerId
 * @param {string[]} lines biggest first
 * @param {number} color
 */
export function callout(playerId, lines, color) {
  const geo = boardGeometry(playerId);
  if (!geo || lines.length === 0) return;
  const el = place('fx-callout', geo.board, 1700);
  el.style.setProperty('--cc', colorHex(color));
  el.style.setProperty('--bw', `${geo.board.width}px`);
  lines.forEach((text, i) => {
    const line = document.createElement('div');
    line.className = i === 0 ? 'fx-callout-main' : 'fx-callout-sub';
    line.textContent = text;
    el.append(line);
  });
}

/**
 * "+N" rising from the player's score.
 * @param {string} playerId
 * @param {number} gained
 */
export function scoreFloater(playerId, gained) {
  const score = panelOf(playerId)?.querySelector('.score');
  if (!score || gained <= 0) return;
  const r = score.getBoundingClientRect();
  const width = 400 * u();
  const el = place('fx-floater', { left: r.right - width, top: r.bottom, width, height: 0 }, 1200);
  el.textContent = `+${gained}`;
  if (gained >= 40) el.classList.add('fx-floater-big');
}

/** Full-screen "Time's up!" card, held for `ms` (the podium reveal starts after it). @param {number} ms */
export function timesUp(ms) {
  const el = place('fx-times-up', { left: 0, top: 0, width: innerWidth, height: innerHeight }, ms);
  el.style.setProperty('--hold', `${ms}ms`);
  el.append(Object.assign(document.createElement('div'), { className: 'fx-times-up-text', textContent: "⏰ Time's up!" }));
}

/** @param {number} lines lines cleared at once (shake only for ≥ 2) */
export function shake(lines) {
  if (lines < 2) return;
  app.classList.remove('fx-shake', 'fx-shake-big');
  void app.offsetWidth; // restart the animation
  app.classList.add(lines >= 3 ? 'fx-shake-big' : 'fx-shake');
}
app.addEventListener('animationend', (e) => {
  if (e.target === app) app.classList.remove('fx-shake', 'fx-shake-big');
});

// ---- particles (canvas) ----------------------------------------------------------

/** @typedef {{ x: number, y: number, vx: number, vy: number, g: number, life: number, max: number, size: number, color: string, spin: number, rot: number, rect: boolean }} Particle */

/** @type {Particle[]} */
const particles = [];
let raf = 0;
let lastT = 0;

function fitCanvas() {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', fitCanvas);
fitCanvas();

/**
 * @param {number} x
 * @param {number} y
 * @param {string} color
 * @param {number} count
 */
export function burst(x, y, color, count) {
  const k = u();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (150 + Math.random() * 350) * k;
    particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120 * k, g: 900 * k,
      life: 0, max: 0.5 + Math.random() * 0.4, size: (4 + Math.random() * 6) * k,
      color, spin: 0, rot: 0, rect: false,
    });
  }
  kick();
}

/** @param {string[]} colors */
export function confetti(colors) {
  const k = u();
  for (let i = 0; i < 220; i++) {
    particles.push({
      x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5,
      vx: (Math.random() - 0.5) * 200 * k, vy: (100 + Math.random() * 250) * k, g: 120 * k,
      life: 0, max: 3.5 + Math.random() * 2, size: (8 + Math.random() * 8) * k,
      color: colors[i % colors.length], spin: (Math.random() - 0.5) * 12, rot: Math.random() * 6, rect: true,
    });
  }
  kick();
}

function kick() {
  if (!raf) {
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

/** @param {number} now */
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  g2d.clearRect(0, 0, innerWidth, innerHeight);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.max || p.y > innerHeight + 40) { particles.splice(i, 1); continue; }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    g2d.globalAlpha = Math.max(0, 1 - (p.life / p.max) ** 2);
    g2d.fillStyle = p.color;
    if (p.rect) {
      g2d.save();
      g2d.translate(p.x, p.y);
      g2d.rotate(p.rot);
      g2d.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      g2d.restore();
    } else {
      g2d.beginPath();
      g2d.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      g2d.fill();
    }
  }
  g2d.globalAlpha = 1;
  raf = particles.length ? requestAnimationFrame(frame) : 0;
}

/** Drop every running effect (e.g. phase change back to lobby). */
export function clearAll() {
  particles.length = 0;
  layer.querySelectorAll(':scope > div').forEach((el) => el.remove());
}
