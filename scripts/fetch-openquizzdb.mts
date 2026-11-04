// Downloads the OpenQuizzDB catalogue (CC BY-SA 4.0, https://www.openquizzdb.org) as raw JSON files,
// one per quiz, into data/sources/openquizzdb/, plus index.json (id, category, title, author, file).
// Raw source material only: the game's bank (data/quiz/) is built from it by a separate import step.
//
// Polite by design: one request at a time, a pause between quizzes, resumable (existing files are
// skipped), so an interrupted run just continues. Usage: node scripts/fetch-openquizzdb.mts [--limit N]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://www.openquizzdb.org';
const OUT = new URL('../data/sources/openquizzdb/', import.meta.url).pathname;
const PAUSE_MS = 1500;
const HEADERS = { 'user-agent': 'Elo-D-1-family-quiz/1.0 (private, non-commercial party game)' };

type Entry = { id: number, category: string, title: string, author: string | null, file: string | null, error?: string };

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const LIMIT = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const decode = (s: string): string => s
  .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .trim();

/** Category headers and downloadable rows, in page order. */
function parseListing(html: string): Omit<Entry, 'file'>[] {
  const out: Omit<Entry, 'file'>[] = [];
  let category = '';
  const re = /class="mytt_categ[^"]*"><a[^>]*>([^<]*)<\/a>|<td class="mytt_theme" title="([^"]*)" onclick="goq\((\d+)\)">([^<]*)<\/td>/g;
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) { category = decode(m[1]).replace(/^·\s*|\s*·$/g, ''); continue; }
    const author = /rédigé par (.+)$/.exec(decode(m[2]))?.[1] ?? null;
    out.push({ id: Number(m[3]), category, title: decode(m[4]), author });
  }
  return out;
}

async function text(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function fetchQuiz(id: number): Promise<string> {
  const page = await text(`${SITE}/download.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id: String(id) }),
  });
  const url = /https:\/\/download\.openquizzdb\.org\/[^"'\s<]+\.json/.exec(page)?.[0];
  if (!url) throw new Error(`no JSON link on the download page of quiz ${id}`);
  await sleep(PAUSE_MS / 3);
  const json = await text(url);
  JSON.parse(json); // refuse to store anything that is not JSON
  return json;
}

mkdirSync(OUT, { recursive: true });
const entries = parseListing(await text(`${SITE}/listing/`));
console.log(`[oqdb] ${entries.length} downloadable quizzes in the listing`);

const index: Entry[] = [];
let fetched = 0;
for (const e of entries) {
  const file = `${String(e.id).padStart(4, '0')}.json`;
  const path = join(OUT, file);
  if (existsSync(path)) { index.push({ ...e, file }); continue; }
  if (fetched >= LIMIT) { index.push({ ...e, file: null }); continue; }
  try {
    writeFileSync(path, await fetchQuiz(e.id));
    index.push({ ...e, file });
    fetched++;
    console.log(`[oqdb] ${fetched} · #${e.id} ${e.category} · ${e.title}`);
  } catch (err) {
    index.push({ ...e, file: null, error: String((err as Error).message ?? err) });
    console.error(`[oqdb] #${e.id} failed: ${(err as Error).message}`);
  }
  await sleep(PAUSE_MS);
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  source: 'OpenQuizzDB (https://www.openquizzdb.org)',
  licence: 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
  fetchedAt: new Date().toISOString(),
  quizzes: index,
}, null, 2));
const missing = index.filter((e) => !e.file).length;
console.log(`[oqdb] done: ${fetched} fetched now, ${index.length - missing} on disk, ${missing} missing`);
