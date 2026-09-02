/**
 * How hard the browser should work on the streets it solves itself.
 *
 *     npx vite-node scripts/bench-live.ts
 *
 * The flop is precomputed. The turn and the river are not: after two players
 * act on the flop the ranges are whatever those actions imply, so those streets
 * get solved when they arrive, in a Web Worker, while the card is landing.
 *
 * That makes the iteration count a product decision as much as a numerical one.
 * Too few and the trainer prices your decisions against a strategy that has not
 * converged; too many and there is a hole in the hand where the software is
 * thinking. This prints both sides of it.
 *
 * Ranges here are the full flop ranges carried onto a turn, which is the
 * WIDEST the mode can produce -- a real turn arrives after a flop round has
 * narrowed both players, so a real solve is smaller and faster than these.
 *
 * Nothing here is a test. Numbers move with the machine.
 */

import { solve } from "../src/lib/solver/cfr";
import { SCENARIOS, buildFlopGame } from "../src/lib/postflop/scenario";
import { subgameTree } from "../src/lib/postflop/subgame";
import { buildRunoutViews, buildHandSet, compactToLive } from "../src/lib/solver/hands";
import { countNodes } from "../src/lib/solver/tree";
import { deckAfter } from "../src/lib/solver/hands";
import { intToCard } from "../src/lib/equity";

const scenario = SCENARIOS[0]!;
const game = buildFlopGame(scenario);

/** Carry the flop ranges onto a turn card, the way a played hand does. */
function onTurn(turnCard: number) {
  const board = [...game.hands.board, turnCard];
  const all = buildHandSet(board, false);
  const carried: [Float64Array, Float64Array] = [
    new Float64Array(all.count),
    new Float64Array(all.count),
  ];
  for (let h = 0; h < game.hands.count; h++) {
    const at = all.indexOf(game.hands.cardA[h]!, game.hands.cardB[h]!);
    if (at < 0) continue;
    carried[0][at] = game.ranges[0][h]!;
    carried[1][at] = game.ranges[1][h]!;
  }
  return compactToLive(all, carried);
}

const turnCard = deckAfter(game.hands.board)[20]!;
const turn = onTurn(turnCard);
const pot = game.seats.pot + 2 * 2.75;
const stack = game.seats.stack - 2.75;

console.log(
  `${scenario.flop} ${intToCard(turnCard)}: ${turn.hands.count} hands ` +
    `(the flop had ${game.hands.count}), ${pot.toFixed(2)}bb pot, ${stack.toFixed(2)}bb behind\n`,
);

const turnTree = subgameTree([...turn.hands.board], pot, stack);
console.log(`turn subgame: ${countNodes(turnTree).player} decision nodes`);

let started = Date.now();
const views = [buildRunoutViews(turn.hands)];
console.log(`  ${Date.now() - started}ms to build 48 runout views\n`);

console.log("  iterations     wall clock   exploitability");
console.log("  ----------  -------------  ---------------");
for (const iterations of [20, 40, 60, 100, 160]) {
  started = Date.now();
  solve(turnTree, turn.hands, turn.ranges, {
    iterations,
    viewSets: views,
    skipExploitability: true,
  });
  const quiet = Date.now() - started;

  const graded = solve(turnTree, turn.hands, turn.ranges, { iterations, viewSets: views });
  console.log(
    `  ${String(iterations).padStart(10)}  ${String(quiet).padStart(11)}ms  ` +
      `${graded.exploitabilityPercent.toFixed(3).padStart(13)}%`,
  );
}

// --- the river, which is the same question with two fewer zeros --------------
const riverCard = deckAfter([...turn.hands.board])[7]!;
const riverBoard = [...turn.hands.board, riverCard];
const all = buildHandSet(riverBoard, true);
const carried: [Float64Array, Float64Array] = [
  new Float64Array(all.count),
  new Float64Array(all.count),
];
for (let h = 0; h < turn.hands.count; h++) {
  const at = all.indexOf(turn.hands.cardA[h]!, turn.hands.cardB[h]!);
  if (at >= 0) {
    carried[0][at] = turn.ranges[0][h]!;
    carried[1][at] = turn.ranges[1][h]!;
  }
}
const river = compactToLive(all, carried);
const riverPot = pot + 2 * 0.75 * pot;
const riverTree = subgameTree(riverBoard, riverPot, stack - 0.75 * pot);

console.log(`\nriver subgame: ${countNodes(riverTree).player} decision nodes, ${river.hands.count} hands`);
console.log("  iterations     wall clock   exploitability");
console.log("  ----------  -------------  ---------------");
for (const iterations of [50, 100, 150, 300]) {
  started = Date.now();
  solve(riverTree, river.hands, river.ranges, { iterations, skipExploitability: true });
  const quiet = Date.now() - started;

  const graded = solve(riverTree, river.hands, river.ranges, { iterations });
  console.log(
    `  ${String(iterations).padStart(10)}  ${String(quiet).padStart(11)}ms  ` +
      `${graded.exploitabilityPercent.toFixed(3).padStart(13)}%`,
  );
}
