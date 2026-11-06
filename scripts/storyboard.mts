// The storyboard: how the evening plays, moment by moment, as slides with the TV and the phones side by
// side. Each sequence (scripts/storyboard/sequences.mts) plays the real game through scripts/drive.mts and
// captures the screens that exist ("today"); the screens that are only planned are mockups ("planned"),
// until the game draws them and a capture replaces the mockup.
//   node scripts/storyboard.mts [--out <dir>] [sequence id…]
// Writes <dir>/storyboard.html (self-contained: send it as one file) and <dir>/slides/<nn>.jpg, one per
// slide. Default <dir>: shots/storyboard (ignored by git). Run it in the foreground.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { drive } from './drive.mts';
import { SEQUENCES, type Board, type Sequence, type Shot } from './storyboard/sequences.mts';
import { mockDoc, nameOf } from './storyboard/mock.mts';

type Slide = { sequence: string, caption: string, shots: Shot[] };

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : join(import.meta.dirname, '..', 'shots', 'storyboard');
const unknown = args.filter((id) => !SEQUENCES.some((s) => s.id === id));
if (unknown.length) {
  console.error(`storyboard: unknown sequence ${unknown.join(', ')} (known: ${SEQUENCES.map((s) => s.id).join(', ')})`);
  process.exit(2);
}
const chosen = args.length ? SEQUENCES.filter((s) => args.includes(s.id)) : SEQUENCES;

/** Plays one sequence on its own server and browser, and returns its slides. */
async function play(seq: Sequence): Promise<Slide[]> {
  const d = await drive({ content: seq.content, phones: seq.phones.length, env: seq.env });
  const slides: Slide[] = [];
  try {
    const phones = new Map(seq.phones.map((who, i) => [who, d.phones[i]]));
    const mockTv = await d.page('tv', 'mock-tv');
    const mockPhone = await d.page('phone', 'mock-phone');
    // mockups are written into a page of the game's server, so they can import its sprite code
    await mockTv.goto(`${d.url}/storyboard-mock`);
    await mockPhone.goto(`${d.url}/storyboard-mock`);
    /** Renders a mockup at the TV's or a phone's size and captures it. */
    const render = async (page: typeof mockTv, kind: 'tv' | 'phone', html: string): Promise<string> => {
      await page.ev(`window.mockReady = false; document.open(); document.write(${JSON.stringify(mockDoc(d.url, kind, html))}); document.close();`);
      await page.waitFor('window.mockReady === true');
      return page.capture();
    };
    const board: Board = {
      d,
      phone: (who) => {
        const p = phones.get(who);
        if (!p) throw new Error(`${seq.id}: no phone for ${who}`);
        return p;
      },
      tv: async () => ({ who: 'TV', img: await d.tv.capture(), planned: false }),
      real: async (who) => ({ who: nameOf(who), img: await board.phone(who).capture(), planned: false }),
      mockTv: async (html) => ({ who: 'TV', img: await render(mockTv, 'tv', html), planned: true }),
      mockPhone: async (who, html) => ({ who: nameOf(who), img: await render(mockPhone, 'phone', html), planned: true }),
      frame: async (caption, shots) => { slides.push({ sequence: seq.id, caption, shots: await sequential(shots) }); },
    };
    await seq.run(board);
  } finally {
    await d.close();
  }
  return slides;
}

/** Shots are captured one after the other: a capture brings its page to the front. */
async function sequential(shots: (() => Promise<Shot>)[]): Promise<Shot[]> {
  const done: Shot[] = [];
  for (const s of shots) done.push(await s());
  return done;
}

