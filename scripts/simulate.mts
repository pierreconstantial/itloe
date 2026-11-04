// Headless balance simulator over shared reduce()/handAt() — SPEC §13 Q1 (combo) and Q4 (weights).
// Usage: npm run sim -- [--games 2000] [--seed 1] [--sizes 8] [--sets full,simple]
//                        [--policies random,greedy,tidy] [--weights sq3=0.5,h5=0.5] [--json out.json]
// Game i of every configuration uses seed (--seed + i), so configurations are compared on the same hands.
// --weights is a what-if override applied on top of each selected set's weights (0 removes a piece).

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { PIECE_SETS, type PieceId, type PieceSetId } from '../shared/pieces.js';
import { PIECES } from '../shared/pieces.js';
import { POLICIES, playGame, verifyDealReplica, type GameResult, type Weights } from './sim-core.ts';

const { values: args } = parseArgs({
  options: {
    games: { type: 'string', default: '2000' },
    seed: { type: 'string', default: '1' },
    sizes: { type: 'string', default: '8' },
    sets: { type: 'string', default: 'full,simple' },
    policies: { type: 'string', default: 'random,greedy,tidy' },
    weights: { type: 'string' },
    json: { type: 'string' },
  },
});

const games = Number(args.games);
const seed0 = Number(args.seed);
const sizes = args.sizes.split(',').map(Number) as (8 | 9 | 10)[];
const sets = args.sets.split(',') as PieceSetId[];
const policies = args.policies.split(',').map((n) => {
  const p = POLICIES[n];
  if (!p) throw new Error(`unknown policy ${n} (have: ${Object.keys(POLICIES).join(', ')})`);
  return p;
});
for (const s of sets) if (!PIECE_SETS[s]) throw new Error(`unknown set ${s}`);
for (const z of sizes) if (![8, 9, 10].includes(z)) throw new Error(`bad size ${z}`);

const overrides: Weights = {};
for (const kv of args.weights ? args.weights.split(',') : []) {
  const [id, w] = kv.split('=');
  if (!PIECES[id] || !Number.isFinite(Number(w)) || Number(w) < 0) throw new Error(`bad weight ${kv}`);
  overrides[id] = Number(w);
}
const whatIf = Object.keys(overrides).length > 0;
if (whatIf) verifyDealReplica();

// ---------- stats ----------

const pct = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const pc = (x: number) => `${(100 * x).toFixed(1)}%`;

type Summary = ReturnType<typeof summarize>;

/**
 * Head-to-head on identical hands (same seed, different tie-break RNG): how often would the
 * winner change without the streak multiplier points, or without each player's best streak run?
 */
function headToHead(rs: GameResult[], rivals: GameResult[]) {
  const sign = (x: number) => Math.sign(x);
  let decided = 0;
  let flipMult = 0;
  let flipRun = 0;
  let gap = 0;
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i];
    const b = rivals[i];
    const s = sign(a.score - b.score);
    if (s === 0) continue;
    decided++;
    gap += Math.abs(a.score - b.score) / Math.max(a.score, b.score);
    if (sign(a.score - a.pts.mult - (b.score - b.pts.mult)) !== s) flipMult++;
    if (sign(a.score - a.bestRun - (b.score - b.bestRun)) !== s) flipRun++;
  }
  return { decided, flipMult: flipMult / decided, flipRun: flipRun / decided, gap: gap / decided };
}

function summarize(rs: GameResult[], rivals: GameResult[]) {
  const hands = rs.map((r) => r.hands);
  const scores = rs.map((r) => r.score);
  const placements = sum(rs.map((r) => r.placements));
  const clearing = sum(rs.map((r) => r.clearing));
  const peaks = rs.flatMap((r) => r.runPeaks);
  const pts = { cells: 0, base: 0, mult: 0, bonus: 0 };
  for (const r of rs) for (const k of Object.keys(pts) as (keyof typeof pts)[]) pts[k] += r.pts[k];
  const totalPts = pts.cells + pts.base + pts.mult + pts.bonus;

  const dealt: Record<PieceId, number> = {};
  const death: Record<PieceId, number> = {};
  for (const r of rs) {
    for (const [id, n] of Object.entries(r.dealt)) dealt[id] = (dealt[id] ?? 0) + n;
    for (const id of r.deathHand) death[id] = (death[id] ?? 0) + 1;
  }
  const dealtTotal = sum(Object.values(dealt));
  const deathTotal = sum(Object.values(death));
  const killers = Object.keys(death)
    .map((id) => ({
      id,
      share: death[id] / deathTotal,
      ratio: death[id] / deathTotal / (dealt[id] / dealtTotal), // >1 = over-represented in death hands
    }))
    .sort((a, b) => b.share - a.share);

  return {
    games: rs.length,
    capped: rs.filter((r) => r.capped).length,
    hands: { p10: pct(hands, 0.1), p50: pct(hands, 0.5), p90: pct(hands, 0.9), mean: mean(hands) },
    score: { p10: pct(scores, 0.1), p50: pct(scores, 0.5), p90: pct(scores, 0.9), mean: mean(scores) },
    clearsPerPlacement: clearing / placements,
    linesPerClear: sum(rs.map((r) => r.lines)) / Math.max(1, clearing),
    runs: {
      perGame: peaks.length / rs.length,
      peak1: peaks.filter((p) => p === 1).length / Math.max(1, peaks.length),
      peak2: peaks.filter((p) => p === 2).length / Math.max(1, peaks.length),
      peak3: peaks.filter((p) => p === 3).length / Math.max(1, peaks.length),
      peak4plus: peaks.filter((p) => p >= 4).length / Math.max(1, peaks.length),
      p90: pct(peaks, 0.9),
      max: peaks.reduce((m, p) => Math.max(m, p), 0),
    },
    cleanBoardsPerGame: mean(rs.map((r) => r.cleanBoards)),
    gamesWithCleanBoard: rs.filter((r) => r.cleanBoards > 0).length / rs.length,
    scoreShare: {
      cells: pts.cells / totalPts, base: pts.base / totalPts, mult: pts.mult / totalPts, bonus: pts.bonus / totalPts,
    },
    bestRunShare: { p50: pct(rs.map((r) => r.bestRunShare), 0.5), p90: pct(rs.map((r) => r.bestRunShare), 0.9) },
    freshDeaths: rs.filter((r) => r.freshDeath).length / rs.length,
    killers,
    h2h: headToHead(rs, rivals),
  };
}

