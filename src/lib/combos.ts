/**
 * The bridge between the 169 hand classes strategy is written in and the 1326
 * concrete combinations equity is actually computed over.
 *
 * The solver needs both. Ranges are per class because that is how a human reads
 * a chart, but blockers are per combination: if you hold an ace, your opponent
 * holds one fewer ace than the naive count says, and at short stacks that
 * changes which hands are a shove. Working only in classes would quietly throw
 * that away.
 */

import { allHandClasses, type HandClass } from "./cards";
import { combosOfClass } from "./equity";

export const CLASS_LIST: readonly HandClass[] = allHandClasses();
export const CLASS_COUNT = CLASS_LIST.length; // 169

export const CLASS_INDEX: ReadonlyMap<HandClass, number> = new Map(
  CLASS_LIST.map((hand, index) => [hand, index]),
);

export function classIndexOf(hand: HandClass): number {
  const index = CLASS_INDEX.get(hand);
  if (index === undefined) throw new Error(`Unknown hand class: ${hand}`);
  return index;
}

export interface Combo {
  a: number;
  b: number;
  classIndex: number;
}

function buildCombos(): Combo[] {
  const out: Combo[] = [];
  for (let index = 0; index < CLASS_LIST.length; index++) {
    const hand = CLASS_LIST[index]!;
    for (const [a, b] of combosOfClass(hand)) {
      out.push({ a, b, classIndex: index });
    }
  }
  return out;
}

export const ALL_COMBOS: readonly Combo[] = buildCombos();
export const COMBO_COUNT = ALL_COMBOS.length; // 1326

/** Indices of the combinations belonging to each class. */
export const COMBOS_BY_CLASS: readonly (readonly number[])[] = (() => {
  const buckets: number[][] = Array.from({ length: CLASS_COUNT }, () => []);
  ALL_COMBOS.forEach((combo, index) => buckets[combo.classIndex]!.push(index));
  return buckets;
})();

/**
 * For each combination, the combinations that share a card with it.
 *
 * Stored as the conflicts rather than the disjoint pairs because conflicts are
 * the short list: a given two cards clash with 101 of the other 1325, so the
 * solver can start from a range total and subtract, instead of summing 1326
 * terms per hand. That is the difference between the solve taking seconds and
 * taking minutes.
 *
 * Built on first use. It costs about 135,000 operations, and nothing in the
 * browser bundle ever asks for it.
 */
let conflictCache: Int32Array[] | null = null;

export function conflictsOf(index: number): Int32Array {
  if (!conflictCache) {
    const byCard: number[][] = Array.from({ length: 52 }, () => []);
    ALL_COMBOS.forEach((combo, i) => {
      byCard[combo.a]!.push(i);
      byCard[combo.b]!.push(i);
    });

    conflictCache = ALL_COMBOS.map((combo, i) => {
      const seen = new Set<number>([...byCard[combo.a]!, ...byCard[combo.b]!]);
      seen.delete(i);
      return Int32Array.from([i, ...seen]); // itself first: it conflicts too
    });
  }
  const row = conflictCache[index];
  if (!row) throw new Error(`Combination index out of range: ${index}`);
  return row;
}

/** A per-class range expanded to a per-combination weight vector. */
export function rangeToWeights(range: ReadonlySet<HandClass>): Float64Array {
  const weights = new Float64Array(COMBO_COUNT);
  for (const hand of range) {
    for (const index of COMBOS_BY_CLASS[classIndexOf(hand)]!) weights[index] = 1;
  }
  return weights;
}

/** Turn a per-combination weight vector back into the classes it fully covers. */
export function weightsToClasses(weights: Float64Array, threshold = 0.5): Set<HandClass> {
  const out = new Set<HandClass>();
  for (let index = 0; index < CLASS_COUNT; index++) {
    const combos = COMBOS_BY_CLASS[index]!;
    let total = 0;
    for (const combo of combos) total += weights[combo]!;
    if (total / combos.length >= threshold) out.add(CLASS_LIST[index]!);
  }
  return out;
}