/** The viewer: one slide at a time, ← → (or the buttons) to move, the sequences listed at the top. */
function viewer(slides: Slide[]): string {
  const data = JSON.stringify(slides.map((s) => ({ ...s, shots: s.shots.map((x) => ({ ...x, img: `data:image/jpeg;base64,${x.img}` })) })));
  const seqs = JSON.stringify(chosen.map(({ id, title, intro }) => ({ id, title, intro })));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Itloe storyboard</title>
<style>
  :root { --bg: #111418; --bg-2: #1b2026; --fg: #f2f2f2; --dim: #9aa4ad; --accent: #ffd166; --planned: #c77dff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.4 system-ui, sans-serif; }
  nav { display: flex; gap: 8px; padding: 10px 16px; background: var(--bg-2); align-items: center; flex-wrap: wrap; }
  nav button { background: none; border: 1px solid var(--dim); color: var(--fg); border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; }
  nav button.on { border-color: var(--accent); color: var(--accent); }
  nav .count { margin-left: auto; color: var(--dim); }
  main { padding: 16px 24px; }
  h1 { margin: 0 0 4px; font-size: 22px; color: var(--accent); }
  .intro { margin: 0 0 10px; color: var(--dim); max-width: 1100px; }
  .caption { margin: 0 0 14px; font-size: 19px; max-width: 1300px; }
  .screens { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  figure { margin: 0; }
  figure img { display: block; border-radius: 8px; border: 2px solid #2b323a; }
  figure.tv img { width: var(--tv, 900px); }
  figure.phone img { width: 250px; border-radius: 16px; }
  figure.planned img { border-color: var(--planned); }
  figcaption { margin-top: 4px; font-size: 14px; color: var(--dim); }
  figcaption b { color: var(--fg); font-weight: 600; }
  .badge { font-size: 12px; padding: 0 6px; border-radius: 4px; margin-left: 6px; border: 1px solid var(--dim); }
  .planned .badge { border-color: var(--planned); color: var(--planned); }
  .legend { color: var(--dim); font-size: 14px; margin-top: 14px; }
</style></head><body>
<nav id="nav"></nav>
<main id="main"></main>
<script>
const slides = ${data};
const seqs = ${seqs};
let at = Math.max(0, Math.min(slides.length - 1, Number(location.hash.slice(1)) - 1 || 0));
function show() {
  const s = slides[at];
  const seq = seqs.find((q) => q.id === s.sequence);
  const firstOf = (id) => slides.findIndex((x) => x.sequence === id);
  document.getElementById('nav').innerHTML = seqs.map((q) => '<button data-to="' + firstOf(q.id) + '"' + (q.id === s.sequence ? ' class="on"' : '') + '>' + q.title + '</button>').join('')
    + '<button data-to="' + (at - 1) + '">←</button><button data-to="' + (at + 1) + '">→</button><span class="count">' + (at + 1) + ' / ' + slides.length + '</span>';
  const inSeq = slides.filter((x) => x.sequence === s.sequence);
  const n = inSeq.indexOf(s) + 1;
  const phones = s.shots.filter((x) => x.who !== 'TV').length;
  document.documentElement.style.setProperty('--tv', Math.max(600, Math.min(1000, innerWidth - 60 - phones * 266)) + 'px');
  document.getElementById('main').innerHTML = '<h1>' + seq.title + ' · ' + n + '/' + inSeq.length + '</h1>'
    + (n === 1 ? '<p class="intro">' + seq.intro + '</p>' : '')
    + '<p class="caption">' + s.caption + '</p><div class="screens">'
    + s.shots.map((x) => '<figure class="' + (x.who === 'TV' ? 'tv' : 'phone') + (x.planned ? ' planned' : '') + '"><img src="' + x.img + '"><figcaption><b>' + x.who + '</b><span class="badge">' + (x.planned ? 'planned' : 'today') + '</span></figcaption></figure>').join('')
    + '</div><p class="legend">“today”: captured from the game as it is. “planned”: a mockup of a screen that doesn\\'t exist yet.</p>';
  location.hash = String(at + 1);
}
document.addEventListener('click', (e) => { const to = e.target.closest('[data-to]'); if (to) { const n = Number(to.dataset.to); if (n >= 0 && n < slides.length) { at = n; show(); } } });
document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' && at < slides.length - 1) { at++; show(); } if (e.key === 'ArrowLeft' && at > 0) { at--; show(); } });
show();
</script></body></html>`;
}

const slides: Slide[] = [];
for (const seq of chosen) {
  console.log(`storyboard: ${seq.id}…`);
  slides.push(...await play(seq));
}
mkdirSync(join(out, 'slides'), { recursive: true });
const html = viewer(slides);
const file = join(out, 'storyboard.html');
writeFileSync(file, html);

// one PNG per slide, from the viewer itself
const d = await drive({ phones: 0 });
try {
  const page = await d.page('tv', 'viewer');
  await page.goto(`file://${file}`);
  for (let i = 0; i < slides.length; i++) {
    await page.ev(`(() => { at = ${i}; show(); return true; })()`);
    const png = await page.capture(1, 90);
    writeFileSync(join(out, 'slides', `${String(i + 1).padStart(2, '0')}.jpg`), Buffer.from(png, 'base64'));
  }
} finally {
  await d.close();
}
console.log(`storyboard: ${slides.length} slides in ${file} (and ${join(out, 'slides')})`);
