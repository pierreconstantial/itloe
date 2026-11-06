// A driver for checking the game by hand from a script: a server on the given content (a free port, a
// scratch save folder), a TV page and phone pages in one headless Chrome (each phone its own browser
// context: a separate device), and per page: join, tap by selector or visible label, type, wait for text or
// a condition, read the visible text, take screenshots, and send a message through its own connection (send). close() stops everything and removes the scratch
// folder; so does a failure or Ctrl-C. Screenshots stay.
//   import { drive } from '<repo>/scripts/drive.mts';
//   const d = await drive({ content: 'minigame:quiz', phones: 2, shots: '/tmp/my-shots' });
//   const [a, b] = d.phones;
//   await a.join('pierre'); await b.join('sol');
//   await a.tap('▶ Start the quiz');                           // Pierre, the game master, opens its lobby
//   await a.tap("I'm ready"); await b.tap("I'm ready"); await a.tap('#btn-start');   // and starts a round
//   await d.tv.waitText(/QUESTION 1/); await d.tv.shot('tv-question');
//   await d.close();
// A phone can also walk its avatar with the joystick (steer); capture() returns a screen as a JPEG, and
// page() opens a page outside the game, e.g. to render a mockup at a TV's or a phone's size.
// Run the script with node in the foreground. Waits scale with E2E_SLOW, as in the suites.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdpConnect, freePort, killGroups, openPage, signalGroup, SOCKET_PROBE, startChrome, startServer } from './e2e-lib.mts';
export type { Page } from './e2e-lib.mts';

/**
 * Starts a server on `content` (ITLOE_CONTENT: 'sample', 'minigame:<kind>', …; default the story) and
 * Chrome, then opens the TV and `phones` phones (default 2) on the join page. `shots` is where shot()
 * saves (default a new folder in the temp dir, printed on the first shot). `env` is added to the server's
 * environment, e.g. BLOKO_PYRAMIDE_DIR for a word bank of one's own.
 */
export async function drive(opts: { content?: string, phones?: number, shots?: string, env?: Record<string, string> } = {}) {
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
  const server = await startServer(port, join(scratch, 'var'), opts.content ?? '', { detached: true, stdio: 'pipe', env: { ...process.env, ...opts.env } })
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
    const p = await openPage(cdp, `phone${i}`, true, shotDir, [SOCKET_PROBE]);
    await p.goto(joinUrl);
    /** Picks the character on the picker and waits until the phone is in. */
    const joinAs = async (character: string): Promise<void> => {
      await p.tap(`.pick-card[data-id="${character}"]`);
      await p.waitFor(`localStorage.getItem('bloko-id') && document.getElementById('view-pick')?.closest('[hidden]')`);
    };
    /** Sends a message through the phone's own socket (SOCKET_PROBE's window.__ws), as its screens would. */
    const sendAs = (msg: object): Promise<unknown> => p.ev(`window.__ws.send(${JSON.stringify(JSON.stringify(msg))})`);
    phones.push({ ...p, join: joinAs, send: sendAs });
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    cdp.close();
    await killGroups(groups);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  }
  /** A page outside the game, at a phone's or the TV's size (blank until goto). */
  const page = (kind: 'tv' | 'phone', label: string = kind) => openPage(cdp, label, kind === 'phone', shotDir);
  return { tv, phones, page, room: room as string, url: http, log: () => log, close };
}
