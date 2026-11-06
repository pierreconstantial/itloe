// Local text judge for typed quiz answers (Contract E): pure, no I/O, French-aware.
// Verdict per answer: 'right' (clearly the answer, small typos forgiven), 'wrong' (clearly not), or
// 'uncertain' (close, partial, or ambiguous): the server may then ask a pluggable judge, else counts it
// wrong and lets the game master override on the reveal.
//
//   normalize: case, accents (é → e), ligatures (œ → oe), curly apostrophes, punctuation and hyphens
//              (→ spaces), ONE leading French article (le/la/les/l'/un/une/des/du/de la/de l'/d').
//   numbers:   an answer made of digits (a year…) must match EXACTLY: 1789 is never 1798.
//   distance:  Levenshtein from `fastest-levenshtein` (MIT, zero dependencies, 21 kB), plus one rule of
//              ours: a single swapped pair of adjacent letters ("Mozatr") is one typo, not two. The
//              thresholds are data (JUDGE_RULES), relative to the answer's length.
// Server and tests only: no browser imports this file (the bare npm import would not resolve there).
import { distance as levenshtein } from 'fastest-levenshtein';

/** @typedef {'right' | 'wrong' | 'uncertain'} LocalVerdict */
/** @typedef {{ answer: string | number, choices?: string[], accept?: string[] }} Judgeable */

/**
 * The judge's tuning, as data:
 *  - budgets: by answer length (normalized chars), [max length, typos still 'right'] — the last one covers the rest;
 *  - uncertainFactor: a distance up to this × the budget is 'uncertain' rather than 'wrong';
 *  - partialMinWord: a partial name ("Hugo" for "Victor Hugo") is 'uncertain' only when it has a word this long.
 */
export const JUDGE_RULES = Object.freeze({
  budgets: /** @type {readonly (readonly [number, number])[]} */ ([[3, 0], [7, 1], [12, 2], [Infinity, 3]]),
  uncertainFactor: 2,
  partialMinWord: 3,
});
/** The length budgets (kept as an export for readers of the old name). */
export const THRESHOLDS = JUDGE_RULES.budgets;

/** Leading articles, longest first ("de la" before "de"); elided ones end with an apostrophe. */
const ARTICLES = ["de la ", "de l'", 'les ', 'des ', 'une ', 'le ', 'la ', 'un ', 'du ', "l'", "d'"];

/** @param {number} len @returns {number} */
export function typoBudget(len) {
  for (const [max, typos] of JUDGE_RULES.budgets) if (len <= max) return typos;
  return 0;
}

/**
 * Canonical form for comparison.
 * @param {string} raw @returns {string}
 */
export function normalize(raw) {
  let s = String(raw ?? '')
    .normalize('NFD').replace(/\p{M}+/gu, '') // accents
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[’‘`´ʼ]/g, "'")
    .replace(/&/g, ' et ')
    .replace(/[^\p{L}\p{N}']+/gu, ' ') // punctuation, hyphens, symbols → space
    .replace(/\s+/g, ' ')
    .trim();
  for (const a of ARTICLES) {
    if (s.startsWith(a) && s.length > a.length) { s = s.slice(a.length); break; }
  }
  return s.replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Same letters, one pair of adjacent letters swapped ("mozatr" / "mozart"). @param {string} a @param {string} b */
function oneAdjacentSwap(a, b) {
  if (a.length !== b.length) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i < a.length - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

/**
 * Typos between two normalized strings: Levenshtein (fastest-levenshtein), where a single adjacent swap
 * counts as one typo like a keyboard slip (plain Levenshtein would count it as two).
 * @param {string} a @param {string} b @returns {number}
 */
export function distance(a, b) {
  if (a === b) return 0;
  return oneAdjacentSwap(a, b) ? 1 : levenshtein(a, b);
}

/** The accepted spellings of a question's answer (the right choice's text, the answer, `accept`). @param {Judgeable} q @returns {string[]} */
export function expectedAnswers(q) {
  const main = typeof q.answer === 'number' ? q.choices?.[q.answer] : q.answer;
  return [main, ...(q.accept ?? [])].filter((x) => typeof x === 'string' && x.trim() !== '').map(String);
}

const RANK = { wrong: 0, uncertain: 1, right: 2 };

/** One typed text against one expected spelling. @param {string} text normalized @param {string} expected normalized @returns {LocalVerdict} */
function against(text, expected) {
  if (!text || !expected) return 'wrong';
  if (text === expected) return 'right';
  // numbers (years, counts): exact only, wherever they stand in the text ("en 1789", "1789 !")
  if (/^\d+$/.test(expected)) return text.split(' ').includes(expected) ? 'right' : 'wrong';
  const budget = typoBudget(expected.length);
  const d = distance(text, expected);
  if (d <= budget) return 'right';
  // partial names: "Hugo" for "Victor Hugo", or "Victor Hugo" for "Hugo"; a meaningful word is needed
  const tt = text.split(' '), et = expected.split(' ');
  const [small, big] = tt.length <= et.length ? [tt, et] : [et, tt];
  if (small.some((w) => w.length >= JUDGE_RULES.partialMinWord) && small.every((w) => big.includes(w))) return 'uncertain';
  if (budget > 0 && d <= budget * JUDGE_RULES.uncertainFactor) return 'uncertain';
  return 'wrong';
}

/**
 * Judges a typed answer: the best verdict over every accepted spelling.
 * @param {Judgeable} q @param {string} text @returns {LocalVerdict}
 */
export function judgeLocal(q, text) {
  const t = normalize(text);
  if (!t) return 'wrong';
  /** @type {LocalVerdict} */
  let best = 'wrong';
  for (const e of expectedAnswers(q)) {
    const v = against(t, normalize(e));
    if (RANK[v] > RANK[best]) best = v;
    if (best === 'right') break;
  }
  return best;
}
