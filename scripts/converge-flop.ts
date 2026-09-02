/**
 * How solved does a flop solve get, and how many iterations does it take?
 *
 *     node --max-old-space-size=8192 ./node_modules/.bin/vite-node scripts/converge-flop.ts
 *
 * Two questions, and the shipping settings come out of the answers:
 *
 *   1. Iterations. A river subgame needs about 50 and a turn about 120. Three
 *      streets is a bigger game and there is no reason to assume it is the same
 *      number, so it gets measured rather than guessed.
 *
 *   2. River buckets. `docs/postflop-solver.md` measured this on a TURN solve,
 *      where the unbucketed answer is affordable to compare against. Here it is
 *      not -- the regret tables would be gigabytes -- so what can be measured is
 *      whether the answer stops moving as the buckets get finer. If K=32 and
 *      K=16 agree, the abstraction is not what is limiting the result.
 *
 * Exploitability is always computed in the FULL game: the strategy is expanded
 * back over every hand and the best response is free to exploit the fact that
 * hands sharing a bucket were made to play alike.
 */

import { measureExploitability, solve } from "../src/lib/solver/cfr";
import { SCENARIOS, buildFlopGame } from "../src/lib/postflop/scenario";
import { riverBuckets } from "../src/lib/postflop/flop-solve";
import { countNodes } from "../src/lib/solver/tree";

const scenario = SCENARIOS[0]!;
const game = buildFlopGame(scenario);

console.log(
  `${scenario.id}: ${game.hands.count} hands, ${countNodes(game.tree).player} decision nodes\n`,
);
console.log("  K   iterations        solve      grade   exploitability");
console.log("  --  ----------  -----------  ---------  ---------------");

// The sweep behind the table in docs/postflop-solver.md. About an hour end to
// end, which is why the shipping settings come from running it once rather than
// from re-running it per scenario.
for (const [buckets, iterations] of [
  [16, 40],
  [16, 80],
  [16, 160],
  [32, 160],
  [64, 160],
  [128, 160],
] as const) {
  let started = Date.now();
  const solution = solve(game.tree, game.hands, game.ranges, {
    iterations,
    viewSets: game.viewSets,
    bucketsFor: riverBuckets(game, buckets),
    skipExploitability: true,
  });
  const solveSeconds = (Date.now() - started) / 1000;

  started = Date.now();
  const average = game.tree.playerNodes.map((node) => solution.strategyAt(node));
  const gap = measureExploitability(game.tree, game.hands, game.ranges, average, game.viewSets);
  const gradeSeconds = (Date.now() - started) / 1000;

  console.log(
    `  ${String(buckets).padStart(2)}  ${String(iterations).padStart(10)}  ` +
      `${(solveSeconds / 60).toFixed(1).padStart(9)}m  ` +
      `${gradeSeconds.toFixed(0).padStart(8)}s  ` +
      `${((gap / game.seats.pot) * 100).toFixed(3).padStart(13)}%`,
  );
}
