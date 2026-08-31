<div align="center">

# GTO Trainer

*A preflop poker trainer that computes its own answers*

**[gtotrainer.vercel.app](https://gtotrainer.vercel.app)**

[![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/tests-467-3fb950?style=flat-square)](#correctness)

</div>

It deals you a spot, you pick an action, and it scores you against a range chart. Then it
shows you the **whole** range, because being told "fold KJo under the gun" is a fact to
memorise, while seeing KJo sit just outside a shape you already recognise is a rule you can
apply to the next hand.

No signup, no backend. Open the link and you are in it.

**Four modes.** Three preflop -- opening (five seats, four stack depths), facing a raise
(all fifteen opener and defender pairs), and push/fold (heads up, 2bb to 20bb) -- and one
postflop, where you play a hand out against the solver.

Every hand is drawn as a seat map, because position is a spatial fact. "UTG, HJ fold,
action on you" is a sentence you have to decode; a table with two seats greyed out and
three still live between you and the blinds is the same information in the shape you
already see it in. The chips in front of each seat are on it, so the pot and the price are
part of the picture rather than something to work out.

## What it is not

Not a real-time assistant. It does not sit beside a live table and tell you what to do with
a hand you are currently holding, which is what every major site bans as RTA. Spots are
generated, you answer them away from a table, and there is no path in it for entering a
hand you are actually in.

## Where the numbers come from

Two different places, and the app says which on every screen, because the difference
matters more than anything else in this repo.

The 100bb charts are **baseline data**: conventional ranges, written to be close to
consensus and internally consistent. Not solver output, and never described as such.

The push/fold charts were **solved here**. Nothing in them was chosen by a person.

Sizes are baseline too, and generated from two rules rather than typed out per spot: opens
are flat in big blinds and larger from the small blind, and a 3-bet is 3x the open in
position or 4x out of it. That is enough to land on the sizes these spots are conventionally
played at, and a rule that reproduces eighty numbers is easier to keep honest than eighty
numbers are. Which side of the opener you are on comes from the postflop seat order, so the
big blind 3-bets *smaller* against a small blind open than against anyone else, because it
is the one spot where the big blind has position.

Pot odds are quoted in exactly one place, the all-in spot, because that is the only one
where they are the whole answer: no later streets, so the price of the call is the price of
the hand. The percentage on that screen is computed from the chips on the table, and it
comes out equal to the (S−1)/2S threshold the solver derived independently from the payoffs.
A test holds the two together at every stack depth.

## The push/fold solver

Below about fifteen big blinds the game collapses to two ranges: the small blind shoves or
folds, the big blind calls or folds. No later streets, no bet sizing. That is small enough
to actually solve on a laptop, and it is the one part of preflop where "here is the answer,
and here is why it is the answer" is a claim you can make honestly.

```
scripts/build-equity-matrix.ts   169x169 all-in equities, 12,000 boards per pair   ~5 min
scripts/solve-pushfold.ts        fictitious play, 600 iterations per stack depth   ~1 min
  -> src/lib/charts/pushfold.generated.ts
```

With an effective stack of S big blinds, the small blind folding is worth −0.5, shoving
through is worth +1.0, and getting called is worth S(2e − 1). So the big blind calls when
S(2e − 1) > −1, needing more than **(S−1)/2S** equity: 45% at ten blinds, 40% at five. The
shorter the stack, the cheaper the call, which is the whole reason short stacks call wide.

**Iterated best response does not converge here**, damped or not. The hands on the boundary
flip between shove and fold on every pass, each side chasing the other, and it circles
forever without settling. Averaging is what fixes it, so this is fictitious play. That is
also why the boundary hands come out as frequencies rather than as a yes or a no: at
equilibrium they genuinely are mixed, and a pure chart is an approximation of the answer
rather than the answer.

**The output is checked by exploitability, not by comparison to a published chart** — that
would only move the question to whether the chart is right. `exploitability()` asks what
either player could gain by abandoning the solution and playing the best response to it. At
a real equilibrium that is zero. For the rounded charts that ship it is under **0.0005 big
blinds per hand** at every depth, and the test recomputes it from the committed matrix
rather than trusting the run that produced the file.

Some of what falls out:

| stack | shove | call | equity the call needs |
| --- | --- | --- | --- |
| 2bb | 90.3% | 100.0% | 25.0% |
| 5bb | 71.3% | 62.3% | 40.0% |
| 10bb | 58.7% | 37.6% | 45.0% |
| 20bb | 40.6% | 21.7% | 47.5% |

Two results worth pointing at, both now pinned by tests because a plausible-looking bug
would move them. **72o is a fold even at two big blinds**, against a big blind calling 100%
of hands, because a third of the pot is worth less than the half blind you save. And
**below five big blinds the big blind calls wider than the small blind shoves**, inverting
the relationship that holds everywhere else: at four blinds it is putting in three to win
five, while the shove risks a whole stack to pick up one blind of dead money.

## The postflop solver

Preflop is not the interesting part of poker, and the trainer is honest that most of its
preflop data was written rather than computed. `src/lib/solver/` is the start of fixing
that from the other end: a **postflop solver**, exact on the river.

Give it a board, two ranges, a pot and a stack, and it returns a strategy with a number
attached saying how far from equilibrium it is. Discounted CFR ([Brown and Sandholm,
2019](https://arxiv.org/pdf/1809.04040)), vector form, over all 1081 combinations rather
than the 169 preflop classes, because on a board of `Ah 7h 2c` the ace of hearts is not
interchangeable with the ace of spades.

**The thing that makes it fast enough to matter.** At every terminal, each of 1081 hands
needs its value against the opponent's whole range, which written the obvious way is 1.2M
operations per node per iteration. It is linear instead. Folds come from one pass of
per-card sums; showdowns come from sorting the hands by rank once, at setup, and sweeping
the order with running totals that carry the blocked hands separately. Card removal is not
a correction bolted on afterwards, it is inside both sweeps, because which hands you block
is a large part of why a river bluff works.

|  | 400 iterations | exploitability |
| --- | --- | --- |
| one bet size, no raises | 113ms | 0.0022% of pot |
| two sizes, one raise | 317ms | 0.0172% of pot |
| three sizes, two raises | 813ms | 0.0295% of pot |

**How it is checked.** By exploitability, again: what either player could gain by
abandoning the solution and playing the best response to it, which is zero at an
equilibrium. And by the [0,1]-style **polarised river game**, whose answer is known on
paper — bet the nuts, bluff so that bluffs are exactly `B/(P+2B)` of the betting range,
call so the bluffer is indifferent. With a pot-sized bet the theory says bluff 25% of the
air, making bluffs a third of all bets, and call half the bluff-catchers. The solver, which
knows none of that, produces 25.0%, 33.3% and 50.0%.

Both linear-time terminal evaluations are also checked against a deliberately slow
quadratic version, on four boards chosen to be awkward: one with a flush live, one where
the board is a royal flush and every hand ties, one that is quads with only a kicker to
separate hands, and one ordinary one.

### Playing a hand against it

The postflop mode is the first surface here where the footer says *solved* instead of
*baseline*, and it is a hand rather than a question. You get cards, you act, the opponent
acts back out of the equilibrium strategy for the hand it is actually holding, a river
comes, you act again, and somebody wins the pot.

**Ten scenarios**, chosen to be different games rather than different cards: a monotone
flop, a turn that completes the flush, a paired board, a broadway board where the preflop
raiser is the one out of position, a low board nobody connected with, an overcard that hits
one range and misses the other, and a short-stacked pot where a bet is the whole stack and
there is no third decision.

**It starts on the turn, and says so.** A flop solve is three betting rounds and two chance
layers -- minutes and gigabytes even for a commercial solver. So how the hand reached the
turn is fixed, and the screen states it rather than inventing a flop strategy.

**The trick that makes the river cheap.** A full turn solve contains the strategy for all
48 rivers, which is megabytes, and exactly one river ever comes. So the turn is precomputed
and shipped (four nodes, kilobytes); as the hand plays out each player's range is
multiplied by the probability they would have taken the action they took, which is plain
Bayes and exact; then the one river that arrives is solved right there in about 200ms from
those narrowed ranges.

**Scoring had to change, and that is the interesting part.** A preflop chart says open or
fold, so an answer is right or wrong. A solved postflop strategy says this hand bets 43% of
the time, checks 47% and bets bigger 10%, and *all three are correct*. Marking two of them
wrong would be teaching a fiction.

So a decision is not graded, it is priced: **how much expected value did that action give
up?** The log shows each decision with its bill next to it -- `free`, or `-0.51` beside the
solver's actual mix. At the end you get the pot *and* the tally, deliberately as separate
lines:

> **You win 40** on a fold. Opponent had 4sAc.
> Gave up 0.51 chips across the hand. *Winning the pot and playing it well are different
> things.*

Winning with a bad line and losing with a good one both happen constantly, and a trainer
that conflated them would be teaching results rather than decisions.

The 13x13 grid is still there but shaded rather than filled: each cell is a bar showing the
actions in the proportions the solver plays them, because painting each cell with its
commonest action would throw away the most interesting thing on the screen.

### The turn, and what abstraction actually buys

The turn is the same engine plus a chance layer: bet, then one of 48 rivers, then bet
again. It solves exactly too — 0.030% of pot on `Ks Jc 9h 7d`, about eight seconds, 21 MB.
Two details had to be right and both are the kind that fail silently. The hand index space
does not change when the river lands (hands holding that card get zero reach and a sentinel
rank, rather than the whole set being renumbered 48 times per chance node). And the chance
weight is **1/44, not 1/48** — the dealer draws from 48 cards but four of them are already
in the two players' hands, and getting that wrong would misprice every decision to see a
card against every decision to fold, while still converging perfectly to the wrong game.

Then the part this was all built for: **what does bucketing hands together cost, and what
does it save?** Every abstracted solve is graded in the full game, with the best response
free to exploit the fact that hands sharing a bucket were forced to play alike.

| | memory | time | exploitability |
| --- | --- | --- | --- |
| exact | 20.9 MB | 10.1s | 0.030% |
| river buckets, K=64 | 1.3 MB | 8.3s | 0.204% |
| river buckets, K=4 | 0.2 MB | 8.4s | 3.418% |

**A hundredfold memory reduction and the clock does not move.** That was not the expected
result. In a vector solver the per-iteration cost is the terminal sweeps and the reach
propagation, both O(hands) regardless of how many buckets the strategy is stored in — the
showdown still has to know which 1128 hands beat which, because card removal is per hand
and always will be. Abstraction saved time in the regime the literature came from, where
CFR samples one history at a time. It does not transfer, which is in retrospect why no
modern postflop solver uses card abstraction at all.

The metric comparison came out with a wrinkle too. Clustering on the whole equity
distribution under earth mover's distance beats bucketing on average equity by 5x to 10x
once there are 32 or more buckets — at K=64 it compresses 317 combos into 64 strategies for
0.04% of pot. Below K=16 the naive scalar wins, because a coarse abstraction's one job is
to get the strength ordering roughly right and an equal-frequency split does that by
construction. And the sorted-distribution clustering reaches a distortion of 0.00005 at
K=128 while being *more* exploitable there than at K=64: **optimising a metric well is not
the same as it being the right metric.**

Full numbers, including why k-means needs restarts before a sweep across K means anything,
are in [docs/postflop-solver.md](docs/postflop-solver.md).

## The equity engine

A seven card evaluator and all-in equity, by exact enumeration or by sampling. It is only
worth building on because it agrees with figures anyone can reproduce:

| | computed | |
| --- | --- | --- |
| AA vs KK | 82.64% | enumerating all 1,712,304 boards |
| AKs vs QQ | 46.21% | |
| AKo vs QQ | 42.84% | |
| AA vs 72o | 87.42% | |
| 22 vs AKs | 49.92% | the classic coin flip |

## Range notation

Charts are stored the way they are published, and a parser expands them to the 169 hand
classes:

```
"22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, AJo+, KQo"
```

`77+` climbs pairs to aces. `A9s+` holds the high card and climbs the kicker, so it means
A9s through AKs. That is the rule Flopzilla, PioSOLVER and GTO+ use, and it makes `T9s+`
mean T9s alone rather than the suited connectors climbing. `AJs-A9s` spans a kicker range.
Anything unparseable throws, because a typo that silently produced a smaller range would
surface only as the trainer marking correct answers wrong.

`formatRange` is the inverse, and the round trip is a test. It is how the solver's 169 flags
come back out as `22+, A2s+, K3s+` like every other chart in the project.

## Correctness

`npm test` runs 467 cases. The ones doing real work:

- **Always giving one answer scores that action's frequency.** Answer "raise" to every hand
  and your accuracy in a spot has to converge on how often that spot's chart says to raise.
  Checked across all three modes and every one of the 50 hand-authored ranges. This is what
  catches a mode wired to the wrong chart, and almost nothing else would, because every
  individual hand still looks plausible.
- **Dealing is combinations, not classes.** Picking uniformly from the 169 classes would
  make pairs 7.7% of hands instead of 5.9%, teaching a distorted sense of how often spots
  come up. The deal draws real cards and the test asserts the resulting pair rate.
- **The published push/fold charts are unexploitable**, recomputed from the matrix.
- **The price on the screen is the price the solver solved against.** The pot odds shown
  next to the call button come from the chips on the table; the solver's calling threshold
  comes from the payoff algebra. Same number, two derivations, checked against each other at
  every one of the nineteen depths.
- **A turn where neither player may bet is worth exactly nothing**, to twelve decimal
  places. It is the cheapest possible check on the chance node: the wrong weight, the wrong
  hands masked, or the dead hands not subtracted back out would all still converge, just to
  a different game.
- **The postflop seat order is a rearrangement of the preflop one**, not a second list of
  seats. A seat missing from it would come back as index −1, which compares as "acts first"
  and would quietly make that seat out of position against the entire table.
- **3-bet and call ranges never overlap** in any of the fifteen defending spots. They are
  written disjoint rather than resolved by precedence, so an accidental overlap is a
  failure instead of a silent win for whichever range was consulted first.
- **Opening ranges nest and widen correctly**: within a depth, every UTG open is also a
  button open; within a seat, opening frequency rises with stack depth.
- **The river solver reproduces a game whose answer is known on paper**, and both of its
  linear-time terminal evaluations agree with a quadratic reference on four awkward boards,
  including one where the board is a royal flush and every hand ties.

`npm run check:classes` fails the build when a Tailwind class used in `src/` produced no
CSS. A misspelled utility is not an error anywhere else in the pipeline, it just silently
does not style anything.

## Layout

```
src/lib/cards.ts        169 hand classes, the 13x13 grid, dealing
src/lib/range.ts        the notation parser and its inverse
src/lib/equity.ts       seven card evaluator, exact and sampled equity
src/lib/combos.ts       the 1326 combinations, and blocker bookkeeping
src/lib/pushfold.ts     the game model, fictitious play, exploitability
src/lib/charts/         range data; pushfold.generated.ts is solver output
src/lib/drill.ts        spot generation and scoring
src/lib/sizing.ts       open and 3-bet sizes, from two rules
src/lib/table.ts        who is sitting where, what they put in, what it costs
src/lib/solver/         the postflop solver: tree, terminals, discounted CFR,
                        chance nodes for the turn, and card abstraction
src/lib/postflop/       the scenarios, and a hand being played through one
```

## Running it

```
npm install
npm run dev
```

`npm test` runs the suite, `npm run typecheck` the compiler. Regenerating the solved charts
needs the two scripts above, in order; both are seeded, so a rebuild reproduces them byte
for byte.

## Stack

Vite 6, React 18, TypeScript, Tailwind 3, Vitest. No backend and no accounts: progress
lives in localStorage, so opening the link puts you straight into the product.
