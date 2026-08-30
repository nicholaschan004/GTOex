<div align="center">

# GTOex

*A preflop poker trainer that computes its own answers*

</div>

Deals you a spot, you pick an action, it scores you against a reference range and then
shows you the whole range, so you learn the shape rather than the single hand.

Three modes: **opening** (five seats, four stack depths), **facing a raise** (all fifteen
opener/defender pairs, 3-bet or call or fold), and **push/fold** (heads up, 2bb to 20bb).

## What it is not

Not a real-time assistant. It does not sit beside a live table and tell you what to do with
a hand you are currently holding, which is what every major site bans as RTA. Spots are
generated, you answer them away from a table, and there is no path in it for entering a
hand you are actually in.

## Where the numbers come from

Two different places, and the app says which on every screen, because the difference
matters more than anything else in this repo.

**The 100bb charts are baseline data.** Conventional ranges, written to be close to
consensus and internally consistent. Not solver output, and never described as such.

**The push/fold charts were solved here.** Nothing in them was chosen by a person.

## The solver

Below about fifteen big blinds the game collapses to two ranges: the small blind shoves or
folds, the big blind calls or folds. No later streets, no bet sizing. That is small enough
to actually solve, and it is the one part of preflop where "here is the answer, and here is
why it is the answer" is a claim you can make honestly.

```
scripts/build-equity-matrix.ts   169x169 all-in equities, 12,000 boards per pair   ~5 min
scripts/solve-pushfold.ts        fictitious play, 600 iterations per stack depth   ~1 min
  -> src/lib/charts/pushfold.generated.ts
```

The payoffs, with an effective stack of S big blinds:

| | |
| --- | --- |
| small blind folds | −0.5 |
| shoves, big blind folds | +1.0 |
| shoves and is called | S(2e − 1) |

So the big blind calls when S(2e − 1) > −1, which needs more than (S−1)/2S equity: 45% at
ten blinds, 40% at five. The shorter the stack, the cheaper the call, which is the whole
reason short stacks call so wide.

**Iterated best response does not work here.** The hands on the boundary flip between shove
and fold on every pass, each side chasing the other, and it circles forever without
settling. Damping does not fix it. Averaging does, which is why this is fictitious play,
and it is also why the boundary hands come out as frequencies rather than as a yes or a no:
at equilibrium they genuinely are mixed.

**How the output is checked.** Not against a chart published somewhere else, which would
only move the question. `exploitability()` asks what either player could gain by abandoning
the solution and playing the best response to it. At a real equilibrium that is zero. For
the rounded charts that actually ship it comes out under **0.0005 big blinds per hand** at
every depth, and the test suite recomputes it from the committed matrix rather than
trusting the run that produced it.

Some of what falls out:

```
stack   shove%   call%   equity the call needs
   2bb    90.3   100.0    25.0
   5bb    71.3    62.3    40.0
  10bb    58.7    37.6    45.0
  20bb    40.6    21.7    47.5
```

Two results worth pointing at. **72o is a fold even at two big blinds** against a big blind
calling 100% of hands, because a third of the pot is worth less than the half blind you
save. And **below five big blinds the big blind calls wider than the small blind shoves**,
which inverts everywhere else: at four blinds it is putting in three to win five, while the
shove is risking a whole stack to pick up one blind of dead money.

## The equity engine

A seven card evaluator and all-in equity, by exact enumeration or by sampling. It is only
worth building on because it agrees with figures anyone can check:

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
show up only as the trainer marking correct answers wrong.

`formatRange` is the inverse, and the round trip is a test. It is how the solver's 169 flags
come back out as `22+, A2s+, K3s+` like every other chart in the project.

## Correctness

`npm test` runs 298 cases. The ones doing real work:

- **Always giving one answer scores that action's frequency.** Answer "raise" to every hand
  and your accuracy in a spot has to converge on how often that spot's chart says to raise.
  Checked across all three modes and every one of the 50 hand-authored ranges. This is the
  test that catches a mode wired to the wrong chart, and almost nothing else would, because
  every individual hand still looks plausible.
- **Dealing is combinations, not classes.** Picking uniformly from the 169 classes would
  make pairs 7.7% of hands instead of 5.9%, teaching a distorted sense of how often spots
  come up. The deal draws real cards and the test asserts the resulting pair rate.
- **The published push/fold charts are unexploitable**, recomputed from the matrix.
- **3-bet and call ranges never overlap** in any of the fifteen defending spots. They are
  written disjoint rather than resolved by precedence, so an accidental overlap is a
  failure instead of a silent win for whichever range was consulted first.
- **Opening ranges nest and widen correctly**: within a depth, every UTG open is also a
  button open; within a seat, opening frequency rises with stack depth.

`npm run check:classes` fails the build when a Tailwind class used in `src/` produced no
CSS. A misspelled utility is not an error anywhere else in the pipeline, it just silently
does not style anything.

## Running it

```
npm install
npm run dev
```

`npm test` runs the suite, `npm run typecheck` the compiler. Regenerating the solved charts
needs the two scripts above, in order; both are seeded, so a rebuild reproduces them.

## Stack

Vite 6, React 18, TypeScript, Tailwind 3, Vitest. No backend and no accounts: progress
lives in localStorage, so opening the link puts you straight into the product.
