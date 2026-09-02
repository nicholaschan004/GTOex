/**
 * What bucketing the turn actually costs, and actually saves.
 *
 *     npx vite-node scripts/bench-turn.ts
 *
 * The exact turn solve is the yardstick. Every abstracted solve is then graded
 * in the FULL game: its strategy is expanded back over every hand and a best
 * response is computed against it without any abstraction at all, so the number
 * reported includes whatever the abstraction gave away by forcing hands to play
 * alike. Grading an abstraction inside its own abstraction would mostly measure
 * how confident it was.
 *
 * Nothing here is a test. Numbers move with the machine.
 */

import {
  blockerSpread,
  bucketByDistribution,
  bucketByMeanEquity,
  bucketByRiverProfile,
  bucketEveryRiver,
  equityDistributions,
  type Clustering,
} from "../src/lib/solver/abstraction";
import { measureExploitability, type Bucketing } from "../src/lib/solver/cfr";
import { buildTurnSpot, solveTurn, storageEstimate } from "../src/lib/solver/turn";
import { countNodes, DEFAULT_BETTING, type PlayerNode } from "../src/lib/solver/tree";
import { weightsFromClasses } from "../src/lib/solver/hands";
import { parseCards } from "../src/lib/equity";
import { parseRange } from "../src/lib/range";
import { RFI_BY_DEPTH } from "../src/lib/charts/rfi";
import { VS_OPEN_100BB } from "../src/lib/charts/vs-open";

const BOARD = "Ks Jc 9h 7d";
const ITERATIONS = 150;
const SIZES = [4, 8, 16, 32, 64, 128];

const board = parseCards(BOARD);
const turn = { ...DEFAULT_BETTING, startingPot: 20, effectiveStack: 80, betSizes: [0.75], maxBets: 1 };
const river = { ...DEFAULT_BETTING, betSizes: [0.75], maxBets: 1 };

const spot = buildTurnSpot(board, turn, river);
const n = spot.hands.count;

// A real spot rather than two uniform ranges: the button opens, the big blind
// calls, and this is the turn. Uniform ranges are the least informative
// possible test, because every hand then blocks exactly the same amount of
// opponent range and card removal has nothing to say.
const defence = VS_OPEN_100BB.BTN.BB!;
const oopRange = weightsFromClasses(spot.hands, parseRange(defence.call));
const ipRange = weightsFromClasses(spot.hands, parseRange(RFI_BY_DEPTH[100].BTN));
const ranges: [Float64Array, Float64Array] = [oopRange, ipRange];
const combos = (r: Float64Array) => [...r].filter((w) => w > 0).length;

const nodes = countNodes(spot.tree);
console.log(`Turn solve on ${BOARD}. Button opens, big blind calls.`);
console.log(`  out of position: ${combos(oopRange)} combos of ${n}`);
console.log(`  in position:     ${combos(ipRange)} combos of ${n}`);
console.log(
  `${n} hands, ${nodes.player} decision nodes, ${nodes.chance} chance nodes, ` +
    `${nodes.terminal} terminals, ${ITERATIONS} iterations.\n`,
);

function run(label: string, bucketsFor?: (node: PlayerNode) => Bucketing | null) {
  const started = Date.now();
  const solution = solveTurn(spot, ranges, { iterations: ITERATIONS, bucketsFor });
  const elapsed = Date.now() - started;
  const bytes = storageEstimate(spot.tree, n, bucketsFor);
  console.log(
    `  ${label.padEnd(26)} ${String(elapsed).padStart(6)}ms  ` +
      `${(bytes / 1e6).toFixed(1).padStart(6)} MB  ` +
      `${solution.exploitabilityPercent.toFixed(3).padStart(8)}% of pot`,
  );
  return solution;
}

// The yardstick: no abstraction anywhere.
console.log("  strategy                     time      memory   exploitability");
const exact = run("exact (no buckets)");

// Feature vectors, one set per player: a hand is bucketed by how it does
// against the range it is actually facing.
const forOop = equityDistributions(spot.hands, spot.views, ranges[0], ranges[1]);
const forIp = equityDistributions(spot.hands, spot.views, ranges[1], ranges[0]);

for (const size of SIZES) {
  for (const [name, cluster] of [
    ["mean equity  ", bucketByMeanEquity],
    ["sorted, EMD  ", bucketByDistribution],
    ["river profile", bucketByRiverProfile],
  ] as const) {
    const oop = cluster(forOop, size);
    const ip = cluster(forIp, size);
    // Only the turn is abstracted. The river keeps every hand its own decision,
    // because that is where blockers do their work.
    const bucketsFor = (node: PlayerNode): Bucketing | null =>
      node.street === 0 ? (node.player === 0 ? oop : ip) : null;
    run(`turn ${name} K=${size}`, bucketsFor);
  }
}

// The river, where 576 of the 580 decision nodes actually live. Bucketing here
// is the thing the design doc argued against, so it gets measured rather than
// asserted: hands sharing a bucket share their blockers.
console.log("");
for (const size of [4, 8, 16, 32, 64]) {
  const oop = bucketEveryRiver(spot.hands, spot.views, ranges[0], ranges[1], size);
  const ip = bucketEveryRiver(spot.hands, spot.views, ranges[1], ranges[0], size);
  const bucketsFor = (node: PlayerNode): Bucketing | null => {
    if (node.street !== 1) return null;
    const per: Clustering[] = node.player === 0 ? oop : ip;
    return per[node.chanceIndex]!;
  };
  run(`river equity K=${size}`, bucketsFor);
}

// Both streets at once, which is what a classical abstraction would do.
console.log("");
for (const size of [16, 64]) {
  const turnOop = bucketByDistribution(forOop, size);
  const turnIp = bucketByDistribution(forIp, size);
  const riverOop = bucketEveryRiver(spot.hands, spot.views, ranges[0], ranges[1], size);
  const riverIp = bucketEveryRiver(spot.hands, spot.views, ranges[1], ranges[0], size);
  const bucketsFor = (node: PlayerNode): Bucketing | null => {
    if (node.street === 0) return node.player === 0 ? turnOop : turnIp;
    const per = node.player === 0 ? riverOop : riverIp;
    return per[node.chanceIndex]!;
  };
  run(`both streets K=${size}`, bucketsFor);
}

// What the clusterings look like, independent of any solve.
console.log("\n  clustering quality (out of position, 317 combos)");
console.log("     K   metric           distortion   largest bucket   blocker spread");
for (const size of SIZES) {
  for (const [name, cluster] of [
    ["mean equity  ", bucketByMeanEquity],
    ["sorted, EMD  ", bucketByDistribution],
    ["river profile", bucketByRiverProfile],
  ] as const) {
    const c = cluster(forOop, size);
    console.log(
      `  ${String(size).padStart(4)}   ${name}   ${c.distortion.toFixed(5).padStart(10)}` +
        `   ${String(c.largest).padStart(14)}` +
        `   ${blockerSpread(spot.hands, ranges[1]!, c).toFixed(4).padStart(14)}`,
    );
  }
}

// The baseline again, last. Every timing above sits between these two, so a
// machine that drifted during the run says so rather than being read as a
// result about abstraction.
console.log("");
run("exact, second time");

// Sanity: the exact solve's own strategy, graded the same way, is the number
// every abstraction above is being compared against.
console.log(
  `\n  exact solve regraded: ${measureExploitability(
    spot.tree,
    spot.hands,
    ranges,
    spot.tree.playerNodes.map((node) => exact.strategyAt(node)),
    [spot.views],
  ).toFixed(6)} chips/hand`,
);
