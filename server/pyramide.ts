// Pyramide, server side: the word bank (data/pyramide/*.json, checked at boot, NEVER served), judging
// guesses, and the round's server code: its messages to actions, its words at each Start, and its view.
// The pure rules are in shared/pyramide.js.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from '../shared/normalize.js';
import { LEVELS, MAX_CLUE, MAX_GUESS, ONE_WORD, type Level, type PyramideAction, type PyramideState, type Word } from '../shared/pyramide.js';
import type { RoundServer } from './minigames.ts';

const ROOT = new URL('..', import.meta.url).pathname;
/** Where the bank lives (BLOKO_PYRAMIDE_DIR overrides it, e.g. for tests). Outside public/ and shared/: never served. */
export const PYRAMIDE_DIR = process.env.BLOKO_PYRAMIDE_DIR ?? join(ROOT, 'data', 'pyramide');

/** The bank: its words by level, as Pierre's list holds them. */
export type WordBank = Record<Level, Word[]>;

/**
 * Every data/pyramide/*.json, in Pierre's format: `{ language, categories: { easy: [{ id, word }], medium, hard } }`.
 * Checked as a whole: every level present, ids unique, each word one word and not twice (once normalized).
 * A broken bank refuses to boot, listing every problem.
 */
export function loadWords(dir = PYRAMIDE_DIR): WordBank {
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* no bank: reported below */ }
  const bank: WordBank = { easy: [], medium: [], hard: [] };
  const problems: string[] = files.length ? [] : ['no word list (*.json)'];
  const ids = new Set<string>();
  const words = new Map<string, string>();
  for (const f of files) {
    let categories: any;
    try {
      categories = JSON.parse(readFileSync(join(dir, f), 'utf8'))?.categories;
    } catch (e: any) {
      problems.push(`${f}: ${e?.message ?? e}`);
      continue;
    }
    if (!categories || typeof categories !== 'object') { problems.push(`${f}: expected { categories: { easy, medium, hard } }`); continue; }
    for (const key of Object.keys(categories)) if (!LEVELS.includes(key as Level)) problems.push(`${f}: unknown level "${key}"`);
    for (const level of LEVELS) {
      const list = categories[level];
      if (list === undefined) continue;
      if (!Array.isArray(list)) { problems.push(`${f}: ${level} must be a list`); continue; }
      list.forEach((w: any, i: number) => {
        const at = `${f}: ${level} #${i}${typeof w?.id === 'string' ? ` (${w.id})` : ''}`;
        if (typeof w?.id !== 'string' || !w.id.trim()) { problems.push(`${at}: missing id`); return; }
        if (ids.has(w.id)) { problems.push(`${at}: duplicate id`); return; }
        ids.add(w.id);
        if (typeof w.word !== 'string' || !ONE_WORD.test(w.word)) { problems.push(`${at}: word must be one word (letters, hyphens, apostrophes)`); return; }
        const key = normalize(w.word);
        if (words.has(key)) { problems.push(`${at}: "${w.word}" is already ${words.get(key)}`); return; }
        words.set(key, w.id);
        bank[level].push({ id: w.id, word: w.word });
      });
    }
  }
  for (const level of LEVELS) if (!files.length || bank[level].length === 0) problems.push(`no ${level} words`);
  if (problems.length) throw new Error(`pyramide word bank is broken (${problems.length} problem(s)) in ${dir}:\n  - ${problems.join('\n  - ')}`);
  return bank;
}

/**
 * Is a guess the word? Equal once case, accents, surrounding spaces and a leading article are ignored;
 * spelling mistakes aren't forgiven. The one place guesses are judged, so a smarter check can replace it.
 */
export function judgeGuess(word: string, guess: string): boolean {
  const g = normalize(guess);
  return g !== '' && g === normalize(word);
}

/** Pyramide's round server code. Loads the bank at boot: a broken bank refuses to boot. */
export function makePyramideServer(dir = PYRAMIDE_DIR): RoundServer<PyramideState, PyramideAction, WordBank> {
  const bank = loadWords(dir);
  console.log(`[itloe] pyramide words: ${LEVELS.map((level) => `${bank[level].length} ${level}`).join(', ')}`);

  return {
    // actions are rebuilt field by field: ids and verdicts never come from the wire
    message(m, { id, state: s }) {
      switch (m.t) {
        case 'clue':
          if (typeof m.text !== 'string' || m.text.length > MAX_CLUE * 4) return { refused: 'refused' };
          return { action: { t: 'clue', id, text: m.text }, refused: 'refused' };

        case 'guess': {
          // judged HERE: the reducer gets the verdict
          if (typeof m.text !== 'string' || !m.text.trim()) return { refused: 'refused' };
          const text = m.text.trim().slice(0, MAX_GUESS);
          const word = s.teams[s.turn].word;
          return { action: { t: 'guess', id, text, found: !!word && judgeGuess(word.word, text) }, refused: 'refused' };
        }

        case 'skip':
          return { action: { t: 'skip', id }, refused: 'refused' };

        case 'bid':
          if (!Number.isInteger(m.n)) return { refused: 'refused' };
          return { action: { t: 'bid', id, n: m.n }, refused: 'refused' };

        case 'pass':
          return { action: { t: 'pass', id }, refused: 'refused' };

        default: // not a Pyramide thing (place, answer, …)
          return { refused: 'not-playing' };
      }
    },

    // the words a round may draw: the bank minus every word used this evening (finished rounds included)
    inputs: (_settings, asked) => {
      const used = new Set(asked);
      return Object.fromEntries(LEVELS.map((level) => [level, bank[level].filter((w) => !used.has(w.id))])) as WordBank;
    },

    // the round without the words still drawable; the word in play is in it, and the screens show it only
    // on its clue givers' phones
    view: ({ pool: _pool, ...shown }) => shown,
  };
}
