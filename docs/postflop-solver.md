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
iterations, and the point of building it is **not** that it is the shipping solver. It is
the ground truth Phase T2 gets measured against.

Two things had to be got right that a river-only solver never faces.

**The hand set changes and the index space must not.** A turn board leaves 1128 hands, a
river board 1081. The natural move is to rebuild the hand set per river, which means
translating every reach vector through a different mapping 48 times per chance node. Every
hand instead keeps its turn index for the whole solve; when a river lands, the hands
holding that card are not renumbered, they are given a reach of zero and a rank of −1 so
they sort into one dead group at the bottom, contribute to no running sum, and are
subtracted back out at the chance node. The cost is 47 dead entries per river. The saving
is that one index means one thing everywhere.

**The chance weight is not one over forty eight.** The dealer draws from 48 cards, but four
of them are already in the two players' hands, so conditional on any pair of hands that can
coexist there are 44 rivers. It is the same 44 for every such pair, which is what lets the
chance node use one constant. Using the dealer's count would misprice every decision to see
a card against every decision to fold now, and it would do it quietly, because the solve
would still converge — to the wrong game.

Built. On `Ks Jc 9h 7d`, one bet size a street, 1128 hands, 580 decision nodes: **0.030% of
pot in about eight seconds and 21 MB**. The degenerate version where neither player may bet
comes out at 3.6e-15 chips per hand, which is the arithmetic check that matters most —
anything else there would mean the chance node was masking the wrong hands or weighting
them wrongly.

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

#### What the measurement said

`scripts/bench-turn.ts`, on a real spot rather than two uniform ranges: the button opens,
the big blind calls, the turn is `Ks Jc 9h 7d`. 317 combos out of position against 482 in
position. Every abstracted solve is graded in the **full** game — its strategy expanded back
over every hand, best response computed with no abstraction at all — so the number includes
whatever the abstraction gave away.

**Bucketing buys memory, not time.** This is the headline and it was not the expectation.

| | memory | time | exploitability |
| --- | --- | --- | --- |
| exact | 20.9 MB | 10.1s | 0.030% |
| river buckets, K=64 | 1.3 MB | 8.3s | 0.204% |
| river buckets, K=16 | 0.4 MB | 7.8s | 0.553% |
| river buckets, K=4 | 0.2 MB | 8.4s | 3.418% |

A hundredfold memory reduction, and the clock does not move. The baseline was measured
again at the end of the run (11.2s) so that every figure above sits between two readings of
the same thing; the spread is drift, not signal.

The reason is structural. In a **vector** solver the per-iteration cost is the terminal
sweeps and the reach propagation, and both are O(hands) no matter how many buckets the
strategy is stored in — the showdown still has to know which 1128 hands beat which, because
card removal is per hand and always will be. What shrinks is the regret table. Abstraction
saved *time* in the regime the literature came from, where CFR samples one history at a
time and a smaller abstraction means fewer infosets to visit. It does not transfer.

Which is, in retrospect, why no modern postflop solver uses card abstraction at all.

**The distribution metric beats the scalar, but only once there are enough buckets.**
Exploitability, turn bucketing, same iteration count throughout:

| K | mean equity | sorted, EMD | river profile |
| --- | --- | --- | --- |
| 4 | **2.07%** | 6.26% | 2.04% |
| 8 | 1.57% | 1.80% | **1.44%** |
| 16 | 1.02% | 1.42% | **0.79%** |
| 32 | 0.81% | **0.21%** | 0.22% |
| 64 | 0.43% | **0.04%** | 0.19% |
| 128 | 0.19% | 0.29% | **0.13%** |

At K=64 the sorted-distribution clustering is within noise of the exact solve: 317 combos
compressed to 64 strategies for 0.04% of pot. But below K=32 the naive scalar wins, and
wins clearly at K=4. A coarse abstraction has one job, to get the strength ordering roughly
right, and a scalar sorted into equal groups does that by construction while k-means spends
its four clusters on distribution shape.

**Low distortion is not accuracy.** The sorted-distribution clustering reaches a distortion
of 0.00005 at K=128 — essentially perfect in its own metric — and is *more* exploitable
there than at K=64. A metric being well optimised says nothing about whether it was the
right metric.

