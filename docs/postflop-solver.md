# Postflop: solving the turn and the river

The preflop side of this project is honest about which of its numbers were computed and
which were written down. Push/fold was solved; everything else is baseline data waiting to
be replaced. This document is the plan for replacing some of it.

The target is a **turn and river solver**: give it a board, two ranges, a pot and a stack,
and get back a strategy that is measurably close to a Nash equilibrium of that subgame.

## Why postflop is a different problem to preflop

Push/fold worked because the game collapsed. Two ranges, no streets, no sizing, 169 hand
classes a side. Postflop does none of that:

|  | push/fold | river | turn |
| --- | --- | --- | --- |
| hands per player | 169 classes | 1081 combos | 1128 combos |
| suits matter | no | **yes** | **yes** |
| bet sizes | one (all in) | several | several |
| future cards | none | none | 48 rivers, each its own subgame |

Two of those rows are the whole difficulty.

**Suits stop being interchangeable.** Preflop, AhKh and AsKs are the same hand. On a board
of `Ah 7h 2c`, they are not remotely the same hand. So the unit of strategy becomes the
combination, not the class, and there are 1081 of them on a five card board (`C(47,2)`).

**Card removal becomes load-bearing.** If you hold the ace of hearts, every one of your
opponent's hands containing it is impossible. On the river that is not a rounding error, it
is a large part of why a bluff works: the hands you want to be holding when you bluff are
exactly the ones that block the hands that could call. Any algorithm here has to keep track
of that, and any *abstraction* here risks throwing it away. Hold that thought, because it
decides where bucketing is allowed to happen.

## The plan, in three phases

### Phase R: the river, exactly

**No abstraction at all.** A river subgame is small enough to solve over every one of the
1081 hands, and abstracting it would only lose blockers for nothing in return.

The algorithm is vector-form CFR with discounting, which is what every modern solver uses:

- **CFR** (counterfactual regret minimisation) converges to a Nash equilibrium of a
  two-player zero-sum game by having each player accumulate regret for actions not taken
  and play in proportion to positive regret.
