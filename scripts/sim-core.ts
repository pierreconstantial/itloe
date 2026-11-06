// Balance simulator core: headless single-player games driven through shared reduce().
// Balance is per player (every player gets the same hands, boards are independent), so one
// player per game is enough.

import { canPlace, place, findClears, applyClears, anyFit } from '../shared/board.js';
import { PIECES, PIECE_SETS, handAt, type PieceId, type PieceSetId } from '../shared/pieces.js';
import { startGame, reduce, type Player, type Settings, type State } from '../shared/game.js';
import { mulberry32 } from '../shared/rng.js';

export type Weights = Record<PieceId, number>;

export type Move = { piece: 0 | 1 | 2; x: number; y: number; lines: number; gained: number; after: number[] };

export type PolicyCtx = { p: Player; size: number; rng: () => number };
export type Policy = { name: string; label: string; choose: (moves: Move[], ctx: PolicyCtx) => Move };

/** Every legal (slot, x, y) of the player's hand, with its immediate outcome. */
export function legalMoves(p: Player, rules: Settings): Move[] {
  const { size } = rules;
  const out: Move[] = [];
  for (const piece of [0, 1, 2] as const) {
    const id = p.hand[piece];
    if (id == null) continue;
    const cells = PIECES[id].cells;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!canPlace(p.board, size, cells, x, y)) continue;
        const placed = place(p.board, size, cells, x, y, p.color);
        const clears = findClears(placed, size);
        const lines = clears.rows.length + clears.cols.length;
        const after = lines > 0 ? applyClears(placed, size, clears) : placed;
        const empty = lines > 0 && after.every((c) => c === 0);
        const gained =
          cells.length + 10 * lines * lines * (1 + p.streak) + (empty ? rules.cleanBoardBonus : 0);
        out.push({ piece, x, y, lines, gained, after });
      }
    }
  }
  return out;
}

function pickRandom<T>(xs: T[], rng: () => number): T {
  return xs[Math.floor(rng() * xs.length)];
}

/** Arg-max with uniform random tie-break. */
function best(moves: Move[], value: (m: Move) => number, rng: () => number): Move {
  let top = -Infinity;
  let ties: Move[] = [];
  for (const m of moves) {
    const v = value(m);
    if (v > top) { top = v; ties = [m]; } else if (v === top) ties.push(m);
  }
  return pickRandom(ties, rng);
}

/** Empty/filled orthogonal edges (board border counts as filled) and fully enclosed single empty cells. */
export function roughness(board: number[], size: number): { edges: number; isolated: number } {
  let edges = 0;
  let isolated = 0;
  const filled = (x: number, y: number) => x < 0 || y < 0 || x >= size || y >= size || board[y * size + x] !== 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (filled(x, y)) continue;
      let n = 0;
      if (filled(x - 1, y)) n++;
      if (filled(x + 1, y)) n++;
      if (filled(x, y - 1)) n++;
      if (filled(x, y + 1)) n++;
      edges += n;
      if (n === 4) isolated++;
    }
  }
  return { edges, isolated };
}

const tidyValue = (m: Move, p: Player, size: number) => {
  const { edges, isolated } = roughness(m.after, size);
  const rest = p.hand.map((h, i) => (i === m.piece ? null : h));
  const restFits = rest.every((h) => h === null) || anyFit(m.after, size, rest);
  return 8 * m.lines - edges - 4 * isolated - (restFits ? 0 : 1000);
};

export const POLICIES: Record<string, Policy> = {
  random: {
    name: 'random',
    label: 'uniform over legal placements (floor)',
    choose: (moves, { rng }) => pickRandom(moves, rng),
  },
  greedy: {
    name: 'greedy',
    label: 'max immediate gained score, random tie-break',
    choose: (moves, { rng }) => best(moves, (m) => m.gained, rng),
  },
  tidy: {
    name: 'tidy',
    label: 'HEURISTIC: clears + few empty/filled edges + no isolated holes + rest of hand still fits',
    choose: (moves, { p, size, rng }) => best(moves, (m) => tidyValue(m, p, size), rng),
  },
  casual: {
    name: 'casual',
    label: 'HEURISTIC MIX: tidy, but 25% of moves uniformly random (a stand-in for an average player)',
    choose: (moves, { p, size, rng }) =>
      rng() < 0.25 ? pickRandom(moves, rng) : best(moves, (m) => tidyValue(m, p, size), rng),
  },
};

