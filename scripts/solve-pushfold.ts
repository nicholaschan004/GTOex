/**
 * Solve heads-up push/fold at every short stack depth and write the charts.
 *
 *   npx vite-node scripts/build-equity-matrix.ts   (once)
 *   npx vite-node scripts/solve-pushfold.ts
 *
 * Output goes to src/lib/charts/pushfold.generated.ts. That file is generated
 * and committed: committed so the app does not have to solve anything at
 * runtime, generated so the numbers in it were computed rather than typed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { solveHeadsUpPushFold, callingThreshold } from "../src/lib/pushfold";
import { formatRange } from "../src/lib/range";

const here = dirname(fileURLToPath(import.meta.url));
const matrixPath = resolve(here, "data/equity-matrix.json");
const outPath = resolve(here, "../src/lib/charts/pushfold.generated.ts");

const STACKS = Array.from({ length: 19 }, (_, i) => i + 2); // 2bb to 20bb

const raw = JSON.parse(readFileSync(matrixPath, "utf8")) as {
  matrix: number[];
  scale: number;
  trials: number;
  seed: number;
};
const matrix = Float64Array.from(raw.matrix, (value) => value / raw.scale);

console.log(`Loaded equity matrix: ${raw.trials} trials per pair, seed ${raw.seed}\n`);
console.log("stack   shove%   call%   need%   iters   exploit  ok");

const rows: string[] = [];
for (const stack of STACKS) {
  const solution = solveHeadsUpPushFold(matrix, stack);
  console.log(
    `${String(stack).padStart(4)}bb  ` +
      `${solution.shovePercent.toFixed(1).padStart(6)}  ` +
      `${solution.callPercent.toFixed(1).padStart(6)}  ` +
      `${(callingThreshold(stack) * 100).toFixed(1).padStart(6)}  ` +
      `${String(solution.iterations).padStart(6)}  ` +
      `${solution.residual.toFixed(5).padStart(8)}  ${solution.converged ? "yes" : "NO"}`,
  );

  rows.push(
    `  ${stack}: {\n` +
      `    shove: ${JSON.stringify(formatRange(solution.shove))},\n` +
      `    call: ${JSON.stringify(formatRange(solution.call))},\n` +
      `    shovePercent: ${solution.shovePercent.toFixed(2)},\n` +
      `    callPercent: ${solution.callPercent.toFixed(2)},\n` +
      `  },`,
  );
}

const file = `/**
 * GENERATED FILE. Do not edit by hand.
 *
 *   npx vite-node scripts/build-equity-matrix.ts
 *   npx vite-node scripts/solve-pushfold.ts
 *
 * Heads-up push/fold equilibrium, solved by fictitious play over a sampled
 * 169x169 all-in equity matrix (${raw.trials} trials per pair, seed ${raw.seed}).
 *
 * Unlike every other chart in this project, nothing here was chosen by a
 * person. See src/lib/pushfold.ts for the model, and pushfold.test.ts, which
 * re-derives the exploitability of these exact ranges rather than trusting
 * that whatever produced them was working.
 */

export interface PushFoldChart {
  /** Small blind: move all in with these, fold everything else. */
  shove: string;
  /** Big blind: call the all in with these. */
  call: string;
  shovePercent: number;
  callPercent: number;
}

export const PUSHFOLD_STACKS = [${STACKS.join(", ")}] as const;
export type PushFoldStack = (typeof PUSHFOLD_STACKS)[number];

export const PUSHFOLD: Record<PushFoldStack, PushFoldChart> = {
${rows.join("\n")}
};
`;

writeFileSync(outPath, file);
console.log(`\nWrote ${outPath}`);
