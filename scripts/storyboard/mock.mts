// Mockups for the storyboard: screens that are planned but not drawn by the game yet, as plain HTML in the
// game's colours (public/commun/base.css, loaded from the running server). `<canvas data-avatar="elodie">`
// draws a character with the game's own sprites; `wisp()` places a glowing light over a screen. A mockup
// says what a screen holds and where; it isn't the final look.

/** The colour slot of each character (shared/characters.js), for team colours and wisp tints. */
const SLOT: Record<string, number> = { pierre: 1, elodie: 2, sol: 3, anna: 4, nico: 5 };
const NAME: Record<string, string> = { pierre: 'Pierre', elodie: 'Élodie', sol: 'Sol', anna: 'Anna', nico: 'Nico' };

export const nameOf = (who: string) => NAME[who] ?? who;
export const colorOf = (who: string) => `var(--p${SLOT[who] ?? 1})`;

/** A character drawn with the game's sprites, `scale` CSS px per sprite pixel. */
export const avatar = (who: string, scale = 3) => `<canvas class="sprite" data-avatar="${who}" data-scale="${scale}"></canvas>`;

/** A wisp at x %, y % of the screen: a small light with a hint of its character's colour. */
export const wisp = (who: string, x: number, y: number, size = 48) =>
  `<span class="wisp" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;--tint:${colorOf(who)}"></span>`;

/** A coloured dot and a name, as the game lists players. */
export const player = (who: string, extra = '') => `<span class="who"><i style="background:${colorOf(who)}"></i>${nameOf(who)}${extra}</span>`;

/** The phone's frame: its top bar (character and ☰), then the body. */
export const phone = (who: string, body: string, opts: { wisp?: boolean } = {}) => `
<div class="phone">
  <header><span class="me">${opts.wisp ? '<span class="dotwisp" style="--tint:' + colorOf(who) + '"></span>' : avatar(who, 2)}${nameOf(who)}${opts.wisp ? ' <small>(wisp)</small>' : ''}</span><span class="menu">☰</span></header>
  <div class="body">${body}</div>
</div>`;

/** A phone of a wisp: the walking pad and Shine, plus what it watches. */
export const wispPhone = (who: string, watching: string) => phone(who, `
  <p class="hint">${watching}</p>
  <div class="pad">Touch and drag here to float around the TV</div>
  <button class="ghost">✨ Shine</button>`, { wisp: true });

/** The TV's frame: a title band, then the body; `over` goes on top (wisps). */
export const tv = (title: string, body: string, over = '') => `
<div class="tv">
  <div class="band"><h1>${title}</h1></div>
  <div class="stage">${body}</div>
  ${over}
</div>`;

/** A whole mockup document at the TV's or a phone's size, styled with the game's CSS from `origin`. */
export function mockDoc(origin: string, kind: 'tv' | 'phone', html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${origin}/commun/base.css">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body { font-family: system-ui, sans-serif; }
  .sprite { image-rendering: pixelated; vertical-align: middle; }
  .who { display: inline-flex; align-items: center; gap: 8px; }
  .who i { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
  .wisp { position: absolute; border-radius: 50%; transform: translate(-50%, -50%); pointer-events: none;
    background: radial-gradient(circle, #fff 0 18%, color-mix(in srgb, var(--tint) 55%, #fff) 30%, color-mix(in srgb, var(--tint) 35%, transparent) 55%, transparent 72%);
    box-shadow: 0 0 22px 6px color-mix(in srgb, var(--tint) 40%, transparent); }
  .dotwisp { display: inline-block; width: 18px; height: 18px; border-radius: 50%; margin-right: 6px; vertical-align: middle;
    background: radial-gradient(circle, #fff 0 20%, color-mix(in srgb, var(--tint) 60%, #fff) 35%, transparent 72%); }

  /* phone */
  .phone { height: 100%; display: flex; flex-direction: column; background: var(--bg); }
  .phone header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-2); font-weight: 600; }
  .phone header .me { display: flex; align-items: center; gap: 6px; }
  .phone header .menu { font-size: 22px; color: var(--fg-dim); }
  .phone .body { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 16px; overflow: hidden; }
  .phone h2 { margin: 0; font-size: 20px; }
  .phone .hint { color: var(--fg-dim); margin: 0; }
  .phone button { font: inherit; font-size: 17px; padding: 12px; border-radius: 10px; border: 1px solid var(--fg-dim); background: var(--bg-2); color: var(--fg); }
  .phone button.primary { background: var(--accent); color: #111; border-color: var(--accent); font-weight: 700; }
  .phone button.danger { border-color: var(--bad); color: var(--bad); }
  .phone button.ghost { background: none; }
  .phone button.on { border-color: var(--ok); color: var(--ok); }
  .phone .pad { flex: 1; min-height: 160px; border: 2px dashed #3a434d; border-radius: 16px; display: grid; place-items: center; color: var(--fg-dim); text-align: center; padding: 20px; }
  .phone .card { background: var(--bg-2); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .phone .row { display: flex; gap: 8px; align-items: center; }
  .phone .row > * { flex: 1; }
  .phone .seg { display: flex; gap: 6px; }
  .phone .seg span { flex: 1; text-align: center; padding: 8px 4px; border: 1px solid var(--fg-dim); border-radius: 8px; font-size: 14px; }
  .phone .seg span.on { border-color: var(--accent); color: var(--accent); }
  .phone .field { border: 1px solid var(--fg-dim); border-radius: 10px; padding: 12px; color: var(--fg-dim); background: #0c0e11; }
  .phone .word { font-size: 34px; font-weight: 800; letter-spacing: 2px; text-align: center; color: var(--accent); padding: 10px; border: 2px solid var(--accent); border-radius: 12px; }
  .phone .list { display: flex; flex-direction: column; gap: 6px; }
  .phone .list .who { justify-content: space-between; width: 100%; }
  .phone small { color: var(--fg-dim); font-weight: 400; }

  /* tv */
  .tv { position: relative; height: 100%; display: flex; flex-direction: column; background: var(--bg); }
  .tv .band { padding: 22px 48px; background: var(--bg-2); }
  .tv .band h1 { margin: 0; font-size: 46px; color: var(--accent); }
  .tv .stage { flex: 1; position: relative; padding: 36px 56px; display: flex; gap: 40px; font-size: 28px; }
  .tv .col { flex: 1; display: flex; flex-direction: column; gap: 16px; }
  .tv .panel { background: var(--bg-2); border-radius: 18px; padding: 22px 28px; display: flex; flex-direction: column; gap: 14px; }
  .tv .panel h2 { margin: 0; font-size: 32px; }
  .tv .dim { color: var(--fg-dim); }
  .tv .big { font-size: 40px; font-weight: 700; }
  .tv .players { display: flex; gap: 48px; flex-wrap: wrap; align-items: flex-end; justify-content: center; padding-top: 40px; }
  .tv .players figure { margin: 0; text-align: center; font-size: 24px; }
  .tv .players figure.out { opacity: .35; }
  .tv .players figcaption { margin-top: 6px; }
  .tv .tick { color: var(--ok); }
</style></head><body>${html}
<script type="module">
  import { avatarCanvas } from '${origin}/commun/avatar.js';
  for (const c of document.querySelectorAll('canvas[data-avatar]')) c.replaceWith(Object.assign(avatarCanvas(c.dataset.avatar, Number(c.dataset.scale)), { className: 'sprite' }));
  await document.fonts.ready;
  window.mockReady = true;
</script></body></html>`;
}
