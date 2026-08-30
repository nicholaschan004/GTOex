/**
 * Heads-up push/fold, solved.
 *
 * Below roughly fifteen big blinds the game collapses: the small blind either
 * moves all in or folds, and the big blind either calls or folds. There are no
 * later streets and no bet sizing, so the whole thing is two ranges, and two
 * ranges is small enough to actually solve on a laptop. This is the one part of
 * preflop where "here is the answer, and here is why it is the answer" is a
 * claim that can be made honestly.
 *
 * The payoffs, in big blinds, with an effective stack of S:
 *
 *   small blind folds                 -0.5   (it loses the posted half blind)
 *   shoves, big blind folds           +1.0   (it wins the big blind)
 *   shoves and is called        S(2e - 1)    (a pot of 2S, of which it wins e)
 *
 * So the big blind calls when S(2e - 1) > -1, which rearranges to needing more
 * than (S - 1) / 2S equity. At ten big blinds that is 45%, at five it is 40%:
 * the shorter the stack, the less the call has to be worth, which is the whole
 * reason short stacks call so wide.
 *
 * Solved by fictitious play: each side repeatedly answers the other's average
 * range so far, and the averages converge on the equilibrium.
 *
 * Plain iterated best response does NOT work here, damped or not. The hands on
 * the boundary flip between shove and fold on every pass, each side chasing the
 * other, and the iteration circles without ever settling. Averaging is what
 * makes it converge, and it is the reason the marginal hands come out as
 * frequencies rather than as a yes or a no: at equilibrium they genuinely are
 * mixed, and a chart that rounds them off is an approximation of the answer
 * rather than the answer.
 *
 * How far off, `exploitability` measures. That number, not the iteration count,
 * is the evidence that the output is an equilibrium.
 */

import type { HandClass } from "./cards";
import {
  ALL_COMBOS,
  CLASS_COUNT,
  COMBO_COUNT,
  conflictsOf,
  rangeToWeights,
  weightsToClasses,
} from "./combos";
import { comboPercent } from "./cards";

export interface PushFoldSolution {
  stack: number;
  shove: Set<HandClass>;
  call: Set<HandClass>;
  shovePercent: number;
  callPercent: number;
  iterations: number;
  /** True when the rounded charts are within a hundredth of a blind of equilibrium. */
  converged: boolean;
  /** Total exploitability of the rounded charts, in big blinds per hand. */
  residual: number;
}

export interface SolveOptions {
  maxIterations?: number;
}

const CLASS_OF = Int32Array.from(ALL_COMBOS.map((combo) => combo.classIndex));

/**
 * Equity of every combination against a weighted range, and the total weight
 * of that range once the hand's own cards are removed from it.
 *
 * `base` is the range's class totals folded through the equity matrix once, so
 * the per-hand work is only the subtraction of the hands it blocks.
 */
function equityAgainst(
  matrix: Float64Array,
  weights: Float64Array,
  outEquity: Float64Array,
  outWeight: Float64Array,
): void {
  const classTotals = new Float64Array(CLASS_COUNT);
  let totalWeight = 0;
  for (let j = 0; j < COMBO_COUNT; j++) {
    const weight = weights[j]!;
    if (weight === 0) continue;
    const heroClass = CLASS_OF[j]!;
    classTotals[heroClass] = classTotals[heroClass]! + weight;
    totalWeight += weight;
  }

  const base = new Float64Array(CLASS_COUNT);
  for (let hero = 0; hero < CLASS_COUNT; hero++) {
    let sum = 0;
    const row = hero * CLASS_COUNT;
    for (let villain = 0; villain < CLASS_COUNT; villain++) {
      const total = classTotals[villain]!;
      if (total !== 0) sum += total * matrix[row + villain]!;
    }
    base[hero] = sum;
  }

  for (let i = 0; i < COMBO_COUNT; i++) {
    const heroClass = CLASS_OF[i]!;
    const row = heroClass * CLASS_COUNT;
    let numerator = base[heroClass]!;
    let denominator = totalWeight;

    const conflicts = conflictsOf(i);
    for (let k = 0; k < conflicts.length; k++) {
      const j = conflicts[k]!;
      const weight = weights[j]!;
      if (weight === 0) continue;
      numerator -= weight * matrix[row + CLASS_OF[j]!]!;
      denominator -= weight;
    }

    outWeight[i] = denominator;
    outEquity[i] = denominator > 1e-9 ? numerator / denominator : 0.5;
  }
}

/**
 * How much either player could gain by abandoning the solution and playing the
 * best response to it, in big blinds per hand.
 *
 * At a true equilibrium this is zero: neither side has anything better to
 * switch to. It is the only self-contained way to check the output, because it
 * asks whether the two strategies beat each other rather than whether they
 * match a chart published somewhere else.
 */
