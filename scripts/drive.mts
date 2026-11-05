// A driver for checking the game by hand from a script: a server on the given content (a free port, a
// scratch save folder), a TV page and phone pages in one headless Chrome (each phone its own browser
// context: a separate device), and per page: join, tap by selector or visible label, type, wait for text or
// a condition, read the visible text, take screenshots. close() stops everything and removes the scratch
// folder; so does a failure or Ctrl-C. Screenshots stay.
//   import { drive } from '<repo>/scripts/drive.mts';
//   const d = await drive({ content: 'minigame:quiz', phones: 2, shots: '/tmp/my-shots' });
//   const [a, b] = d.phones;
//   await a.join('elodie'); await b.join('sol'); await a.tap('Start game');
//   await d.tv.waitText(/QUESTION 1/); await d.tv.shot('tv-question');
//   await d.close();
// Run the script with node in the foreground. Waits scale with E2E_SLOW, as in the suites.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdpConnect, freePort, killGroups, signalGroup, sleep, SLOW, startChrome, startServer } from './e2e-lib.mts';

/** In the page: the visible element a target names, scrolled into view, and its centre. A CSS selector,
 *  else visible text (or a field's placeholder or label): an exact match first, then a containing one, the
 *  smallest element that matches. */
const FIND = `(target) => {
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden'; };
  let hit = null;
  try { hit = [...document.querySelectorAll(target)].find(shown) ?? null; } catch { /* not a selector */ }
  if (!hit) {
    const norm = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const want = norm(target);
    const words = (e) => [e.innerText, e.placeholder, e.getAttribute('aria-label'), e.value].map(norm);
    const all = [...document.body.querySelectorAll('*')].filter(shown);
    const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    const pick = (ok) => all.filter((e) => words(e).some(ok)).sort((x, y) => area(x) - area(y))[0] ?? null;
    hit = pick((w) => w === want) ?? pick((w) => w.includes(want));
  }
  if (!hit) return null;
  hit.scrollIntoView({ block: 'center', inline: 'center' });
  const r = hit.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}`;

export type Page = Awaited<ReturnType<typeof openPage>>;

async function openPage(cdp: Awaited<ReturnType<typeof cdpConnect>>, label: string, phone: boolean, shots: () => string) {
  const { cmd, events } = cdp;
  const { browserContextId } = await cmd('Target.createBrowserContext');
  const { targetId } = await cmd('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId: s } = await cmd('Target.attachToTarget', { targetId, flatten: true });
  await cmd('Page.enable', {}, s);
  await cmd('Runtime.enable', {}, s);
  await cmd('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, s);
  if (phone) await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, s);
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true }, s); // pages in the background stay "focused"
  /** The page's uncaught exceptions, as they happened. */
  const errors: string[] = [];
  events.push((m) => {
    if (m.sessionId === s && m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  });

  /** Evaluates an expression in the page (promises awaited) and returns its value. */
  const ev = async (expr: string): Promise<any> => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, s);
    if (r.exceptionDetails) throw new Error(`${label}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  /** The visible text of the page. */
  const text = (): Promise<string> => ev('document.body?.innerText ?? ""');
  /** Waits until the expression is truthy and returns its value; throws with the page's text after `ms`. */
  const waitFor = async (expr: string, ms = 8000): Promise<any> => {
    const end = Date.now() + ms * SLOW;
    while (Date.now() < end) {
      const v = await ev(expr).catch(() => null);
      if (v) return v;
      await sleep(100);
    }
    throw new Error(`${label}: timed out waiting for ${expr}\n--- ${label}'s text ---\n${await text().catch(() => '')}`);
  };
  /** Waits until the visible text contains `want`. */
  const waitText = async (want: string | RegExp, ms = 8000): Promise<void> => {
    const end = Date.now() + ms * SLOW;
    let now = '';
    while (Date.now() < end) {
      now = await text().catch(() => '');
      if (typeof want === 'string' ? now.includes(want) : want.test(now)) return;
      await sleep(100);
    }
    throw new Error(`${label}: timed out waiting for the text ${want}\n--- ${label}'s text ---\n${now}`);
  };
  const find = async (target: string, ms: number): Promise<{ x: number, y: number }> => {
    const end = Date.now() + ms * SLOW;
    for (;;) {
      const at = await ev(`(${FIND})(${JSON.stringify(target)})`);
      if (at) return at;
      if (Date.now() > end) throw new Error(`${label}: nothing visible matches ${JSON.stringify(target)}\n--- ${label}'s text ---\n${await text().catch(() => '')}`);
      await sleep(100);
    }
  };
  /** A real tap on a phone, a real click on the TV, on what `target` names (see FIND); waits for it to show. */
  const tap = async (target: string, ms = 8000): Promise<void> => {
    await cmd('Page.bringToFront', {}, s); // headless: a background page never acks synthetic input
    const { x, y } = await find(target, ms);
    if (phone) {
      await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }, s);
      await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s);
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, s);
    }
    await sleep(150);
  };
  /** Taps the field `target` names, then types `words` into it. */
  const type = async (target: string, words: string): Promise<void> => {
    await tap(target);
    await cmd('Input.insertText', { text: words }, s);
  };
  /** Saves <shots>/<name>.png and the visible text as <name>.txt; returns the PNG's path. */
  const shot = async (name: string): Promise<string> => {
    const dir = shots();
    mkdirSync(dir, { recursive: true });
    await cmd('Page.bringToFront', {}, s);
    const { data } = await cmd('Page.captureScreenshot', { format: 'png' }, s);
    const file = join(dir, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    writeFileSync(join(dir, `${name}.txt`), await text());
    return file;
  };
  const goto = async (url: string): Promise<void> => { await cmd('Page.navigate', { url }, s); await waitFor('document.readyState === "complete"'); };
  /** The innermost screen showing (the frame's view, or a minigame's screen inside it), e.g. 'view-lobby'. */
  const view = (): Promise<string | null> => ev(`[...document.querySelectorAll('main section[id^="view-"]')].filter((e) => !e.closest('[hidden]')).pop()?.id ?? null`);
  return { label, errors, ev, text, waitFor, waitText, tap, type, shot, goto, view };
}

