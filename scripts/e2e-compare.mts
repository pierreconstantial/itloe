// Screenshot comparison for the e2e runner (`npm run e2e -- --shots <dir> --compare <ref>`): each screen
// (<name>.png and its visible text <name>.txt, as the suites' shot() saves them) against the same-named
// one in the reference. Pixels are compared in a headless Chrome page (canvas over CDP); a diff image
// (<name>.diff.png: the new screen faded, changed pixels red) lands next to the new screenshot.
// It shows what differs and judges nothing: two runs of the same code differ in random content too.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Screen = { name: string, changed: number, note: string, text: string[] };

/** Screen names in a folder: its screenshots, not the diff images. */
const screens = (dir: string): string[] => existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png')).map((f) => f.slice(0, -4))
  : [];

/** A line diff (longest common subsequence): the removed lines as '- …', the added ones as '+ …'. */
function lineDiff(a: string[], b: string[]): string[] {
  const n = a.length, m = b.length;
  const l = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) l[i][j] = a[i] === b[j] ? l[i + 1][j + 1] + 1 : Math.max(l[i + 1][j], l[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; }
    else if (j < m && (i === n || l[i][j + 1] >= l[i + 1][j])) out.push(`+ ${b[j++]}`);
    else out.push(`- ${a[i++]}`);
  }
  return out;
}

/** In the page: both PNGs decoded, the share of pixels that differ, and the diff image as base64. */
const PIXELS = `async (a, b) => {
  const load = (s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s; });
  const [x, y] = await Promise.all([load(a), load(b)]);
  if (x.width !== y.width || x.height !== y.height) return { size: x.width + 'x' + x.height + ' → ' + y.width + 'x' + y.height };
  const px = (img) => { const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); };
  const p = px(x).data, out = px(y), q = out.data;
  let d = 0;
  for (let k = 0; k < p.length; k += 4) {
    if (p[k] !== q[k] || p[k + 1] !== q[k + 1] || p[k + 2] !== q[k + 2] || p[k + 3] !== q[k + 3]) { d++; q[k] = 255; q[k + 1] = 0; q[k + 2] = 0; q[k + 3] = 255; continue; }
    const v = 255 - (255 - (q[k] + q[k + 1] + q[k + 2]) / 3) * 0.3;
    q[k] = q[k + 1] = q[k + 2] = v; q[k + 3] = 255;
  }
  if (!d) return { changed: 0 };
  const c = new OffscreenCanvas(y.width, y.height); c.getContext('2d').putImageData(out, 0, 0);
  const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let s = ''; for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return { changed: d / (p.length / 4), diff: btoa(s) };
}`;

/** One page in the Chrome on port `cdp`: evaluate(fn, ...args) runs PIXELS-like functions there. */
async function page(cdp: string) {
  const t = await (await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map<number, (m: any) => void>();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); wait.get(m.id)?.(m); wait.delete(m.id); };
  return async (fn: string, ...args: string[]): Promise<any> => {
    const i = ++id;
    const reply = new Promise<any>((r) => wait.set(i, r));
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true } }));
    const m = await reply;
    if (m.error || m.result.exceptionDetails) throw new Error(`compare: ${JSON.stringify(m.error ?? m.result.exceptionDetails)}`);
    return m.result.result.value;
  };
}

/** Compares each suite's screens (`dir/<suite>`) with the reference's (`ref/<suite>`) and prints the screens
 *  that differ, most changed first, each with its text diff. */
export async function compareShots(cdp: string, dir: string, ref: string, suites: string[]): Promise<void> {
  const evaluate = await page(cdp);
  const differ: Screen[] = [];
  let same = 0;
  for (const suite of suites) {
    const cur = join(dir, suite), old = join(ref, suite);
    if (!existsSync(old)) { differ.push({ name: suite, changed: 1, note: `no reference folder ${old}`, text: [] }); continue; }
    const now = screens(cur), before = screens(old);
    for (const s of before.filter((x) => !now.includes(x))) differ.push({ name: `${suite}/${s}`, changed: 1, note: 'missing (in the reference only)', text: [] });
    for (const s of now.filter((x) => !before.includes(x))) differ.push({ name: `${suite}/${s}`, changed: 1, note: 'new (not in the reference)', text: [] });
    for (const s of now.filter((x) => before.includes(x))) {
      const read = (d: string, ext: string) => existsSync(join(d, s + ext)) ? readFileSync(join(d, s + ext)) : Buffer.alloc(0);
      const text = lineDiff(String(read(old, '.txt')).split('\n'), String(read(cur, '.txt')).split('\n'));
      const px = await evaluate(PIXELS, read(old, '.png').toString('base64'), read(cur, '.png').toString('base64'));
      if (px.diff) writeFileSync(join(cur, `${s}.diff.png`), Buffer.from(px.diff, 'base64'));
      if (!px.size && !px.changed && !text.length) { same++; continue; }
      const note = px.size ? `size ${px.size}` : `${(100 * px.changed).toFixed(2)}% pixels`;
      differ.push({ name: `${suite}/${s}`, changed: px.size ? 1 : px.changed, note, text });
    }
  }
  differ.sort((a, b) => b.changed - a.changed || a.name.localeCompare(b.name));
  console.log(`\ncompare with ${ref}: ${differ.length} screen(s) differ, ${same} identical (diff images: <screen>.diff.png next to each new screenshot)`);
  for (const d of differ) {
    console.log(`  ${d.name}  ${d.note}${d.text.length ? `, text ±${d.text.length} line(s)` : ''}`);
    for (const l of d.text) console.log(`      ${l}`);
  }
}
