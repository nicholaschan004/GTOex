/**
 * How long a river solve takes, and how close it gets.
 *
 *     npx vite-node scripts/bench-river.ts
 *
 * The tests assert that the solver converges. This prints the curve behind that
 * assertion: what each iteration count costs and what it buys. It matters for
 * two reasons. Whether a solve can run in a browser tab at all is a wall clock
 * question, and the whole plan for the turn (docs/postflop-solver.md) is to
 * approximate and then measure what the approximation cost, which needs a
 * baseline that is measured rather than assumed.
 *
 * Nothing here is a test. Numbers move with the machine.
 */

import { solveRiver } from "../src/lib/solver/cfr";
import { buildHandSet } from "../src/lib/solver/hands";
import { DEFAULT_BETTING, buildTree, countNodes, type BettingConfig } from "../src/lib/solver/tree";
import { parseCards } from "../src/lib/equity";

const BOARDS = [
  { text: "Ks Jc 9h 7d 2c", note: "dry, one straight possible" },
  { text: "As Ks 4s 9d 2h", note: "three to a flush" },
  { text: "8h 7h 6c 5d 2s", note: "wet, four to a straight" },
];

const SIZINGS: { name: string; config: BettingConfig }[] = [
  {
    name: "one size, no raises",
    config: { ...DEFAULT_BETTING, startingPot: 20, effectiveStack: 80, betSizes: [0.75], maxBets: 1 },
  },
  {
    name: "two sizes, one raise",
    config: { ...DEFAULT_BETTING, startingPot: 20, effectiveStack: 80 },
  },
  {
    name: "three sizes, two raises",
    config: {
      ...DEFAULT_BETTING,
      startingPot: 20,
      effectiveStack: 80,
      betSizes: [0.33, 0.75, 1.25],
      raiseSizes: [0.6, 1.1],
      maxBets: 3,
    },
  },
];

const ITERATIONS = [25, 50, 100, 200, 400, 800];

console.log("River solver, 1081 hands a side, both ranges wide.\n");

for (const { name, config } of SIZINGS) {
  const tree = buildTree(config);
  const nodes = countNodes(tree);
  const actions = tree.playerNodes.reduce((sum, node) => sum + node.actions.length, 0);
  console.log(`${name}: ${nodes.player} decision nodes, ${nodes.terminal} terminals, ${actions} actions`);
  console.log("  iters      ms    ms/iter   exploitability");

  const hands = buildHandSet(parseCards(BOARDS[0]!.text));
  const wide = new Float64Array(hands.count).fill(1);

  for (const iterations of ITERATIONS) {
    const started = Date.now();
    const solution = solveRiver(tree, hands, [wide, wide], { iterations });
    const elapsed = Date.now() - started;
    console.log(
      `  ${String(iterations).padStart(5)}  ${String(elapsed).padStart(6)}` +
        `  ${(elapsed / iterations).toFixed(2).padStart(9)}` +
        `   ${solution.exploitabilityPercent.toFixed(4).padStart(8)}% of pot`,
    );
  }
  console.log("");
}

console.log("Same tree, different boards, 400 iterations:");
console.log("  board             ms   exploitability   note");
for (const { text, note } of BOARDS) {
  const hands = buildHandSet(parseCards(text));
  const tree = buildTree(SIZINGS[1]!.config);
  const wide = new Float64Array(hands.count).fill(1);

  const started = Date.now();
  const solution = solveRiver(tree, hands, [wide, wide], { iterations: 400 });
  const elapsed = Date.now() - started;
  console.log(
    `  ${text}  ${String(elapsed).padStart(5)}` +
      `   ${solution.exploitabilityPercent.toFixed(4).padStart(8)}% of pot   ${note}`,
  );
}
