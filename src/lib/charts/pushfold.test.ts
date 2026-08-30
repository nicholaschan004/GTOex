import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PUSHFOLD, PUSHFOLD_STACKS, type PushFoldStack } from "./pushfold.generated";
import { callingThreshold, exploitability } from "../pushfold";
import { rangeToWeights } from "../combos";
import { parseRange } from "../range";
import { comboPercent, type HandClass } from "../cards";

/**
 * These tests read the committed chart file and re-derive its properties from
 * the committed equity matrix. They deliberately do NOT re-run the solver: the
 * question is whether the ranges that actually ship are an equilibrium, not
 * whether the solver produces an equilibrium when run again.
 */
const raw = JSON.parse(
  readFileSync(resolve(__dirname, "../../../scripts/data/equity-matrix.json"), "utf8"),
) as { matrix: number[]; scale: number };
const matrix = Float64Array.from(raw.matrix, (value) => value / raw.scale);

const shoveOf = (stack: PushFoldStack) => parseRange(PUSHFOLD[stack].shove);
const callOf = (stack: PushFoldStack) => parseRange(PUSHFOLD[stack].call);

describe("coverage", () => {
  it("covers every short stack from 2bb to 20bb", () => {
    expect(PUSHFOLD_STACKS).toHaveLength(19);
    expect(PUSHFOLD_STACKS[0]).toBe(2);
    expect(PUSHFOLD_STACKS[PUSHFOLD_STACKS.length - 1]).toBe(20);
    for (const stack of PUSHFOLD_STACKS) {
      expect(PUSHFOLD[stack].shove.length).toBeGreaterThan(0);
      expect(PUSHFOLD[stack].call.length).toBeGreaterThan(0);
    }
  });

  it("reports percentages that match the ranges it publishes", () => {
    for (const stack of PUSHFOLD_STACKS) {
      expect(comboPercent(shoveOf(stack))).toBeCloseTo(PUSHFOLD[stack].shovePercent, 1);
      expect(comboPercent(callOf(stack))).toBeCloseTo(PUSHFOLD[stack].callPercent, 1);
    }
  });
});

/**
 * The claim the whole solver exists to support. If either player could gain by
 * deviating, these are not equilibrium ranges and the file should not say they
 * were solved.
 */
describe("the published charts are an equilibrium", () => {
  for (const stack of PUSHFOLD_STACKS) {
    it(`${stack}bb is unexploitable to within a hundredth of a blind`, () => {
      const gap = exploitability(
        matrix,
        stack,
        rangeToWeights(shoveOf(stack)),
        rangeToWeights(callOf(stack)),
      );
      expect(gap.small).toBeGreaterThanOrEqual(-1e-9);
      expect(gap.big).toBeGreaterThanOrEqual(-1e-9);
      expect(gap.total).toBeLessThan(0.01);
    });
  }
});

describe("the pot odds behind the calling range", () => {
  it("matches the algebra the model is built on", () => {
    // The big blind risks its stack to win the pot plus its own blind back.
    expect(callingThreshold(10)).toBeCloseTo(0.45, 10);
    expect(callingThreshold(5)).toBeCloseTo(0.4, 10);
    expect(callingThreshold(2)).toBeCloseTo(0.25, 10);
  });

  it("demands more equity as the stack deepens", () => {
    for (let i = 1; i < PUSHFOLD_STACKS.length; i++) {
      expect(callingThreshold(PUSHFOLD_STACKS[i]!)).toBeGreaterThan(
        callingThreshold(PUSHFOLD_STACKS[i - 1]!),
      );
    }
  });
});

