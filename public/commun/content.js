// Campaign content for the clients (titles, doors, conditions), fetched once from the server and
// refreshed when a view's `contentVersion` changes (a server restarted with edited content).
// Without the route (the mock server) the bundled SAMPLE_CONTENT stands in, so clients still render.
//   const content = createContentSource();
//   on every view: content.sync(msg.contentVersion);   …   content.get() → Content
import { SAMPLE_CONTENT } from '../../shared/campaign/index.js';

/** @typedef {import('../../shared/campaign/types.js').Content} Content */

const ROUTE = '/api/content';

/**
 * @param {{
 *   fetch?: typeof globalThis.fetch,
 *   onChange?: (content: Content) => void,   // called after a (re)load that changed the content
 * }} [opts]
 */
export function createContentSource({ fetch = globalThis.fetch.bind(globalThis), onChange } = {}) {
  /** @type {Content} */
  let content = SAMPLE_CONTENT;
  /** @type {string | null} */
  let version = null;           // version of `content` (null = the bundled fallback)
  /** @type {string | null | undefined} */
  let wanted;                   // last version a view announced (undefined = never synced; null = none announced)
  /** @type {Promise<void> | null} */
  let inflight = null;

  async function load() {
    try {
      const res = await fetch(ROUTE, { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      const next = /** @type {Content} */ (body.content ?? body);
      if (!next || typeof next !== 'object' || !next.nodes) return;
      const v = typeof body.version === 'string' ? body.version : res.headers.get('etag');
      const changed = v !== version || v === null;
      content = next;
      version = v;
      if (changed) onChange?.(content);
    } catch {
      // no route (mock) or offline: keep what we have
    }
  }

  return {
    /** The content to render with (never null: falls back to the bundled sample). */
    get: () => content,
    /** Version of the content in hand (null = bundled fallback). */
    version: () => version,
    /**
     * Call with each view's `contentVersion`: fetches on first call and whenever it differs.
     * Concurrent calls share one request.
     * @param {string | null | undefined} v
     * @returns {Promise<void>}
     */
    sync(v) {
      const want = v ?? null;
      if (wanted !== undefined && want === wanted) return inflight ?? Promise.resolve();
      wanted = want;
      // one request at a time; a version that changed meanwhile triggers one more load
      const run = async () => {
        await load();
        if (wanted !== null && wanted !== version) await load();
      };
      inflight = (inflight ?? Promise.resolve()).then(run).finally(() => { inflight = null; });
      return inflight;
    },
  };
}
