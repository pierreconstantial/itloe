// Builds the game's quiz bank data/quiz/openquizzdb.json from the raw OpenQuizzDB download
// (data/sources/openquizzdb/, see fetch-openquizzdb.mts). Keeps the general-culture categories only
// (CATEGORIES below is the one place to change that), maps each question to the bank format
// (shared/quiz/bank.js validateBank), and keeps the CC BY-SA attribution on every question.
// Usage: node scripts/import-openquizzdb.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBank } from '../shared/quiz/bank.js';

const SRC = new URL('../data/sources/openquizzdb/', import.meta.url).pathname;
const OUT = new URL('../data/quiz/openquizzdb.json', import.meta.url).pathname;

/** OpenQuizzDB listing category → the game's category label. Categories not listed are left out. */
const CATEGORIES: Record<string, string> = {
  'CULTURE GÉNÉRALE': 'culture générale',
  ALPHAQUIZZ: 'culture générale',
  'GÉOGRAPHIE': 'géographie',
  'PAYS DU MONDE': 'géographie',
  TOURISME: 'géographie',
  HISTOIRE: 'histoire',
  'ARCHÉOLOGIE': 'histoire',
  'LITTÉRATURE': 'littérature',
  ARTS: 'art',
  SCIENCES: 'sciences',
  NATURE: 'sciences',
};

/** A typed answer must stay short enough to type on a phone (else the question is asked as a choice only). */
const TYPED_MAX_WORDS = 3;
const TYPED_MAX_CHARS = 25;
/** No difficulty field in the v4 files: every question is "intermediate" until tagged by hand. */
const DEFAULT_LEVEL = 2;
/** Shorter source anecdotes are truncated fields, not sentences (test/quiz-real-bank.test.js checks it). */
const MIN_ANECDOTE_CHARS = 12;

type IndexEntry = { id: number, category: string, title: string, author: string | null, file: string | null };
type RawQuestion = { id: number, question: string, propositions: string[], réponse: string, anecdote?: string };
type RawQuiz = { rédacteur?: string, thème?: string, quizz: RawQuestion[] | Record<string, RawQuestion[]> };

const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const same = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0;

const index: { quizzes: IndexEntry[] } = JSON.parse(readFileSync(join(SRC, 'index.json'), 'utf8'));
const questions: object[] = [];
const skipped: Record<string, number> = {};
const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
const perCategory: Record<string, number> = {};

for (const entry of index.quizzes) {
  const category = CATEGORIES[entry.category];
  if (!category || !entry.file) continue;
  const raw: RawQuiz = JSON.parse(readFileSync(join(SRC, entry.file), 'utf8'));
  // v4 files hold a flat list; older ones grouped questions by level
  const list = Array.isArray(raw.quizz) ? raw.quizz : Object.values(raw.quizz).flat();
  const author = clean(raw.rédacteur ?? entry.author ?? '');
  list.forEach((r, n) => {
    const choices = (r.propositions ?? []).map(clean);
    const answerText = clean(r.réponse);
    const q = clean(r.question);
    if (!q || choices.length !== 4 || choices.some((c) => !c)) return skip('not 4 choices');
    if (new Set(choices.map((c) => c.toLowerCase())).size !== 4) return skip('duplicate choices');
    const answer = choices.findIndex((c) => same(c, answerText));
    if (answer < 0) return skip('answer not among the choices');
    const typed = answerText.split(' ').length <= TYPED_MAX_WORDS && answerText.length <= TYPED_MAX_CHARS;
    // a few source anecdotes are truncated upstream (e.g. "P"): only real sentences are kept
    const anecdote = clean(r.anecdote).length >= MIN_ANECDOTE_CHARS ? clean(r.anecdote) : '';
    questions.push({
      id: `oqdb-${entry.id}-${n + 1}`,
      q, choices, answer,
      ...(typed ? {} : { typed: false }),
      ...(anecdote ? { anecdote } : {}),
      category, level: DEFAULT_LEVEL,
      source: `OpenQuizzDB — ${entry.title}${author ? ` (${author})` : ''}, CC BY-SA 4.0, openquizzdb.org`,
    });
    perCategory[category] = (perCategory[category] ?? 0) + 1;
  });
}

const problems = validateBank(questions as any);
if (problems.length) {
  console.error(`[import] the bank would be invalid:\n  ${problems.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
writeFileSync(OUT, JSON.stringify({
  dataset: {
    name: 'OpenQuizzDB — general-culture selection',
    licence: 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
    attribution: 'Questions: OpenQuizzDB (https://www.openquizzdb.org), adapted (selection, format). Each question names its quiz and author in "source".',
    importedAt: new Date().toISOString(),
  },
  questions,
}, null, 1));
console.log(`[import] ${questions.length} questions → data/quiz/openquizzdb.json`, perCategory, 'skipped:', skipped);
