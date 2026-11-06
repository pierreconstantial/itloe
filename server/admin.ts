// The admin page's server side (public/admin/): recent events and the browsers' error reports, in memory
// only, and the routes that serve them with a snapshot of the server's state:
//   GET  /api/admin             → the snapshot, the events and the error reports (admins only)
//   GET  /api/admin/save        → the save file as it is on disk (admins only)
//   POST /api/client-error      → an uncaught error of a page (public/commun/report-errors.js), from anyone

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Something that happened: an action through the engine (`ok`: accepted or refused), an `err` sent to a
 *  client, a socket's hello or close, a server failure. `who`: a player id, `screen`, `unjoined` (a phone
 *  before its join), or null (the server itself). */
export type AdminEvent = { at: number, who: string | null, what: string, ok?: boolean };

/** A page's uncaught error. `playerId` is what the page says it is: shown, never trusted. */
export type ClientError = {
  at: number, page: string, playerId: string | null, message: string, source: string, stack: string, agent: string,
  ip: string,
};

const MAX_EVENTS = 300;
const MAX_ERRORS = 50;
const MAX_ERROR_BODY = 8 * 1024;

const clip = (x: unknown, length: number): string => String(x ?? '').slice(0, length);

/** The request body as text; null when it is longer than `max` bytes. */
async function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function makeAdmin(o: {
  isAdmin: (req: IncomingMessage) => boolean, clientIp: (req: IncomingMessage) => string, snapshot: () => object, saveFile: string,
}) {
  const events: AdminEvent[] = [];
  const errors: ClientError[] = [];
  /** Every report since the start, also those the list no longer holds. */
  let errorCount = 0;

  function keep<T>(list: T[], max: number, item: T): void {
    list.push(item);
    if (list.length > max) list.shift();
  }

  return {
    log(who: string | null, what: string, ok?: boolean): void {
      keep(events, MAX_EVENTS, { at: Date.now(), who, what, ...(ok === undefined ? {} : { ok }) });
    },

    /** Returns false when the request is not an admin route. */
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/api/client-error' && req.method === 'POST') {
        const body = await readBody(req, MAX_ERROR_BODY);
        let report: any = null;
        try { report = body === null ? null : JSON.parse(body); } catch { /* not JSON */ }
        if (!report || typeof report !== 'object') {
          res.writeHead(400);
          res.end();
          return true;
        }
        errorCount++;
        keep(errors, MAX_ERRORS, {
          at: Date.now(), page: clip(report.page, 200),
          playerId: typeof report.playerId === 'string' ? clip(report.playerId, 40) : null,
          message: clip(report.message, 500), source: clip(report.source, 300), stack: clip(report.stack, 3000),
          agent: clip(req.headers['user-agent'], 300), ip: o.clientIp(req),
        });
        res.writeHead(204);
        res.end();
        return true;
      }
      if (path !== '/api/admin' && path !== '/api/admin/save') return false;
      if (!o.isAdmin(req)) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('Admin only: open the page with ?admin=<admin token>.');
        return true;
      }
      if (path === '/api/admin') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ...o.snapshot(), events, clientErrors: errors, clientErrorCount: errorCount }));
        return true;
      }
      const save = await readFile(o.saveFile);
      res.writeHead(200, {
        'content-type': 'application/json', 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="itloe-save-${new Date().toISOString().replace(/[:.]/g, '-')}.json"`,
      });
      res.end(save);
      return true;
    },
  };
}
