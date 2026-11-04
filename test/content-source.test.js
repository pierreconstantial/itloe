// public/commun/content.js: fetch once, refetch on a new contentVersion, fallback to the sample.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentSource } from '../public/commun/content.js';
import { SAMPLE_CONTENT } from '../shared/campaign/index.js';

/** @param {Record<string, any>} served @returns {{ fetch: any, calls: () => number, set: (v: string) => void }} */
function server(served) {
  let n = 0;
  let cur = 'v1';
  const fetch = async () => {
    n++;
    const content = served[cur];
    return { ok: !!content, json: async () => ({ version: cur, content }), headers: { get: () => cur } };
  };
  return { fetch, calls: () => n, set: (v) => { cur = v; } };
}

test('falls back to SAMPLE_CONTENT without the route', async () => {
  const src = createContentSource({ fetch: /** @type {any} */ (async () => { throw new Error('404'); }) });
  await src.sync('x');
  assert.equal(src.get(), SAMPLE_CONTENT);
  assert.equal(src.version(), null);
});

test('fetches once per version; a new version refetches and notifies', async () => {
  const edited = { ...SAMPLE_CONTENT, start: SAMPLE_CONTENT.start };
  const s = server({ v1: SAMPLE_CONTENT, v2: edited });
  /** @type {any[]} */
  const changes = [];
  const src = createContentSource({ fetch: s.fetch, onChange: (c) => changes.push(c) });
  await Promise.all([src.sync('v1'), src.sync('v1'), src.sync('v1')]);
  assert.equal(s.calls(), 1);
  assert.equal(src.version(), 'v1');
  await src.sync('v1');
  assert.equal(s.calls(), 1);
  s.set('v2');
  await src.sync('v2');
  assert.equal(s.calls(), 2);
  assert.equal(src.get(), edited);
  assert.equal(changes.length, 2);
});

test('a server without contentVersion: fetched once', async () => {
  const s = server({ v1: SAMPLE_CONTENT });
  const src = createContentSource({ fetch: s.fetch });
  await src.sync(undefined);
  await src.sync(undefined);
  assert.equal(s.calls(), 1);
});
