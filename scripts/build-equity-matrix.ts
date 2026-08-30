/**
 * Precompute all-in equity for every pair of hand classes.
 *
 *   npx vite-node scripts/build-equity-matrix.ts
 *
 * The push/fold solver needs equity of a hand against a range thousands of
 * times per iteration. Computing that from scratch is hopeless, so the 169x169
 * matrix is built once here and committed. Seeded, so a rebuild reproduces it.
 *
 * Only the upper triangle is sampled. Below it, equity is one minus the
 * transpose, because the two players are looking at the same board.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASS_COUNT, CLASS_LIST } from "../src/lib/combos";
import { combosOfClass, evaluate7, CARD_COUNT } from "../src/lib/equity";
import { mulberry32 } from "../src/lib/rng";

const TRIALS = 12000;
const SEED = 20260830;
const SCALE = 10000;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "data/equity-matrix.json");

const rng = mulberry32(SEED);
const combosByClass = CLASS_LIST.map((hand) => combosOfClass(hand));

/** Every pair of combinations from two classes that do not share a card. */
function validPairs(i: number, j: number): [number, number][][] {
  const pairs: [number, number][][] = [];
  for (const [a1, a2] of combosByClass[i]!) {
    for (const [b1, b2] of combosByClass[j]!) {
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      pairs.push([
        [a1, a2],
        [b1, b2],
      ]);
    }
  }
  return pairs;
}

const matrix = new Float64Array(CLASS_COUNT * CLASS_COUNT);
const deck = new Int32Array(CARD_COUNT);
const heroHand = new Int32Array(7);
const villainHand = new Int32Array(7);

let done = 0;
const totalPairs = (CLASS_COUNT * (CLASS_COUNT - 1)) / 2;
const started = process.hrtime.bigint();

for (let i = 0; i < CLASS_COUNT; i++) {
  // A class against itself is symmetric, so it is exactly half the pot.
  matrix[i * CLASS_COUNT + i] = 0.5;

  for (let j = i + 1; j < CLASS_COUNT; j++) {
    const pairs = validPairs(i, j);
    if (pairs.length === 0) {
      // Impossible matchup, e.g. AA against AA once cards are removed. Never
      // reached for distinct classes, but leave it defined rather than NaN.
      matrix[i * CLASS_COUNT + j] = 0.5;
      matrix[j * CLASS_COUNT + i] = 0.5;
      continue;
    }

    let wins = 0;
    let ties = 0;

    for (let trial = 0; trial < TRIALS; trial++) {
      const pair = pairs[(rng() * pairs.length) | 0]!;
      const hero = pair[0];
      const villain = pair[1];

      heroHand[0] = hero[0];
      heroHand[1] = hero[1];
      villainHand[0] = villain[0];
      villainHand[1] = villain[1];

      let size = 0;
      for (let card = 0; card < CARD_COUNT; card++) {
        if (card === hero[0] || card === hero[1] || card === villain[0] || card === villain[1]) {
          continue;
        }
        deck[size++] = card;
      }

      for (let k = 0; k < 5; k++) {
        const pick = k + ((rng() * (size - k)) | 0);
        const swap = deck[k]!;
        deck[k] = deck[pick]!;
        deck[pick] = swap;
        heroHand[2 + k] = villainHand[2 + k] = deck[k]!;
      }

      const h = evaluate7(heroHand as unknown as number[]);
      const v = evaluate7(villainHand as unknown as number[]);
      if (h > v) wins++;
      else if (h === v) ties++;
    }

    const equity = (wins + ties / 2) / TRIALS;
    matrix[i * CLASS_COUNT + j] = equity;
    matrix[j * CLASS_COUNT + i] = 1 - equity;

    done++;
    if (done % 1500 === 0) {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
      process.stdout.write(
        `  ${done}/${totalPairs} pairs  ${elapsed.toFixed(0)}s\n`,
      );
    }
  }
}

const quantised = Array.from(matrix, (value) => Math.round(value * SCALE));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({
    note: "All-in preflop equity, class vs class. Values are equity * 10000.",
    classes: CLASS_LIST,
    trials: TRIALS,
    seed: SEED,
    scale: SCALE,
    matrix: quantised,
  }),
);

const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
console.log(`Wrote ${outPath} in ${elapsed.toFixed(1)}s (${TRIALS} trials per pair)`);
