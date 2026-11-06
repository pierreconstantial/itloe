// Contract E — local text judge (shared/quiz/judge-local.js): real French tricky cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, distance, judgeLocal, typoBudget, JUDGE_RULES } from '../shared/quiz/judge-local.js';

/** @param {string | number} answer @param {{ choices?: string[], accept?: string[] }} [more] */
const q = (answer, more = {}) => ({ answer, ...more });

test('normalize: case, accents, ligatures, curly apostrophes, punctuation, hyphens', () => {
  assert.equal(normalize('  Molière '), 'moliere');
  assert.equal(normalize('CŒUR'), 'coeur');
  assert.equal(normalize('Saint-Exupéry'), 'saint exupery');
  assert.equal(normalize('L’Étranger'), 'etranger');
  assert.equal(normalize('« Les Misérables » !'), 'miserables');
  assert.equal(normalize('Roméo & Juliette'), 'romeo et juliette');
});

test('normalize: drops ONE leading French article, elided or not', () => {
  for (const [raw, out] of [
    ['le Louvre', 'louvre'], ['la Seine', 'seine'], ['les Alpes', 'alpes'], ["l'Everest", 'everest'],
    ['un chat', 'chat'], ['une pomme', 'pomme'], ['des pommes', 'pommes'], ['du pain', 'pain'],
    ['de la Fontaine', 'fontaine'], ["de l'eau", 'eau'], ["d'Artagnan", 'artagnan'],
  ]) assert.equal(normalize(raw), out, raw);
  assert.equal(normalize('La La Land'), 'la land', 'only one article');
  assert.equal(normalize('la'), 'la', 'an answer that IS an article stays');
  assert.equal(normalize('Lena'), 'lena', '"le" is only an article as a whole word');
});

test('distance: optimal string alignment (a swap is one typo)', () => {
  assert.equal(distance('mozart', 'mozart'), 0);
  assert.equal(distance('mozatr', 'mozart'), 1);
  assert.equal(distance('napolon', 'napoleon'), 1);
  assert.equal(distance('', 'abc'), 3);
  assert.equal(distance('rimbaud', 'verlaine'), 7);
});

test('typo budget grows with the answer length', () => {
  assert.deepEqual([2, 3, 4, 7, 8, 12, 13, 30].map(typoBudget), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test('right: exact after normalization (accents, case, articles, apostrophes)', () => {
  assert.equal(judgeLocal(q('Molière'), 'moliere'), 'right');
  assert.equal(judgeLocal(q("L'Étranger"), 'l etranger'), 'right');
  assert.equal(judgeLocal(q("L'Étranger"), 'L’étranger'), 'right');
  assert.equal(judgeLocal(q('Everest'), "l'Everest"), 'right');
  assert.equal(judgeLocal(q('Les Misérables'), 'miserables'), 'right');
  assert.equal(judgeLocal(q('Saint-Exupéry'), 'saint exupery'), 'right');
  assert.equal(judgeLocal(q('cœur'), 'coeur'), 'right');
});

test('right: small typos within the budget', () => {
  assert.equal(judgeLocal(q('Napoléon'), 'Napolon'), 'right');
  assert.equal(judgeLocal(q('Baudelaire'), 'Baudelair'), 'right');
  assert.equal(judgeLocal(q('Mozart'), 'Mozatr'), 'right');
  assert.equal(judgeLocal(q('Shakespeare'), 'Shakespear'), 'right');
});

test('short answers forgive nothing', () => {
  assert.equal(judgeLocal(q('Pô'), 'po'), 'right');
  assert.equal(judgeLocal(q('Pô'), 'pi'), 'wrong');
  assert.equal(judgeLocal(q('Rome'), 'Rone'), 'right', '4 letters: one typo');
  assert.equal(judgeLocal(q('Rome'), 'Rabe'), 'uncertain', 'two typos on 4 letters: ask');
});

test('numbers and years: exact only, wherever they stand in the text', () => {
  assert.equal(judgeLocal(q('1789'), '1789'), 'right');
  assert.equal(judgeLocal(q('1789'), 'en 1789 !'), 'right');
  assert.equal(judgeLocal(q('1789'), '1798'), 'wrong');
  assert.equal(judgeLocal(q('1789'), '1788'), 'wrong');
  assert.equal(judgeLocal(q('1789'), '17890'), 'wrong');
});

test('partial names are uncertain (the game master or a judge decides)', () => {
  assert.equal(judgeLocal(q('Victor Hugo'), 'Hugo'), 'uncertain');
  assert.equal(judgeLocal(q('Hugo'), 'Victor Hugo'), 'uncertain');
  assert.equal(judgeLocal(q('Antoine de Saint-Exupéry'), 'Saint Exupéry'), 'uncertain');
  assert.equal(judgeLocal(q('Victor Hugo'), 'de'), 'wrong', 'a filler word is not a partial name');
});

test('accept spellings and choice questions asked as text', () => {
  const vinci = q('Léonard de Vinci', { accept: ['Leonardo da Vinci', 'Vinci'] });
  assert.equal(judgeLocal(vinci, 'leonard de vinci'), 'right');
  assert.equal(judgeLocal(vinci, 'Leonardo da Vinci'), 'right');
  assert.equal(judgeLocal(vinci, 'Vinci'), 'right');
  const choice = q(2, { choices: ['Lyon', 'Marseille', 'Bordeaux', 'Lille'] });
  assert.equal(judgeLocal(choice, 'bordeaux'), 'right');
  assert.equal(judgeLocal(choice, 'Lyon'), 'wrong');
});

test('the library distance: plain Levenshtein, except ONE adjacent swap counts as one typo', () => {
  assert.equal(distance('mozart', 'mozart'), 0);
  assert.equal(distance('mozatr', 'mozart'), 1, 'one swap');
  assert.equal(distance('mzoatr', 'mozart'), 4, 'two swaps: plain Levenshtein (2 each); only ONE swap is special');
  assert.equal(distance('ab', 'ba'), 1);
  assert.equal(distance('kitten', 'sitting'), 3, 'the classic Levenshtein example');
});

test('more French cases: hyphenated places, particles, swapped letters, two-word names', () => {
  assert.equal(judgeLocal(q('Mont-Blanc'), 'mont blanc'), 'right');
  assert.equal(judgeLocal(q('Charles de Gaulle'), 'De Gaulle'), 'uncertain', 'surname with its particle');
  assert.equal(judgeLocal(q('Charles de Gaulle'), 'charles de gaule'), 'right', 'one letter missing on a long name');
  assert.equal(judgeLocal(q('Mozart'), 'Mzoatr'), 'wrong', 'two swaps on 6 letters: too garbled (the game master can override)');
  assert.equal(judgeLocal(q('Napoléon Bonaparte'), 'Napoleon'), 'uncertain');
  assert.equal(judgeLocal(q('Jeanne d’Arc'), "jeanne d'arc"), 'right', 'curly vs straight apostrophe inside a name');
});

test('the thresholds are data', () => {
  assert.ok(Object.isFrozen(JUDGE_RULES));
  assert.equal(JUDGE_RULES.uncertainFactor, 2);
  assert.deepEqual(JUDGE_RULES.budgets.at(-1), [Infinity, 3]);
});

test('clearly wrong, empty or junk', () => {
  assert.equal(judgeLocal(q('Rimbaud'), 'Verlaine'), 'wrong');
  assert.equal(judgeLocal(q('Paris'), ''), 'wrong');
  assert.equal(judgeLocal(q('Paris'), '   ?!  '), 'wrong');
  assert.equal(judgeLocal(q('Paris'), 'le'), 'wrong');
});
