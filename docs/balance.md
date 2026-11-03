# Balance — simulator findings (2026-11-04)

Data for SPEC-BLOCKS.md §13 Q4 (piece weights, «an average player survives ~15–25 hands») and Q1 (is `10 × L² × (1 + streak)` with grace 1 well-proportioned).

## How it was measured

`npm run sim` (`scripts/simulate.mts` + `scripts/sim-core.ts`) plays headless single-player games through the real `shared/game.js` `reduce()` and `shared/pieces.js` `handAt()`. No server or browser is involved. One player is enough, because every player gets the same hands on an independent board.

- **2,000 games per configuration, seeds 1..2000.** Game *i* uses seed *i* in every configuration, so all configurations are compared on the same hands. Runs are deterministic and reproducible.
- **Board sizes:** 8×8 for every table below; 9×9 and 10×10 ran as a second pass (`--sizes 8,9,10`).
- **Policies** (bots):

  | policy | what it does |
  |---|---|
  | `random` | uniform over legal placements: the floor |
  | `greedy` | maximises the score of the current move, random tie-break |
  | `tidy` | **heuristic**: likes clears, dislikes empty/filled edges and isolated holes, refuses moves that leave the rest of the hand unplaceable. A competent but not perfect player |
  | `casual` | **heuristic mix**: `tidy`, but 25% of its moves are random. My stand-in for an average player; it is *not* calibrated on humans |

- **What-if weights:** `--weights id=w,…` re-deals hands from a modified table, so a proposal can be tested without touching `PIECE_SETS`. The re-dealing code is checked against `handAt` at startup, and the run aborts if they diverge.
- Flags: `npm run sim -- --games 2000 --seed 1 --sizes 8,9,10 --sets full,simple --policies random,greedy,casual,tidy --weights … --json out.json` (the defaults are 2000 games, seed 1, size 8, both sets, and the random, greedy and tidy policies). Each configuration also plays a second, head-to-head game per seed. The full pass over all three sizes takes about 5 minutes; size 8 only takes under a minute.

## Q4: how long games last, and what kills players

### Hands survived, 8×8, current weights

| set | policy | p10 | median | p90 |
|---|---|---|---|---|
| full | random | 2 | 4 | 5 |
| full | greedy | 3 | 6 | 11 |
| full | casual | 5 | 10 | 22 |
| full | tidy | 10 | 30 | 87 |
| simple | greedy | 4 | 7 | 15 |
| simple | casual | 6 | 13 | 30 |
| simple | tidy | 15 | 62 | 188 |

With the heuristic `tidy` bot, 9×9 gives a median of 44 hands and 10×10 gives 53, so board size is a much stronger lever on game length than weights.

- **The 15–25 target falls between `casual` and `tidy`.** If playtests show that average players play like `casual`, games are slightly short; if they play like `tidy`, slightly long. Only playtests can settle which, so log hands survived per player in the playtests.
- **Weights barely move weak play.** Even large changes (3×3 square removed, rectangles halved) moved `greedy` by only 1–3 hands. Weak players die from a messy board, not from one specific piece; weights mostly change how long skilled play lasts.
- **The simple set mainly lengthens skilled play.** On the simple set, `greedy` survives 7 hands instead of 6 and `casual` 13 instead of 10, but `tidy` survives 62 instead of 30. Settings are shared by all players, so in a family game on the simple set the adult's game roughly doubles while the child gains a hand or two. The simple set is a «long, calm game» option rather than a kids' easy mode.

### What kills players

The figure for each piece is its share of the pieces left in the unplaceable final hand, with its over-representation versus how often it is dealt in brackets (×1 = dies as often as it appears).

| set | policy | top killers |
|---|---|---|
| full | casual | **sq3 16.7% (×9.2)**, r2x3 10.9% (×3.0), r3x2 10.8% (×2.9), v5 5.4% (×3.0), h5 5.0% (×2.9) |
| full | tidy | **sq3 25.6% (×14.1)**, r2x3 10.0% (×2.8), r3x2 9.9% (×2.8), v5 5.0%, h5 4.9% |
| simple | tidy | **sq3 39.9% (×15.9)**, r2x3 11.8%, r3x2 11.6%, h5 6.3%, v5 6.2% |