/** Replica of handAt over an arbitrary weight table (what-if mode). Verified against handAt at startup. */
export function dealWith(weights: Weights, seed: number, n: number): [PieceId, PieceId, PieceId] {
  const ids = Object.keys(PIECES).filter((id) => (weights[id] ?? 0) > 0);
  const ws = ids.map((id) => weights[id]);
  const total = ws.reduce((s, w) => s + w, 0);
  const rng = mulberry32((seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0);
  const pick = (): PieceId => {
    let r = rng() * total;
    for (let i = 0; i < ids.length; i++) {
      r -= ws[i];
      if (r < 0) return ids[i];
    }
    return ids[ids.length - 1];
  };
  return [pick(), pick(), pick()];
}

/** Throws unless dealWith reproduces handAt exactly for every set. */
export function verifyDealReplica(hands = 300): void {
  for (const set of Object.keys(PIECE_SETS) as PieceSetId[]) {
    for (const seed of [1, 42, 0xdeadbeef]) {
      for (let n = 0; n < hands; n++) {
        const a = handAt(seed, n, set).join();
        const b = dealWith(PIECE_SETS[set].weights, seed, n).join();
        if (a !== b) throw new Error(`deal replica diverges from handAt: set ${set} seed ${seed} n ${n}`);
      }
    }
  }
}

export type GameResult = {
  seed: number;
  hands: number;            // hands fully placed before dying
  score: number;
  placements: number;
  clearing: number;         // placements that cleared ≥1 line
  lines: number;
  cleanBoards: number;
  runPeaks: number[];       // peak streak of each streak run
  pts: { cells: number; base: number; mult: number; bonus: number };
  bestRun: number;          // clear points (base + streak ×) of the best streak run
  bestRunShare: number;     // bestRun / final score
  deathHand: PieceId[];     // pieces left in hand at death (all unplaceable)
  freshDeath: boolean;      // died on a just-dealt hand (3 pieces left)
  dealt: Record<PieceId, number>;
  capped: boolean;          // hit the hand cap (still alive)
};

const HAND_CAP = 2000;

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Plays one deterministic game. `salt` varies the policy's tie-break RNG only (same hands),
 * used to pit two players against each other on identical hands. `weights` = what-if override of the set's weights: hands are
 * then re-dealt with dealWith after every reduce (reduce itself always deals from PIECE_SETS).
 */
export function playGame(
  seed: number, settings: Partial<Settings>, policy: Policy, weights?: Weights, salt = 0
): GameResult {
  let s: State = startGame({ seed, settings, players: [{ id: 'a', character: 'pierre' }], now: 0 })!;
  const ctx = { gameMasterId: 'a' }; // 'a' plays and is the game master
  const { rules } = s;
  const rng = mulberry32((seed ^ hashName(policy.name) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);

  const redeal = (st: State, n: number): State => {
    if (!weights) return st;
    const p = st.players.a;
    const hand = dealWith(weights, st.seed, n);
    const done = !anyFit(p.board, rules.size, hand);
    return {
      ...st,
      phase: done ? 'finished' : 'playing',
      endReason: done ? 'stuck' : null,
      players: { a: { ...p, hand, done } },
    };
  };
  s = redeal(s, 0);

  const dealt: Record<PieceId, number> = {};
  const countHand = (h: (PieceId | null)[]) => { for (const id of h) if (id) dealt[id] = (dealt[id] ?? 0) + 1; };
  countHand(s.players.a.hand);

  const r: GameResult = {
    seed, hands: 0, score: 0, placements: 0, clearing: 0, lines: 0, cleanBoards: 0, runPeaks: [],
    pts: { cells: 0, base: 0, mult: 0, bonus: 0 }, bestRun: 0, bestRunShare: 0, deathHand: [], freshDeath: false,
    dealt, capped: false,
  };
  let runPeak = 0;
  let runPts = 0;
  let bestRun = 0;
  const closeRun = () => {
    if (runPeak > 0) { r.runPeaks.push(runPeak); bestRun = Math.max(bestRun, runPts); }
    runPeak = 0;
    runPts = 0;
  };

  while (s.phase === 'playing') {
    const p = s.players.a;
    if (p.handIndex >= HAND_CAP) { r.capped = true; break; }
    const moves = legalMoves(p, rules);
    const m = policy.choose(moves, { p, size: rules.size, rng });
    const next = reduce(s, { t: 'place', id: 'a', piece: m.piece, x: m.x, y: m.y }, ctx);
    if (next === s) throw new Error(`policy ${policy.name} chose an illegal move (seed ${seed})`);
    s = next.players.a.handIndex !== p.handIndex ? redeal(next, next.players.a.handIndex) : next;
    const q = s.players.a;
    if (q.handIndex !== p.handIndex) countHand(q.hand);

    const last = q.last!;
    const cells = PIECES[last.pieceId].cells.length;
    const lines = last.rows.length + last.cols.length;
    const bonus = last.cleanBoard ? rules.cleanBoardBonus : 0;
    const base = 10 * lines * lines;
    r.placements++;
    r.lines += lines;
    if (lines > 0) r.clearing++;
    if (last.cleanBoard) r.cleanBoards++;
    r.pts.cells += cells;
    r.pts.base += base;
    r.pts.mult += last.gained - cells - bonus - base;
    r.pts.bonus += bonus;
    if (last.streak > 0) {
      runPeak = Math.max(runPeak, last.streak);
      runPts += last.gained - cells - bonus;
    } else closeRun();
  }
  closeRun();

  const p = s.players.a;
  r.hands = p.handIndex;
  r.score = p.score;
  r.bestRun = bestRun;
  r.bestRunShare = p.score > 0 ? bestRun / p.score : 0;
  if (!r.capped) {
    r.deathHand = p.hand.filter((h): h is PieceId => h !== null);
    r.freshDeath = r.deathHand.length === 3;
  }
  return r;
}
