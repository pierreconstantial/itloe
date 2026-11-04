// P0 — static file serving shared by mock.ts and main.ts.
// Serves public/ at /, and shared/ at /shared/ (browser clients import the game logic).

import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

export function makeStaticHandler(rootDir: string) {
  const publicDir = join(rootDir, 'public');
  const sharedDir = join(rootDir, 'shared');

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/';
    const q = url.indexOf('?');
    let path = q < 0 ? url : url.slice(0, q);
    const query = q < 0 ? '' : url.slice(q); // redirects keep it: the QR's /play?room=CODE must reach the page
    if (path === '/') { res.writeHead(302, { location: '/screen/' + query }); res.end(); return; }
    if (path === '/screen' || path === '/play' || path === '/sim') {
      res.writeHead(302, { location: path + '/' + query }); res.end(); return;
    }
    if (path.endsWith('/')) path += 'index.html';

    const inShared = path.startsWith('/shared/');
    const base = inShared ? sharedDir : publicDir;
    const rel = inShared ? path.slice('/shared/'.length) : path.slice(1);
    const file = normalize(join(base, rel));
    if (!file.startsWith(base + sep)) { res.writeHead(403); res.end(); return; }

    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404');
    }
  };
}