- **The 3×3 square dominates.** It is about 1.9% of dealt pieces (weight 1 out of 54) but a quarter of the death hands for `tidy`, and 40% on the simple set. Many games end the same way: «a 3×3 square arrives and there is no 3×3 hole». It is fair, since everyone gets the same square, but it makes deaths feel repetitive.
- Next come the 6-cell rectangles (×3) and the 1×5 bars (×3). The S, Z and T pieces sit around ×1–1.6; they are not the problem.
- Only 2–7% of deaths happen on a freshly dealt hand. Almost all deaths happen mid-hand, after the player has already placed one or two of its pieces.

### Recommendation (for the orchestrator to decide; nothing changed in `PIECE_SETS`)

**R1 — vary what kills players without changing game length.** Apply to both sets: `sq3` 1 → 0.5, and `bc_nw`, `bc_ne`, `bc_sw`, `bc_se` 1 → 1.5 (the four 5-cell corners).

| 8×8 | median hands, before → after | 3×3 square's share of death hands |
|---|---|---|
| full, casual | 10 → 10 (mean 11.6 → 11.6) | 16.7% → 9.0% |
| full, tidy | 30 → 29 | 25.6% → 13.6% |
| simple, casual | 13 → 13 | 25.0% → 12.3% |
| simple, tidy | 62 → 56 | 39.9% → 20.0% |

Command: `npm run sim -- --sets full --weights sq3=0.5,bc_nw=1.5,bc_ne=1.5,bc_sw=1.5,bc_se=1.5`

The difficulty moves from the single 3×3 square to the four corner pieces, so deaths come from a wider mix of pieces. Changing weights changes the hand sequence of every seed; that is the caveat already accepted for resumed games.

**R2 — tune length after playtests, and not mainly with weights.** Weights hardly move weak players. If playtests show games are too short for average players, board size (9×9) is the strong lever. If they are too long, raise `sq3` back up or raise the rectangles: `sq3=0.5` alone gives `tidy` about +5 hands, and the rectangles at 1.5 have about the same effect.

**R3 — don't push the simple set further for children.** Removing the 3×3 square from the simple set (`sq3=0`) gives `greedy` only +2 hands, but `tidy` jumps to a median of 166 hands, making mixed games far too long.

## Q1: combo scoring

Share of all points, 8×8 full set:

| policy | cells | 10L² | streak × | clean bonus |
|---|---|---|---|---|
| greedy | 44% | 32% | 23% | 1.0% |
| casual | 33% | 38% | 28% | 0.8% |
| tidy | 26% | 39% | 36% | 0.2% |

**Head-to-head.** Two players with the same policy play identical hands, differing only in their tie-break randomness. The table shows how often the winner would change if we removed…

| policy | …the streak × points | …each player's single best streak run |
|---|---|---|
| greedy | 5.6% | 11.3% |
| casual | 7.4% | 9.2% |
| tidy | 5.8% | 3.9% |

- **The combo is well-proportioned.** It is a large share of points for good players (about a third), so consistent clearing is clearly rewarded. But it changes the winner in only 5–8% of games, and the best single streak run decides fewer than 1 game in 10. The winner is mostly decided by survival: the mean score gap between two same-policy players on the same hands is about 50%. One lucky streak does not decide the game. If anything there is room to make streaks *stronger* for more drama; there's no need to weaken them.
- **Streak peaks** for `tidy`: 41% of streak runs peak at 1, 25% at 2, 17% at 3, and 17% at 4 or more (the maximum seen was 13). «Combo ×3!» call-outs will be common for good players.
- **Multi-line clears are rare:** 1.03–1.3 lines per clearing placement. The L² term is almost always 10, so «Double line!» is a rare event.
- **A clean board is a jackpot:** it happens in 0–4% of games and is worth 0.2–1% of all points. The +300 bonus is harmless. A lower bonus (the settings allow 0–500) would make no measurable difference to outcomes.

## Limits

- All bots are heuristics, and "average player" = `casual` is an assumption. The simulator gives the *relative* effect of a weight change reliably; the absolute hand counts for humans need playtest data.
- These are single-player statistics. Timed mode and interaction between players (none exists yet) are not simulated.