describe("both ranges tighten as the stack deepens", () => {
  it("shoves less", () => {
    for (let i = 1; i < PUSHFOLD_STACKS.length; i++) {
      const shallow = PUSHFOLD[PUSHFOLD_STACKS[i - 1]!].shovePercent;
      const deep = PUSHFOLD[PUSHFOLD_STACKS[i]!].shovePercent;
      expect(deep).toBeLessThanOrEqual(shallow);
    }
  });

  it("calls less", () => {
    for (let i = 1; i < PUSHFOLD_STACKS.length; i++) {
      const shallow = PUSHFOLD[PUSHFOLD_STACKS[i - 1]!].callPercent;
      const deep = PUSHFOLD[PUSHFOLD_STACKS[i]!].callPercent;
      expect(deep).toBeLessThanOrEqual(shallow);
    }
  });

  /**
   * From five big blinds up, the shove is wider than the call, because shoving
   * wins the pot outright every time the big blind folds while a call only ever
   * gets to a showdown.
   *
   * Below that it inverts, and the inversion is real rather than a glitch. At
   * four blinds the big blind is being asked to put in three to win five, so it
   * can call almost anything, while the small blind is risking its whole stack
   * to pick up only one blind of dead money. The crossover sits between four
   * and five, and it is pinned here because it is the kind of thing a plausible
   * looking bug would move.
   */
  it("shoves wider than it calls from 5bb up", () => {
    for (const stack of PUSHFOLD_STACKS) {
      if (stack < 5) continue;
      expect(PUSHFOLD[stack].shovePercent).toBeGreaterThan(PUSHFOLD[stack].callPercent);
    }
  });

  it("calls wider than it shoves below 5bb", () => {
    for (const stack of [2, 3, 4] as PushFoldStack[]) {
      expect(PUSHFOLD[stack].callPercent).toBeGreaterThan(PUSHFOLD[stack].shovePercent);
    }
  });
});

describe("sanity", () => {
  it("always shoves and always calls with aces", () => {
    for (const stack of PUSHFOLD_STACKS) {
      expect(shoveOf(stack).has("AA")).toBe(true);
      expect(callOf(stack).has("AA")).toBe(true);
    }
  });

  it("gives up marginal hands as the stack deepens", () => {
    expect(shoveOf(2).has("96o")).toBe(true);
    expect(shoveOf(20).has("96o")).toBe(false);
  });

  it("folds the worst hand in poker even at 2bb", () => {
    // Worth checking because it is counterintuitive. Even with only half a
    // blind at stake and the big blind calling every hand, 72o has about a
    // third of the equity, so shoving is worth roughly -0.7 blinds against the
    // -0.5 of just folding. A solver that shoved everything at 2bb would be
    // wrong, and this is the hand that shows it.
    expect(shoveOf(2).has("72o")).toBe(false);
    expect(PUSHFOLD[2].shovePercent).toBeLessThan(95);
  });

  it("calls off with everything at 2bb", () => {
    // Needing 25% equity, there is no hand that cannot call.
    expect(PUSHFOLD[2].callPercent).toBeCloseTo(100, 5);
  });

  /**
   * Nesting is checked loosely on purpose.
   *
   * A hand worth shoving deep should be worth shoving shallower, and in bulk
   * that holds. But at equilibrium the boundary hands are genuinely MIXED, so
   * publishing a pure chart means rounding a hand that should be shoved half
   * the time to either always or never. Which way it rounds is decided by
   * sampling noise in the equity matrix, not by strategy. Demanding perfect
   * nesting would therefore be demanding that noise land a particular way.
   */
  it("nests between adjacent depths apart from boundary hands", () => {
    for (let i = 1; i < PUSHFOLD_STACKS.length; i++) {
      const shallow = shoveOf(PUSHFOLD_STACKS[i - 1]!);
      const deep = shoveOf(PUSHFOLD_STACKS[i]!);
      const missing = [...deep].filter((hand: HandClass) => !shallow.has(hand));
      expect(missing.length).toBeLessThanOrEqual(3);
    }
  });

  it("nests strictly across a wide gap in depth", () => {
    // Far enough apart that the difference in strategy dwarfs the noise.
    for (const [shallowStack, deepStack] of [
      [5, 15],
      [6, 16],
      [8, 18],
      [10, 20],
    ] as [PushFoldStack, PushFoldStack][]) {
      const shallow = shoveOf(shallowStack);
      const missing = [...shoveOf(deepStack)].filter((hand: HandClass) => !shallow.has(hand));
      expect(missing).toEqual([]);
    }
  });
});
