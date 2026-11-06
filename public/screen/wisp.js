// A tiny floating player light. Coordinates are the player's feet in screen pixels.
/** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y
 * @param {number} unit pixels per world unit @param {number} now animation timestamp
 * @param {boolean} active an emote or object interaction is in progress
 * @param {string} tint the player's colour @param {boolean} moving */
export function drawWisp(g, x, y, unit, now, active, tint, moving = false) {
  const bob = Math.sin(now / 420 + x / 45) * unit * 0.035;
  const cy = y - unit * 0.34 + bob;
  const pulse = moving ? 1.12 + 0.22 * Math.sin(now / 160) : 1;
  const radius = unit * (active ? 0.39 : 0.22) * pulse;
  g.save();
  g.globalCompositeOperation = 'screen';
  const glow = g.createRadialGradient(x, cy, 0, x, cy, radius);
  glow.addColorStop(0, active ? '#ffffff' : '#fffbe3');
  glow.addColorStop(0.16, active ? '#fff7c3' : moving ? '#ffffff' : tint);
  glow.addColorStop(0.48, active ? '#ffe4a080' : `${tint}66`);
  glow.addColorStop(1, `${tint}00`);
  g.fillStyle = glow;
  g.beginPath();
  g.arc(x, cy, radius, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = active || moving ? '#fffdf1' : tint;
  g.beginPath();
  g.arc(x, cy, Math.max(1.5, unit * (active ? 0.055 : 0.038) * pulse), 0, Math.PI * 2);
  g.fill();
  g.restore();
}
