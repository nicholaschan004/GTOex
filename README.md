# GTOex

A preflop poker trainer. It deals you a spot, you choose fold or raise, and it scores your
answer against a reference range, then shows you the whole range so you learn the shape
rather than the single hand.

> **In progress.** Opening ranges at 100bb work end to end. Facing a raise, other stack
> depths, and the solver that is meant to replace the chart data are not built yet.

## What it is not

Not a real-time assistant. It does not sit beside a live table and tell you what to do
with a hand you are currently holding, which is what every major site bans as RTA. Spots
are generated, you answer them away from a table, and there is no path in it for entering
a hand you are actually in.

## Where the numbers come from

Right now, from `src/lib/charts/rfi.ts`: conventional six handed 100bb opening ranges,
written to be close to consensus and internally consistent. **They are not solver output
and the app says so on every screen.**

The tests are what keep them honest. Each range has to open within the percentage band its
seat is known to open, and the ranges have to nest, so every hand you open under the gun
must also be an open on the button. A dropped or doubled token fails the suite rather than
quietly changing the strategy:

```
UTG   43 classes  17.3%
HJ    48 classes  20.1%
CO    65 classes  27.0%
BTN   92 classes  44.2%
SB    88 classes  41.2%
```

Replacing these with computed ranges is the point of the project. Preflop push/fold below
roughly 15 big blinds is exactly solvable on a laptop, and published Nash charts exist to
check the output against, so those will be generated here rather than transcribed.

## Range notation

Charts are stored the way they are published, and a parser expands them to the 169 hand
classes:

```
"22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, AJo+, KQo"
```

`77+` climbs pairs to aces. `A9s+` holds the high card and climbs the kicker, so it means
A9s through AKs. That is the rule Flopzilla, PioSOLVER and GTO+ use, and it means `T9s+` is
T9s alone rather than the suited connectors climbing. `AJs-A9s` spans a kicker range.
Anything unparseable throws, because a typo that silently produced a smaller range would
show up only as the trainer marking correct answers wrong.

## Correctness

`npm test` covers 78 cases. The two worth knowing about:

- **Dealing is combinations, not classes.** Picking uniformly from the 169 classes would
  make pairs 7.7% of hands instead of 5.9%, so the trainer would teach you a distorted
  sense of how often spots come up. The deal draws real cards and the test asserts the
  resulting pair rate.
- **Always raising scores the opening frequency.** Over 200,000 generated spots, answering
  "raise" every time lands within half a point of each seat's charted percentage. If the
  deal, the chart lookup and the scoring ever disagree, that test catches it, and nothing
  else would, because every individual hand still looks plausible.

`npm run check:classes` fails the build if a Tailwind class used in `src/` produced no CSS.
A misspelled utility is not an error anywhere in the normal pipeline, it just silently does
not style anything.

## Running it

```
npm install
npm run dev
```

`npm test` runs the suite, `npm run typecheck` the compiler.

## Stack

Vite 6, React 18, TypeScript, Tailwind 3, Vitest. No backend and no accounts: progress
lives in localStorage, so opening the link puts you straight into the product.
