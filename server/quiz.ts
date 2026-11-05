// Quiz, server side (Contract E + E1): the question bank (data/quiz/*.json, validated at boot, NEVER
// served), the pluggable text judge, and the quiz's server code: its messages to actions (answers judged
// here, from the bank), its candidate questions, and its public view. The pure rules are in shared/quiz/.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidatesFor, judgeAnswer, projectQuiz, validateBank, type Question } from '../shared/quiz/bank.js';
import { MAX_TEXT, type Candidate, type QuizAction, type QuizState } from '../shared/quiz/index.js';
import type { ErrCode, MinigameServer } from './minigames.ts';

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

/** Typed answers the local matcher finds 'uncertain' go to the judge, bounded by this (E1: the null judge for now). */
const JUDGE_TIMEOUT_MS = 4000;

const isPlainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** The quiz's server code. Loads the bank at boot: a broken bank refuses to boot. */
export function makeQuizServer(): MinigameServer<QuizState, QuizAction, Candidate[]> {
  const bank = loadBank();
  const judge = withTimeout(nullJudge, JUDGE_TIMEOUT_MS);
  console.log(`[itloe] quiz bank: ${bank.questions.length} questions (${bank.files.join(', ') || 'no files'}), judge: none (uncertain typed answers → wrong, host overrides)`);

  return {
    message(m, { id, now, state: q, inputs }, io) {
      const host = id === q.hostId;
      const refusal: ErrCode = host ? 'refused' : 'not-host';
      switch (m.t) {
        case 'start':
        case 'again':
          return { action: { t: m.t, id, now, candidates: inputs() }, refused: refusal };

        case 'answer': {
          // judged HERE, from the bank: only the verdict enters the reducer
          const r = q.round;
          const question = r ? bank.byId.get(r.questionId) : undefined;
          if (q.phase !== 'question' || !r || !question) return { refused: 'not-playing' };
          const given = r.asChoice
            ? (Number.isInteger(m.choice) ? { choice: m.choice as number } : null)
            : (typeof m.text === 'string' && m.text.trim() ? { text: m.text.trim().slice(0, MAX_TEXT) } : null);
          if (!given) return { refused: 'refused' };
          const verdict = judgeAnswer(question, r, given);
          if (!io.apply({ t: 'answer', id, ...given, now, verdict })) return { refused: 'refused' };
          if (verdict === 'uncertain' && 'text' in given) {
            // an 'uncertain' typed answer goes to the pluggable judge; the reducer ignores a verdict for
            // another round, so a late one never lands on the next question's answer
            const { index, questionId } = r;
            void judge(question, given.text).then((ok) => io.apply({ t: 'verdict', target: id, ok, index, questionId }));
          }
          return null;
        }

        case 'next':
          return { action: { t: 'next', id, now }, refused: refusal };

        case 'override':
          // host, on the reveal: any answer, both ways
          if (typeof m.target !== 'string' || typeof m.ok !== 'boolean') return null;
          return { action: { t: 'override', id, target: m.target, ok: m.ok }, refused: refusal };

        case 'endGame':
        case 'newGame':
          return { action: { t: m.t, id }, refused: refusal };

        case 'config':
          if (!isPlainObject(m.patch)) return null;
          return {
            action: { t: 'config', id, patch: m.patch as Partial<QuizState['settings']> },
            refused: !host ? 'not-host' : q.phase === 'question' || q.phase === 'reveal' ? 'locked' : undefined,
          };

        default: // not a quiz thing (place, retire, …)
          return { refused: 'not-playing' };
      }
    },

    // candidates: the bank filtered by the quiz settings, minus every question asked this evening
    inputs: (s, facts) => candidatesFor(bank.questions, s.settings, facts.asked ?? []),

    // the public quiz: never an answer before the reveal (shared/quiz/bank.js projectQuiz)
    view: (s) => projectQuiz(s, (qid) => bank.byId.get(qid), bank.credits),
  };
}
