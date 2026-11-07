// Virtual joystick for the phone lobby. The stick appears where the thumb lands on the pad;
// while held, the avatar position is integrated every frame and sent as throttled `pos`
// (≤ 15/s, only on change), plus one final moving:false on release.
import { stickVector, step, roundPos, samePos, snapTo } from './movement.js';

/** @typedef {import('./movement.js').Pos} Pos */
/** @typedef {import('../../shared/scene.js').Scene} Scene */

const SEND_INTERVAL_MS = 1000 / 15;
const MAX_DT = 0.05; // s; a stalled frame never teleports the avatar
const RADIUS_PX = 56; // knob travel = full speed

/**
 * @param {{
 *   pad: HTMLElement, base: HTMLElement, knob: HTMLElement,
 *   start: () => Pos | null,       // where the avatar is now; null = walking not allowed
 *   scene: () => Scene,            // the room being walked: what the feet collide with
 *   send: (pos: Pos) => void,      // wire send (already rounded)
 *   snap?: () => readonly { x: number, y: number }[],   // centres to snap onto (a walkable lobby's free spots)
 *   onGrab?: () => void,
 * }} o
 */
export function createJoystick(o) {
  /** @type {number | null} */ let pointerId = null;
  let originX = 0, originY = 0, vx = 0, vy = 0;
  /** The room we are walking, captured with the start position so one hold stays self-consistent. */
  /** @type {Scene | null} */ let scene = null;
  /** Where the avatar stands (sent), and where the stick alone has taken it (they differ while it's snapped). */
  /** @type {Pos | null} */ let pos = null;
  /** @type {Pos | null} */ let free = null;
  /** The spot centre the avatar is held at, or null. @type {{ x: number, y: number } | null} */ let snapped = null;
  /** @type {Pos | null} */ let lastSent = null;
  let lastSentAt = -Infinity, lastFrame = 0, raf = 0;

  /** @param {boolean} force */
  function flush(force) {
    if (!pos) return;
    const wire = roundPos(pos);
    if (samePos(wire, lastSent)) return;
    const now = performance.now();
    if (!force && now - lastSentAt < SEND_INTERVAL_MS) return; // the next frame retries
    o.send(wire);
    lastSent = wire;
    lastSentAt = now;
  }

  /** @param {number} t */
  function tick(t) {
    if (pointerId === null || !free || !scene) return;
    const dt = Math.min(MAX_DT, (t - lastFrame) / 1000);
    lastFrame = t;
    free = step(free, vx, vy, dt, scene);
    snap();
    flush(false);
    raf = requestAnimationFrame(tick);
  }

  /** @param {number} dx @param {number} dy */
  function moveKnob(dx, dy) {
    const len = Math.hypot(dx, dy);
    const k = len > RADIUS_PX ? RADIUS_PX / len : 1;
    o.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  o.pad.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    const from = o.start();
    if (!from) return;
    e.preventDefault();
    pointerId = e.pointerId;
    try { o.pad.setPointerCapture(e.pointerId); } catch { /* pointer no longer active: moves still reach the pad */ }
    const r = o.pad.getBoundingClientRect();
    originX = e.clientX;
    originY = e.clientY;
    o.base.style.left = `${e.clientX - r.left}px`;
    o.base.style.top = `${e.clientY - r.top}px`;
    o.base.hidden = false;
    o.pad.classList.add('active');
    moveKnob(0, 0);
    vx = vy = 0;
    free = from;
    snapped = null;
    snap();
    scene = o.scene();
    lastSent = null; // the first frame always announces where we are
    lastFrame = performance.now();
    o.onGrab?.();
    raf = requestAnimationFrame(tick);
  });

  o.pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - originX, dy = e.clientY - originY;
    moveKnob(dx, dy);
    ({ vx, vy } = stickVector(dx, dy, RADIUS_PX));
  });

  /** @param {PointerEvent} e */
  const release = (e) => { if (e.pointerId === pointerId) cancel(); };
  o.pad.addEventListener('pointerup', release);
  o.pad.addEventListener('pointercancel', release);
  // the frame moved the pad to another screen under the finger: its pointerup may never reach the pad
  o.pad.addEventListener('lostpointercapture', release);

  /** Where the avatar stands: `free`, or the spot centre it snaps onto. */
  function snap() {
    if (!free) return;
    snapped = o.snap ? snapTo(free, snapped, o.snap()) : null;
    pos = snapped ? { ...free, x: snapped.x, y: snapped.y } : free;
  }

  /** Let go: stop the loop and send the final moving:false (bypassing the throttle). */
  function cancel() {
    if (pointerId === null) return;
    cancelAnimationFrame(raf);
    pointerId = null;
    vx = vy = 0;
    o.base.hidden = true;
    o.pad.classList.remove('active');
    if (pos) pos = { ...pos, moving: false };
    flush(true);
  }

  return {
    cancel,
    /** The server moved the avatar (a walkable lobby's start position): a held stick walks on from there. @param {Pos} at */
    moveTo(at) {
      if (pointerId === null) return;
      free = { ...at, moving: free?.moving ?? false };
      snapped = null;
      snap();
      lastSent = pos && roundPos(pos);
    },
    /** Current position while held (null when idle). */
    current: () => pointerId === null ? null : pos,
  };
}