export function exploitability(
  matrix: Float64Array,
  stack: number,
  shove: Float64Array,
  call: Float64Array,
): { small: number; big: number; total: number } {
  const equity = new Float64Array(COMBO_COUNT);
  const weight = new Float64Array(COMBO_COUNT);
  const allOnes = new Float64Array(COMBO_COUNT).fill(1);
  const totalAvailable = new Float64Array(COMBO_COUNT);
  const scratch = new Float64Array(COMBO_COUNT);
  equityAgainst(matrix, allOnes, scratch, totalAvailable);

  // Small blind: what it gives up by playing `shove` instead of always taking
  // the better of shoving and folding.
  equityAgainst(matrix, call, equity, weight);
  let smallLoss = 0;
  for (let i = 0; i < COMBO_COUNT; i++) {
    const available = totalAvailable[i]!;
    const frequency = available > 1e-9 ? weight[i]! / available : 0;
    const shoveValue = frequency * stack * (2 * equity[i]! - 1) + (1 - frequency) * 1;
    const played = shove[i]! * shoveValue + (1 - shove[i]!) * -0.5;
    smallLoss += Math.max(shoveValue, -0.5) - played;
  }

  // Big blind: the same comparison, but only across hands that actually face a
  // shove, so a tight shoving range cannot flatter the number.
  equityAgainst(matrix, shove, equity, weight);
  let bigLoss = 0;
  for (let j = 0; j < COMBO_COUNT; j++) {
    const available = totalAvailable[j]!;
    const frequency = available > 1e-9 ? weight[j]! / available : 0;
    if (frequency <= 1e-9) continue;
    const callValue = stack * (2 * equity[j]! - 1);
    const played = call[j]! * callValue + (1 - call[j]!) * -1;
    bigLoss += frequency * (Math.max(callValue, -1) - played);
  }

  const small = smallLoss / COMBO_COUNT;
  const big = bigLoss / COMBO_COUNT;
  return { small, big, total: small + big };
}

export function solveHeadsUpPushFold(
  matrix: Float64Array,
  stack: number,
  options: SolveOptions = {},
): PushFoldSolution {
  const iterations = options.maxIterations ?? 600;

  const shove = new Float64Array(COMBO_COUNT).fill(1);
  const call = new Float64Array(COMBO_COUNT).fill(1);

  const equity = new Float64Array(COMBO_COUNT);
  const availableWeight = new Float64Array(COMBO_COUNT);
  const allOnes = new Float64Array(COMBO_COUNT).fill(1);
  const totalAvailable = new Float64Array(COMBO_COUNT);
  const scratch = new Float64Array(COMBO_COUNT);

  // How many big blind hands exist behind each small blind hand. Fixed, so it
  // is computed once rather than every iteration.
  equityAgainst(matrix, allOnes, scratch, totalAvailable);

  // The big blind risks its whole stack to win the pot; this is the equity that
  // makes calling break even against folding.
  const callThreshold = (stack - 1) / (2 * stack);

  let iteration = 0;
  for (; iteration < iterations; iteration++) {
    // The step shrinks as 1/(t+2), which makes each range the running average
    // of every best response played so far. That average is what converges;
    // the best responses themselves never stop flipping at the boundary.
    const step = 1 / (iteration + 2);

    equityAgainst(matrix, shove, equity, availableWeight);
    for (let j = 0; j < COMBO_COUNT; j++) {
      const best = equity[j]! > callThreshold ? 1 : 0;
      call[j] = call[j]! + (best - call[j]!) * step;
    }

    equityAgainst(matrix, call, equity, availableWeight);
    for (let i = 0; i < COMBO_COUNT; i++) {
      const available = totalAvailable[i]!;
      const frequency = available > 1e-9 ? availableWeight[i]! / available : 0;
      const expected = frequency * stack * (2 * equity[i]! - 1) + (1 - frequency) * 1;
      const best = expected > -0.5 ? 1 : 0;
      shove[i] = shove[i]! + (best - shove[i]!) * step;
    }
  }

  const shoveClasses = weightsToClasses(shove);
  const callClasses = weightsToClasses(call);

  // Measured on the rounded charts rather than the mixed strategies, because
  // the rounded charts are what ships and what a player would actually follow.
  const gap = exploitability(
    matrix,
    stack,
    rangeToWeights(shoveClasses),
    rangeToWeights(callClasses),
  );

  return {
    stack,
    shove: shoveClasses,
    call: callClasses,
    shovePercent: comboPercent(shoveClasses),
    callPercent: comboPercent(callClasses),
    iterations: iteration,
    converged: gap.total < 0.01,
    residual: gap.total,
  };
}

/** The equity the big blind needs to call, from the pot odds alone. */
export function callingThreshold(stack: number): number {
  return (stack - 1) / (2 * stack);
}