// ---------- run ----------

console.log(`Itloe balance sim — ${games} games per configuration, seeds ${seed0}..${seed0 + games - 1}` +
  (whatIf ? `, WHAT-IF weights ${args.weights}` : ', weights = PIECE_SETS as committed'));
for (const p of policies) console.log(`  ${p.name.padEnd(7)} ${p.label}`);
console.log();

const results: { size: number; set: PieceSetId; policy: string; summary: Summary }[] = [];
const t0 = performance.now();
for (const size of sizes) {
  for (const set of sets) {
    const weights = whatIf ? { ...PIECE_SETS[set].weights, ...overrides } : undefined;
    if (weights && set === 'simple') for (const id of Object.keys(overrides)) if (!(id in PIECE_SETS.simple.weights)) delete weights[id];
    for (const policy of policies) {
      const rs: GameResult[] = [];
      const rivals: GameResult[] = [];
      for (let i = 0; i < games; i++) {
        rs.push(playGame(seed0 + i, { size, pieceSet: set }, policy, weights, 0));
        rivals.push(playGame(seed0 + i, { size, pieceSet: set }, policy, weights, 1));
      }
      results.push({ size, set, policy: policy.name, summary: summarize(rs, rivals) });
    }
  }
}
const secs = (performance.now() - t0) / 1000;

// ---------- report ----------

const table = (head: string[], rows: string[][]) => {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i < 3 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  console.log(line(head));
  console.log(w.map((n) => '-'.repeat(n)).join('  '));
  for (const r of rows) console.log(line(r));
  console.log();
};
const key = (r: (typeof results)[number]) => [String(r.size), r.set, r.policy];

console.log('Survival and score');
table(
  ['size', 'set', 'policy', 'hands p10', 'p50', 'p90', 'mean', 'score p10', 'p50', 'p90', 'capped'],
  results.map((r) => {
    const s = r.summary;
    return [...key(r), String(s.hands.p10), String(s.hands.p50), String(s.hands.p90), f1(s.hands.mean),
      String(s.score.p10), String(s.score.p50), String(s.score.p90), String(s.capped)];
  })
);

console.log('Clears, streaks, clean boards');
table(
  ['size', 'set', 'policy', 'clears/plc', 'lines/clear', 'runs/game', 'peak 1', '2', '3', '4+', 'peak max', 'clean/game', 'games w/ clean'],
  results.map((r) => {
    const s = r.summary;
    return [...key(r), pc(s.clearsPerPlacement), f2(s.linesPerClear), f1(s.runs.perGame), pc(s.runs.peak1),
      pc(s.runs.peak2), pc(s.runs.peak3), pc(s.runs.peak4plus), String(s.runs.max), f2(s.cleanBoardsPerGame),
      pc(s.gamesWithCleanBoard)];
  })
);

console.log('Score composition (Q1) — share of all points; best run = clear points of the best streak run / final score');
table(
  ['size', 'set', 'policy', 'cells', '10L²', 'streak ×', 'clean bonus', 'best run p50', 'best run p90'],
  results.map((r) => {
    const s = r.summary;
    return [...key(r), pc(s.scoreShare.cells), pc(s.scoreShare.base), pc(s.scoreShare.mult), pc(s.scoreShare.bonus),
      pc(s.bestRunShare.p50), pc(s.bestRunShare.p90)];
  })
);

console.log('Head-to-head (Q1) — two players of the same policy on identical hands: winner flips if we remove…');
table(
  ['size', 'set', 'policy', 'decided pairs', 'mean gap', '…streak × points', '…each best run'],
  results.map((r) => {
    const h = r.summary.h2h;
    return [...key(r), String(h.decided), pc(h.gap), pc(h.flipMult), pc(h.flipRun)];
  })
);

console.log('Death attribution — pieces left in the unplaceable final hand: share of death-hand pieces (×over-representation vs dealt)');
table(
  ['size', 'set', 'policy', 'fresh-hand deaths', 'top killers'],
  results.map((r) => {
    const s = r.summary;
    const top = s.killers.slice(0, 6).map((k) => `${k.id} ${pc(k.share)} (×${f1(k.ratio)})`).join(', ');
    return [...key(r), pc(s.freshDeaths), top];
  })
);

console.log(`${results.length} configurations × ${games} games in ${secs.toFixed(1)} s`);
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ games, seed0, weights: args.weights ?? null, results }, null, 2));
  console.log(`JSON → ${args.json}`);
}
