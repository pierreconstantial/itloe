import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const COOKIE = '__Host-itloe_access';

function equal(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** LAN play stays open; public hosting requires both settings before any saves are loaded. */
export function makeAccess(publicOrigin?: string, token?: string) {
  let origin: string | null = null;
  if (publicOrigin || token) {
    if (!publicOrigin || !token || token.length < 32) {
      throw new Error('Public hosting requires BLOKO_PUBLIC_ORIGIN and BLOKO_ACCESS_TOKEN (at least 32 characters)');
    }
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('BLOKO_PUBLIC_ORIGIN must be an HTTPS origin without a path, credentials, query or fragment');
    }
    origin = url.origin;
  }
  // Derive the cookie so the invitation token is never stored directly in browser cookies.
  const cookie = token ? createHmac('sha256', token).update('itloe-access-v1').digest('hex') : '';
  const hasCookie = (req: IncomingMessage): boolean => (req.headers.cookie ?? '').split(';').some((part) => {
    const [name, ...value] = part.trim().split('=');
    return name === COOKIE && equal(value.join('='), cookie);
  });

  return {
    origin,
    joinUrl(room: string, fallbackOrigin: string): string {
      const url = new URL('/play', origin ?? fallbackOrigin);
      url.searchParams.set('room', room);
      if (origin) url.searchParams.set('token', token!);
      return url.href;
    },
    http(req: IncomingMessage, res: ServerResponse): boolean {
      if (!origin) return true;
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('cache-control', 'no-store');
      let url: URL;
      try { url = new URL(req.url ?? '/', origin); }
      catch {
        res.writeHead(400);
        res.end();
        return false;
      }
      if (url.searchParams.has('token')) {
        if (url.searchParams.getAll('token').length === 1 && equal(url.searchParams.get('token')!, token!)) {
          url.searchParams.delete('token');
          res.writeHead(302, {
            'set-cookie': `${COOKIE}=${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax`,
            location: origin + url.pathname + url.search,
          });
          res.end();
          return false;
        }
      } else if (hasCookie(req)) return true;
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Open the invitation link to access this game.');
      return false;
    },
    upgrade(req: IncomingMessage): boolean {
      return !origin || (req.headers.origin === origin && hasCookie(req));
    },
  };
}