**Cluster balance matters more than it looks.** k-means minimises distortion and is
indifferent to lopsidedness, so it leaves one large cluster and splits hairs elsewhere. At
K=16 its largest bucket holds 39 hands against the equal-frequency split's 20. The biggest
bucket is where the most hands are being forced to play alike, which is where the
exploitability comes from.

**Restarts were not optional.** Single-shot k-means produced results non-monotone in K —
sixteen buckets beating thirty two — which is a fact about seeding, not about abstraction.
Five restarts keeping the tightest fit removed it. Individual cells in the table above still
carry seeding noise; the trend is what to read, not any one number.

#### On the claim that the river must not be bucketed

The design above asserted it. Measured, it is real but smaller than the assertion implied:
river bucketing at K=64 costs 0.17 points of exploitability (0.030% to 0.204%) for a 16x
memory reduction, which is a trade many people would take. `blockerSpread` reports how much
hands sharing a bucket disagree about how much opponent range they block — about 2.3% at
K=64, falling as buckets get finer.

Worth recording separately: against **uniform** ranges that number is exactly zero, because
every hand then blocks exactly the same weight. Measuring abstraction against uniform ranges
flatters it, and the first version of this benchmark did exactly that.

## The other two approximations, which are easy to forget

Card abstraction is the one that gets talked about, and it is usually not the biggest error.

**Action abstraction.** A real player can bet any amount; a solver is given a list. Every
size left out is strategy the solver cannot find. At reasonable bucket counts this is
typically the *larger* of the two errors, so the bet sizes need to be a stated,
configurable part of the game, not a constant buried in the tree builder.