- **CFR+** ([Tammelin
  2014](https://arxiv.org/abs/1407.5042)) clamps accumulated regret at zero and is
  roughly an order of magnitude faster. It is what solved heads-up limit hold'em.
- **Discounted CFR** ([Brown and Sandholm
  2019](https://arxiv.org/pdf/1809.04040)) discounts early regret instead of clamping it,
  and beats CFR+ on poker. That is what this will use, with the paper's α=1.5, β=0, γ=2.

"Vector form" is the part that makes it fast. Rather than walking the tree once per hand,
each traversal carries a **vector of 1081 reach probabilities** and updates every hand's
regret at once. The tree is walked tens of times, not tens of thousands.

#### The one algorithm that decides whether this is fast or slow

At a terminal node you need, for every one of the hero's 1081 hands, its value against the
opponent's whole reach-weighted range. Written naively that is 1081 × 1081 ≈ 1.2M operations
per terminal node per iteration, and the solver is unusable.

It is `O(n)` instead, in both flavours of terminal.

**Folds.** The hero wins the pot against every opponent hand except the ones its own two
cards make impossible. Precompute `total`, the sum of opponent reach, and `perCard[c]`, the
sum of opponent reach over hands containing card `c`. Then for a hero hand holding `a` and
`b`:

```
live(a,b) = total - perCard[a] - perCard[b] + reach[{a,b}]
```

The final term adds back the hand `{a,b}` itself, which both card sums removed.

**Showdowns.** Hand ranks are a total order, so sort the hands by rank once — the board does
not change during a solve, so this is done at setup, not per iteration — and sweep. Going up
the order, maintain the running sum of reach over everything strictly weaker, plus the same
per-card running sums; each hero hand then reads off how much weaker range it beats, minus
the blocked part. A second sweep downward gives the part that beats it. Ties net to zero.
This is the trick from [Johanson et al., *Accelerating Best Response Calculation in Large
Extensive Games*, IJCAI 2011](http://johanson.ca/publications/poker/2011-ijcai-abr/2011-ijcai-abr.html),
and it is the difference between a solver that runs in a browser tab and one that does not.

#### Payoffs

One formula covers both terminal kinds. With `deadPot` the money already in the middle
before this subgame started, and each player's own contribution counted separately, the
payoff to the winner of a terminal is:

```
deadPot / 2 + (loser's contribution)
```

At a showdown both contributions are equal, so that is half the final pot, and a tie is
zero. At a fold it is the dead money plus whatever the folder had put in. Shifting both
players by `deadPot / 2` is what makes the subgame zero-sum, and a constant shift cannot
move an equilibrium.

#### How it gets checked

The same way push/fold does: **exploitability**, not comparison against a published
solution. Compute each player's best response to the other's average strategy, using the
same tree and the same `O(n)` terminal evaluation, and report what the pair leaves on the
table as a percentage of the pot. At an equilibrium that is zero. Under 0.5% of pot is the
threshold commercial solvers advertise and is the bar to hold this to.

That number is self-contained, which is the point. It never asks whether some other
program's answer was right.

#### Where it landed

Built, and measured by `scripts/bench-river.ts` on a laptop. Both ranges wide, so all 1081
hands a side carry weight — a real spot has narrower ranges and is faster.

| tree | decision nodes | 400 iterations | exploitability |
| --- | --- | --- | --- |
| one bet size, no raises | 4 | 113ms | 0.0022% of pot |
| two sizes, one raise | 10 | 317ms | 0.0172% of pot |
| three sizes, two raises | 24 | 813ms | 0.0295% of pot |

The bar was under 0.5% of pot. The middle tree passes it in 50 iterations and 41ms; the
widest tree passes it in about 75. Board texture barely moves either number, which is what
you would hope for from an algorithm whose cost is the tree and the hand count rather than
what the hands happen to be.

Worth stating plainly: this is exact **within its betting abstraction**. The 0.03% is the
distance to equilibrium of the game that was actually solved, and that game is one where
the only legal bets are the three sizes it was handed. Which sizes those are is the other
approximation, and the one below.

### Phase T1: the turn, exactly

Same engine plus a chance layer. A turn subgame is a turn betting round, then one of 48
river cards, then a river subgame for each. So each iteration costs roughly 48 river
iterations, which is minutes rather than seconds, but it is still exact within its betting
abstraction.

The point of building this is **not** that it is the shipping solver. The point is that it
is the ground truth Phase T2 gets measured against.

### Phase T2: the turn, approximately

This is where bucketing earns its keep, and where the interesting engineering is.

#### What the literature says to bucket on

The obvious metric is expected hand strength, and it is the wrong one. E[HS] collapses hands
that play completely differently: a middling made hand and a big draw can have identical
average equity, and identical average equity is not the same as an identical decision.

The progression in the research is a progression away from scalars:

- **E[HS²]** squares before averaging, which weights the upper tail and so pulls draws away
  from mediocre made hands. Better. Still one number.
- **OCHS** (opponent cluster hand strength) scores a hand against each of several clusters
  of opponent holdings instead of against a random hand, giving a vector. A hand's value
  depends on *which* hands the opponent has, and a scalar cannot express that.
- **Potential-aware abstraction with earth mover's distance** ([Ganzfried and Sandholm,
  AAAI 2014](https://ojs.aaai.org/index.php/AAAI/article/view/8816)) drops scalars
  entirely: bucket a hand by the *distribution* of what it will become, and cluster those
  distributions under earth mover's distance. This is the state of the art and it is what
  the strong agents of the era used on early streets.

#### What this project should bucket on, and why it is easier here

The papers above solve a harder problem than this one. They abstract the *whole game* ahead
of time, for every board that might come, against unknown ranges. Here the board is known
and both ranges are given. That makes the right feature exact and cheap:

> For each turn hand, its equity against the opponent's actual range on each of the 48
> possible rivers.

A 48-dimensional vector, computed exactly, no sampling. Two hands with the same vector are
the same hand for this decision on this board against this opponent — which is a far
stronger guarantee than "these have similar generic strength". Cluster those vectors with
k-means, using earth mover's distance on the sorted distribution, per the 2014 result.

#### Where bucketing is not allowed

**The river stays unbucketed.** Sharing a strategy between two hands means sharing their
blockers, and blockers are most of what decides river bluffs. Buckets on the turn, full
combos on the river.

#### The measurement is the deliverable

Anyone can write "we bucket to approximate". The part worth building is the number:

> Bucketing to K clusters costs X% of pot in exploitability and runs Y times faster.

Swept across K, that is a curve, and the curve is the answer to "how much does the
approximation cost". Phase T1 exists to make it measurable.

## The other two approximations, which are easy to forget

Card abstraction is the one that gets talked about, and it is usually not the biggest error.

**Action abstraction.** A real player can bet any amount; a solver is given a list. Every
size left out is strategy the solver cannot find. At reasonable bucket counts this is
typically the *larger* of the two errors, so the bet sizes need to be a stated,
configurable part of the game, not a constant buried in the tree builder.

**Depth limiting.** Instead of solving all 48 rivers under every turn iteration, stop at
the river and substitute an estimated value. Done naively this is unsound: a fixed estimate
assumes the opponent plays a fixed way, and the opponent does not have to. [Brown, Sandholm
and Amos, *Depth-Limited Solving for Imperfect-Information Games*, NeurIPS
2018](https://arxiv.org/pdf/1805.08195) fix that by letting the opponent *choose* among
several continuation strategies at the depth limit, which forces the solution to be robust
to all of them. That paper's agent, Modicum, beat two prior top agents on a 4-core CPU,
against DeepStack's million-plus core hours.

That is the escape hatch if the full turn solve is too slow to ship. It is deliberately
scheduled after the exact version, because it is another approximation and it needs the
same treatment as bucketing: measured, not assumed.

## Order of work

1. ~~**Phase R** — river subgame: tree, `O(n)` terminals, discounted CFR, exploitability.~~
   **Done.** `src/lib/solver/`. Checked against the textbook polarised game, whose
   equilibrium is known on paper, and against a quadratic reference implementation of both
   terminal evaluations.
2. **Phase T1** — turn with all 48 rivers solved. Slow, exact, the yardstick. Reuses the
   whole of Phase R and adds one chance layer: a call on the turn leads to a river card
   rather than straight to a showdown, which is why the tree builder computes the payoff at
   that point instead of assuming the street is over.
3. **Phase T2** — turn with clustered hands. Measured against T1 across K.
4. **Phase D** — depth-limited turn with multiple opponent continuations, if T1 and T2 are
   both too slow for the browser.

Nothing here goes near the trainer's user-facing surfaces until it can state its own
exploitability, for the same reason the preflop charts say on every screen which of them
were solved.

## References

- Tammelin, *Solving Large Imperfect Information Games Using CFR+*, 2014 —
  <https://arxiv.org/abs/1407.5042>
- Brown and Sandholm, *Solving Imperfect-Information Games via Discounted Regret
  Minimization*, AAAI 2019 — <https://arxiv.org/pdf/1809.04040>
- Johanson, Waugh, Bowling and Zinkevich, *Accelerating Best Response Calculation in Large
  Extensive Games*, IJCAI 2011 —
  <http://johanson.ca/publications/poker/2011-ijcai-abr/2011-ijcai-abr.html>
- Ganzfried and Sandholm, *Potential-Aware Imperfect-Recall Abstraction with Earth Mover's
  Distance in Imperfect-Information Games*, AAAI 2014 —
  <https://ojs.aaai.org/index.php/AAAI/article/view/8816>
- Brown, Sandholm and Amos, *Depth-Limited Solving for Imperfect-Information Games*,
  NeurIPS 2018 — <https://arxiv.org/pdf/1805.08195>
