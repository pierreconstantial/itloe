// Canonical form of French text for comparing what someone typed: the quiz's typed answers
// (shared/quiz/judge-local.js) and Pyramide's clues and guesses (shared/pyramide.js, server/pyramide.ts).
// Pure, no imports: browsers load it too.
//   case, accents (é → e), ligatures (œ → oe), curly apostrophes, punctuation and hyphens (→ spaces),
//   ONE leading French article (le/la/les/l'/un/une/des/du/de la/de l'/d').

/** Leading articles, longest first ("de la" before "de"); elided ones end with an apostrophe. */
const ARTICLES = ["de la ", "de l'", 'les ', 'des ', 'une ', 'le ', 'la ', 'un ', 'du ', "l'", "d'"];

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
