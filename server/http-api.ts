// Q2 — onboarding endpoints for the clients (contract for /play and /screen):
//   GET /api/join         → {"url":"http://<lan-ip>:<port>/play","code":"ABCD"}
//   GET /api/join-qr.svg  → SVG QR code of that url
//   GET /api/content      → { version, start, chooser, nodes }: the active campaign content (ETag = version)

import type { IncomingMessage, ServerResponse } from 'node:http';
import QRCode from 'qrcode';

export type JoinInfo = (req?: IncomingMessage) => { url: string, code: string };

/** `content`: the active campaign content and its version hash, serialized once (fixed while running). */
export function makeApiHandler(joinInfo: JoinInfo, content: { version: string, data: object }) {
  const contentJson = JSON.stringify({ version: content.version, ...content.data });
  const etag = `"${content.version}"`;
  let qrCache: { url: string, svg: string } | null = null;
  const qrSvg = async (url: string): Promise<string> => {
    if (qrCache?.url !== url) qrCache = { url, svg: await QRCode.toString(url, { type: 'svg', margin: 1 }) };
    return qrCache.svg;
  };

  /** Returns false when the request is not an API route. */
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/api/join') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(joinInfo(req)));
      return true;
    }
    if (path === '/api/content') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', etag });
      res.end(contentJson);
      return true;
    }
    if (path === '/api/join-qr.svg') {
      const svg = await qrSvg(joinInfo(req).url);
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      res.end(svg);
      return true;
    }
    return false;
  };
}
