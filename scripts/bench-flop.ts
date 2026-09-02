/**
 * What a three street solve costs.
 *
 *     npx vite-node scripts/bench-flop.ts
 *
 * A flop solve deals 49 turns under every flop line and 48 rivers under every
 * turn line, so the river betting round is instantiated 21,168 times. That is
 * the whole cost, and it is also why the river has to be bucketed: at full
 * resolution the regret tables alone are gigabytes.
 *
 * This measures the two things that decide whether the mode is buildable -- the
 * clock and the memory -- across bucket counts.
 */

import { solve } from "../src/lib/solver/cfr";
import { SCENARIOS, buildFlopGame } from "../src/lib/postflop/scenario";
import { riverBuckets } from "../src/lib/postflop/flop-solve";
import { countNodes } from "../src/lib/solver/tree";

const scenario = SCENARIOS[0]!;

let started = Date.now();
const game = buildFlopGame(scenario);
const built = Date.now() - started;

const nodes = countNodes(game.tree);
console.log(
  `${scenario.id}: ${game.hands.count} hands, ` +
    `${nodes.player} decision nodes, ${nodes.chance} chance nodes, ` +
    `${nodes.terminal} terminals`,
);
console.log(`  tree and ${game.viewSets.length} view sets built in ${(built / 1000).toFixed(1)}s`);

const perStreet = [0, 0, 0];
for (const node of game.tree.playerNodes) perStreet[node.street] = perStreet[node.street]! + 1;
console.log(`  ${perStreet[0]} flop, ${perStreet[1]} turn, ${perStreet[2]} river\n`);

function megabytes(): number {
  const { heapUsed, external } = process.memoryUsage();
  return (heapUsed + external) / 1024 / 1024;
}

const ITERATIONS = 4;

for (const buckets of [8, 16, 32]) {
  started = Date.now();
  const bucketsFor = riverBuckets(game, buckets);
  const clustered = Date.now() - started;

  const before = megabytes();
  started = Date.now();
  solve(game.tree, game.hands, game.ranges, {
    iterations: ITERATIONS,
    viewSets: game.viewSets,
    bucketsFor,
    skipExploitability: true,
  });
  const elapsed = Date.now() - started;

  console.log(
    `river buckets K=${String(buckets).padStart(3)}  ` +
      `${(clustered / 1000).toFixed(1)}s to cluster, ` +
      `${(elapsed / ITERATIONS / 1000).toFixed(2)}s per iteration, ` +
      `${(megabytes() - before).toFixed(0)} MB`,
  );
}