/**
 * Starts a server on `content` (ITLOE_CONTENT: 'sample', 'minigame:<kind>', …; default the story) and
 * Chrome, then opens the TV and `phones` phones (default 2) on the join page. `shots` is where shot()
 * saves (default a new folder in the temp dir, printed on the first shot).
 */
export async function drive(opts: { content?: string, phones?: number, shots?: string } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'itloe-drive-'));
  const groups: number[] = [];
  let closed = false;
  const kill = () => { for (const g of groups) signalGroup(g, 'SIGKILL'); rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); };
  // a script that throws: stop everything anyway (one that never calls close() keeps running on its connections)
  process.once('exit', () => { if (!closed) kill(); });
  const interrupt = () => { void close().then(() => process.exit(130)); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  let log = '';
  const port = await freePort();
  const server = await startServer(port, join(scratch, 'var'), opts.content ?? '', { detached: true, stdio: 'pipe' })
    .catch((e) => { kill(); throw e; });
  groups.push(server.pid!);
  server.stdout!.on('data', (d) => { log += d; });
  server.stderr!.on('data', (d) => { log += d; });
  const chrome = await startChrome(join(scratch, 'chrome'), true).catch((e) => { kill(); throw e; });
  groups.push(chrome.proc.pid!);
  const cdp = await cdpConnect(chrome.cdp);

  const http = `http://127.0.0.1:${port}`;
  const { code: room, url: joinUrl } = await (await fetch(`${http}/api/join`)).json();
  // the default folder is made on the first shot, so a run without screenshots leaves none behind
  let shots = opts.shots;
  const shotDir = () => {
    if (!shots) { shots = mkdtempSync(join(tmpdir(), 'itloe-drive-shots-')); console.log(`drive: screenshots in ${shots}`); }
    return shots;
  };
  const tv = await openPage(cdp, 'tv', false, shotDir);
  await tv.goto(`${http}/screen/`);
  const phones = [];
  for (let i = 1; i <= (opts.phones ?? 2); i++) {
    const p = await openPage(cdp, `phone${i}`, true, shotDir);
    await p.goto(joinUrl);
    /** Picks the character on the picker and waits until the phone is in. */
    const joinAs = async (character: string): Promise<void> => {
      await p.tap(`.pick-card[data-id="${character}"]`);
      await p.waitFor(`localStorage.getItem('bloko-id') && document.getElementById('view-pick')?.closest('[hidden]')`);
    };
    phones.push({ ...p, join: joinAs });
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    cdp.close();
    await killGroups(groups);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
  return { tv, phones, room: room as string, url: http, log: () => log, close };
}