**Depth limiting.** Instead of solving all 48 rivers under every turn iteration, stop at
the river and substitute an estimated value. After the T2 measurement this is no longer the
escape hatch, it is the main road: it is the only one of the three that touches the term
that actually dominates the clock. Done naively this is unsound: a fixed estimate
assumes the opponent plays a fixed way, and the opponent does not have to. [Brown, Sandholm
and Amos, *Depth-Limited Solving for Imperfect-Information Games*, NeurIPS
2018](https://arxiv.org/pdf/1805.08195) fix that by letting the opponent *choose* among
several continuation strategies at the depth limit, which forces the solution to be robust
to all of them. That paper's agent, Modicum, beat two prior top agents on a 4-core CPU,
against DeepStack's million-plus core hours.

It is deliberately scheduled after the exact version, because it is another approximation
and it needs the same treatment bucketing got: measured, not assumed.

### Phase F: the flop, and what the whole hand costs

The trainer plays hands from preflop to river, so the flop had to be solved. This section
is what that cost, and the numbers are not the ones the plan above expected.

#### A cheap depth limit is not cheap, it is wrong

The obvious way to make a flop affordable is to stop at the river and value it as a
checkdown: deal the card, show the hands down, no betting. It is exactly computable here,
it costs almost nothing, and it is **unusable**. Measured on the turn, where the exact
answer is available to compare against:

| turn strategy from | exploitability, graded in the real game |
| --- | --- |
| the exact solve | 0.017% of pot |
| a solve whose river always checks down | **7.126% of pot** |

Four hundred times worse. A strategy built against an opponent who can never bet the river
is not a slightly blunter strategy, it is a strategy for a different game — and note that
the depth-limited solve reported **0.003%** against *its own* game, which is what makes
this the dangerous kind of wrong. It converged beautifully to the wrong thing. This is the
concrete version of the warning above about fixed leaf estimates, and it is why the flop
solve below plays all three streets out.

#### Compaction: the free 2x

Every loop in the solver runs over all 1,128 hands on a turn board, but a button-versus-big
blind spot has 317 combos against 482, and their union is 491. A hand neither player can
hold contributes zero to every reach sum, every card-removal sum and every showdown sweep.
Dropping them is not an approximation, and the measurement says so exactly: same tree, same
iterations, exploitability identical to three decimals (0.566% and 0.130% at 30 and 60
iterations) at **1.9x the speed**. `compactToLive`, and the flop solve depends on it — 1,176
hands on a three card board come down to 520.

#### What a flop solve is

Three betting rounds and two chance layers: the flop, all 49 turns, all 48 rivers under
each. That instantiates the river betting round **21,168 times**, which is 84,672 of the
tree's 85,264 decision nodes. Everything about the cost follows from that one number.

At full resolution the regret tables alone are about 2 GB, so the river is bucketed — by
each hand's equity against the opponent's range on that exact river, sorted into equal
frequency groups, which is cheap and keeps blockers in a way a bucketing on raw hand rank
would not. Graded in the full game, with the best response free to punish whatever the
bucketing gave away:

| river buckets | iterations | solve | exploitability |
| --- | --- | --- | --- |
| 16 | 40 | 3.1m | 2.595% |
| 16 | 80 | 6.0m | 1.502% |
| 16 | 160 | 11.4m | 1.284% |
| 32 | 160 | 12.9m | 0.847% |
| 64 | 160 | 10.8m | 0.582% |
| 128 | 160 | 14.5m | **0.393%** |

**The abstraction is the binding constraint, not the iteration count.** Quadrupling
iterations at K=16 bought 1.3 points. Doubling the buckets bought 0.44, then 0.27, then
0.19, and the clock barely moved across the whole column -- which is the Phase T2 finding
again, from a game fifty times larger: bucketing buys memory, not time. Anyone reading the
first two rows alone would have concluded the solver needed to run longer, and would have
been wrong.

K=128 is what ships. Across the six scenarios that lands between 0.257% and 0.409% of pot,
the sweep above being the worst of them. That clears the 0.5% bar the river and turn solves
are held to, which was not a given for a three street game, and the trainer prints the
number on screen rather than asking to be trusted. At 128 buckets and ~250 live combos a
side, the river groups hold two or three hands each, so what is left is close to the
iteration floor rather than the abstraction.

#### Where the turn and the river actually come from

Not from this solve. After two players act on the flop the ranges are whatever those
actions imply, and there is no precomputing that, so the turn and the river are solved in
the browser when they arrive, from the narrowed ranges, in a Web Worker.

That is not a downgrade, and it is worth being clear about why, because it looks like one:
those solves see the **real** ranges rather than the flop's starting ones, and they carry
**no bucketing**, because the memory pressure that forced the river into buckets came from
holding 21,168 river subgames at once and there is only ever one of these. The flop solve's
job is the flop strategy. It models the turn and river in order to get that right, and then
those models are thrown away in favour of solving the real thing.

## Order of work

1. ~~**Phase R** — river subgame: tree, `O(n)` terminals, discounted CFR, exploitability.~~
   **Done.** `src/lib/solver/`. Checked against the textbook polarised game, whose
   equilibrium is known on paper, and against a quadratic reference implementation of both
   terminal evaluations.
2. ~~**Phase T1** — turn with all 48 rivers solved.~~ **Done.** `src/lib/solver/turn.ts`
   plus a chance layer in the tree and the CFR engine. 0.030% of pot, 8s, 21 MB.
3. ~~**Phase T2** — turn with clustered hands, measured against T1 across K.~~ **Done.**
   `src/lib/solver/abstraction.ts`, swept by `scripts/bench-turn.ts`. The answer was not
   the expected one: abstraction buys memory and not time, for the structural reason above.
4. ~~**Phase D** — depth-limited solving.~~ **Measured, and rejected in its cheap form.**
   A checkdown leaf makes a turn strategy 7.126% of pot exploitable against 0.017% exact,
   while reporting 0.003% against its own game. The flop solve plays all three streets out
   instead and pays for it with river bucketing, which is the approximation that can be
   graded. Multiple opponent continuations at the leaf (Brown, Sandholm and Amos) remain
   the principled version and are still unbuilt.
5. ~~**Phase F** — the flop, and a hand playable from preflop to river.~~ **Done.**
   `src/lib/postflop/`. 85,264 decision nodes, 0.257% to 0.409% of pot at K=128, about 15
   minutes a scenario; the turn and river are re-solved live from the ranges the play
   produced, in a Web Worker, at 0.177% and 0.070%.
6. **Phase A** — sweep the betting abstraction the same way the card abstraction was swept.
   The tree already takes sizes as configuration, and the literature's claim that action
   abstraction is the larger error is now the one unmeasured assertion left in this
   document. It matters more since Phase F: the full-hand solve runs one bet size and no
   raises per street, which is the tightest action abstraction anything here uses.

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
