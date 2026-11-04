// Local text judge for typed quiz answers (Contract E): pure, no I/O, French-aware.
// Verdict per answer: 'right' (clearly the answer, small typos forgiven), 'wrong' (clearly not), or
// 'uncertain' (close, partial, or ambiguous): the server may then ask a pluggable judge, else counts it
// wrong and lets the host override on the reveal.
//
//   normalize: case, accents (é → e), ligatures (œ → oe), curly apostrophes, punctuation and hyphens
//              (→ spaces), ONE leading French article (le/la/les/l'/un/une/des/du/de la/de l'/d').
//   numbers:   an answer made of digits (a year…) must match EXACTLY: 1789 is never 1798.
//   distance:  optimal string alignment (a swapped pair of letters counts as one typo), with a
//              threshold relative to the answer's length: see THRESHOLDS.

/** @typedef {'right' | 'wrong' | 'uncertain'} LocalVerdict */
/** @typedef {{ answer: string | number, choices?: string[], accept?: string[] }} Judgeable */

/** Typo budget by answer length (normalized chars): [max length, typos still 'right']. Above all: last. */
export const THRESHOLDS = /** @type {const} */ ([[3, 0], [7, 1], [12, 2], [Infinity, 3]]);
/** A distance up to this factor × the budget is 'uncertain' rather than 'wrong'. */
const UNCERTAIN_FACTOR = 2;

/** Leading articles, longest first ("de la" before "de"); elided ones end with an apostrophe. */
const ARTICLES = ["de la ", "de l'", 'les ', 'des ', 'une ', 'le ', 'la ', 'un ', 'du ', "l'", "d'"];

/** @param {number} len @returns {number} */
export function typoBudget(len) {
  for (const [max, typos] of THRESHOLDS) if (len <= max) return typos;
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

/**
 * Optimal string alignment distance (Levenshtein + adjacent transpositions).
 * @param {string} a @param {string} b @returns {number}
 */
export function distance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  /** @type {number[][]} */
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
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
  if (small.some((w) => w.length >= 3) && small.every((w) => big.includes(w))) return 'uncertain';
  if (budget > 0 && d <= budget * UNCERTAIN_FACTOR) return 'uncertain';
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
