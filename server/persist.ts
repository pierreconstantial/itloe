// Q3 — on-disk persistence: small JSON files in var/ (BLOKO_VAR overrides the directory).
// Writes are atomic (tmp + rename): a crash mid-write leaves the previous file intact.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
export const VAR_DIR = process.env.BLOKO_VAR ?? join(ROOT, 'var');

export const varPath = (name: string): string => join(VAR_DIR, name);

export type ReadResult<T> =
  | { kind: 'missing' }
  | { kind: 'ok', data: T }
  | { kind: 'corrupt', error: string };

/** Reads a JSON file; `valid` guards the shape (a file from an older/foreign version counts as corrupt). */
export function readJson<T>(path: string, valid: (x: unknown) => x is T): ReadResult<T> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'corrupt', error: String(e?.message ?? e) };
  }
  try {
    const data: unknown = JSON.parse(text);
    return valid(data) ? { kind: 'ok', data } : { kind: 'corrupt', error: 'unexpected shape' };
  } catch (e: any) {
    return { kind: 'corrupt', error: String(e?.message ?? e) };
  }
}

export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

/** Moves a bad file aside (kept for inspection) so the next start does not trip on it again. */
export function quarantine(path: string): string {
  const dest = `${path}.corrupt-${Date.now()}`;
  try { renameSync(path, dest); } catch { /* already gone */ }
  return dest;
}
