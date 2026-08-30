# GTOex

A preflop poker trainer. It deals you a spot, you choose fold, call or raise, and it
scores your answer against a reference range and shows you the whole range so you learn
the shape rather than the single hand.

> **In progress.** This is the scaffold. The range parser, the chart data and the drill
> loop are not built yet, and nothing here is worth using until they are.

## What it is not

It is not a real-time assistant. It does not sit beside a live table and tell you what to
do with a hand you are currently holding, which is what every major site bans as RTA. The
spots it deals are generated, you answer them away from a table, and there is no path in
it for entering a hand you are actually in.

## Planned shape

| Piece | Status |
| --- | --- |
| Range notation parser (`77+, A9s+, KTs+` to 169 hand classes) | not started |
| 13x13 range grid | not started |
| RFI charts, six seats | not started |
| Drill loop and scoring | not started |
| Progress tracking in localStorage | not started |
| Hand evaluator and Monte Carlo equity | not started |
| Push/fold solver (fictitious play) | not started |

The last two are the point of the project. Preflop push/fold below roughly 15 big blinds
is exactly solvable on a laptop, and published Nash charts exist to check the output
against, so those ranges will be computed here rather than transcribed from anywhere.

## Running it

```
npm install
npm run dev
```

`npm test` runs the unit tests, `npm run typecheck` the compiler.

## Stack

Vite 6, React 18, TypeScript, Tailwind 3, Vitest. No backend and no accounts: progress
lives in localStorage, so opening the deployed link puts you straight into the product.
