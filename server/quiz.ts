// Quiz, server side (Contract E + E1): the question bank (data/quiz/*.json, validated at boot, NEVER
// served) and the pluggable text judge. The pure rules are in shared/quiz/.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBank, type Question } from '../shared/quiz/bank.js';

export type { Question };

const ROOT = new URL('..', import.meta.url).pathname;
/** Where the bank lives (BLOKO_QUIZ_DIR overrides it, e.g. for tests). Outside public/ and shared/: never served. */
export const QUIZ_DIR = process.env.BLOKO_QUIZ_DIR ?? join(ROOT, 'data', 'quiz');

/** `credits`: one attribution line per dataset (CC BY-SA and friends must stay visible in the game). */
export type Bank = { questions: Question[], byId: Map<string, Question>, files: string[], credits: string[] };

/** A file's attribution line: its `dataset.attribution`, else "name — licence". */
function creditOf(dataset: any): string | null {
  if (!dataset || typeof dataset !== 'object') return null;
  if (typeof dataset.attribution === 'string' && dataset.attribution.trim()) return dataset.attribution.trim();
  const parts = [dataset.name, dataset.licence].filter((x) => typeof x === 'string' && x.trim());
  return parts.length ? parts.join(' — ') : null;
}

/**
 * Every data/quiz/*.json: `{ dataset, questions: [...] }` or a bare array of questions. Validated as a
 * whole (unique ids across files); a broken bank refuses to boot, listing every problem.
 */
export function loadBank(dir = QUIZ_DIR): Bank {
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no bank: no quiz questions */ }
  const questions: Question[] = [];
  const problems: string[] = [];
  const credits: string[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const list = Array.isArray(data) ? data : data?.questions;
      if (!Array.isArray(list)) { problems.push(`${f}: expected { questions: [...] } or an array`); continue; }
      questions.push(...list);
      const credit = Array.isArray(data) ? null : creditOf(data?.dataset);
      if (credit && !credits.includes(credit)) credits.push(credit);
    } catch (e: any) {
      problems.push(`${f}: ${e?.message ?? e}`);
    }
  }
  problems.push(...validateBank(questions));
  if (problems.length) throw new Error(`quiz bank is broken (${problems.length} problem(s)) in ${dir}:\n  - ${problems.join('\n  - ')}`);
  return { questions, byId: new Map(questions.map((q) => [q.id, q])), files, credits };
}

/**
 * A judge for typed answers the local matcher found 'uncertain': true / false, or null when it cannot
 * tell. Pluggable (E1): only the null judge exists for now (a Claude-backed judge is on hold).
 */
export type Judge = (q: Question, text: string) => Promise<boolean | null>;

export const nullJudge: Judge = async () => null;

/** Bounds a judge: a timeout or a failure is "cannot tell" (→ wrong; the host can override). */
export function withTimeout(judge: Judge, ms: number): Judge {
  return (q, text) => new Promise<boolean | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    judge(q, text).then(
      (v) => { clearTimeout(timer); resolve(v === true || v === false ? v : null); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}
