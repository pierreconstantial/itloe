import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const COOKIE = '__Host-itloe_access';
// Outlives browser sessions: a phone whose browser was closed in the background must still reconnect.
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const TOKEN_SHAPE = /^[A-Za-z0-9]{6}$/;

function equal(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The value of one cookie of a request, or null. */
function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

/** LAN play stays open; public hosting requires both settings before any saves are loaded.
 *  The admin token guards the admin data and the reset: with it set, only browsers that opened a page with
 *  `?admin=<token>` get them; without it, a LAN server leaves them open and a public one closes them. */
export function makeAccess(publicOrigin?: string, token?: string, adminToken?: string) {
  let origin: string | null = null;
  if (adminToken && (!TOKEN_SHAPE.test(adminToken) || adminToken === token)) {
    throw new Error('BLOKO_ADMIN_TOKEN must be 6 letters or digits, different from BLOKO_ACCESS_TOKEN');
  }
  if (publicOrigin || token) {
    // Guests may type the token from the TV.
    if (!publicOrigin || !token || !TOKEN_SHAPE.test(token)) {
      throw new Error('Public hosting requires BLOKO_PUBLIC_ORIGIN and BLOKO_ACCESS_TOKEN (6 letters or digits)');
    }
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('BLOKO_PUBLIC_ORIGIN must be an HTTPS origin without a path, credentials, query or fragment');
    }
    origin = url.origin;
  }
  // Derive the cookie so the invitation token is never stored directly in browser cookies.
  const cookie = token ? createHmac('sha256', token).update('itloe-access-v1').digest('hex') : '';
  const hasCookie = (req: IncomingMessage): boolean => equal(cookieOf(req, COOKIE) ?? '', cookie);
  // The admin cookie, the same way; `__Host-` needs HTTPS, so a LAN server uses a plain name.
  const admin = adminToken || null;
  const adminCookie = admin ? createHmac('sha256', admin).update('itloe-admin-v1').digest('hex') : '';
  const adminCookieName = origin ? '__Host-itloe_admin' : 'itloe_admin';

  /** The invitation gate: true when the request may go on. */
  function invited(req: IncomingMessage, res: ServerResponse): boolean {
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
          'set-cookie': `${COOKIE}=${cookie}; Path=/; Max-Age=${COOKIE_MAX_AGE}; Secure; HttpOnly; SameSite=Lax`,
          location: origin + url.pathname + url.search,
        });
        res.end();
        return false;
      }
    } else if (hasCookie(req)) return true;
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Open the invitation link to access this game.');
    return false;
  }

  /** `?admin=<token>` on any page: the right token sets the admin cookie and reloads the page without it. */
  function adminLogin(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!admin || !url.searchParams.has('admin')) return true;
    if (url.searchParams.getAll('admin').length !== 1 || !equal(url.searchParams.get('admin')!, admin)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Wrong admin token.');
      return false;
    }
    url.searchParams.delete('admin');
    res.writeHead(302, {
      'set-cookie': `${adminCookieName}=${adminCookie}; Path=/; Max-Age=${COOKIE_MAX_AGE};${origin ? ' Secure;' : ''} HttpOnly; SameSite=Lax`,
      location: (origin ?? '') + url.pathname + url.search,
    });
    res.end();
    return false;
  }

  return {
    origin,
    joinUrl(room: string, fallbackOrigin: string): string {
      const url = new URL('/play', origin ?? fallbackOrigin);
      url.searchParams.set('room', room);
      if (origin) url.searchParams.set('token', token!);
      return url.href;
    },
    http(req: IncomingMessage, res: ServerResponse): boolean {
      return invited(req, res) && adminLogin(req, res);
    },
    /** May this request see the admin data or reset the evening? */
    isAdmin(req: IncomingMessage): boolean {
      return admin ? equal(cookieOf(req, adminCookieName) ?? '', adminCookie) : !origin;
    },
    upgrade(req: IncomingMessage): boolean {
      return !origin || (req.headers.origin === origin && hasCookie(req));
    },
  };
}
