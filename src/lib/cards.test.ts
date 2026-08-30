import { describe, expect, it } from "vitest";
import {
  RANKS,
  TOTAL_COMBOS,
  allHandClasses,
  comboCount,
  comboPercent,
  dealHoleCards,
  fullDeck,
  gridCell,
  handClassOf,
  rankIndex,
} from "./cards";

/** Deterministic generator so the distribution test cannot flake. */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG. Only needs to be uniform, not cryptographic.
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("ranks", () => {
  it("has 13, ace strongest", () => {
    expect(RANKS).toHaveLength(13);
    expect(rankIndex("A")).toBe(0);
    expect(rankIndex("2")).toBe(12);
    expect(rankIndex("K")).toBeLessThan(rankIndex("Q"));
  });
});

describe("handClassOf", () => {
  it("reads suited, offsuit and pairs", () => {
    expect(handClassOf("Ah", "Kh")).toBe("AKs");
    expect(handClassOf("Ah", "Kd")).toBe("AKo");
    expect(handClassOf("Ah", "Ad")).toBe("AA");
  });

  it("puts the higher rank first regardless of argument order", () => {
    expect(handClassOf("Kh", "Ah")).toBe("AKs");
    expect(handClassOf("2c", "7d")).toBe("72o");
    expect(handClassOf("7d", "2c")).toBe("72o");
  });
});

describe("the grid", () => {
  it("is pairs on the diagonal, suited above, offsuit below", () => {
    expect(gridCell(0, 0)).toBe("AA");
    expect(gridCell(12, 12)).toBe("22");
    expect(gridCell(0, 1)).toBe("AKs"); // above
    expect(gridCell(1, 0)).toBe("AKo"); // below
    expect(gridCell(4, 12)).toBe("T2s");
    expect(gridCell(12, 4)).toBe("T2o");
  });

  it("covers 169 distinct classes", () => {
    const all = allHandClasses();
    expect(all).toHaveLength(169);
    expect(new Set(all).size).toBe(169);
  });

  it("accounts for every combination in the deck exactly once", () => {
    const total = allHandClasses().reduce((sum, h) => sum + comboCount(h), 0);
    expect(total).toBe(TOTAL_COMBOS);
    expect(comboPercent(allHandClasses())).toBeCloseTo(100, 10);
  });
});

describe("comboCount", () => {
  it("is 6 for a pair, 4 suited, 12 offsuit", () => {
    expect(comboCount("AA")).toBe(6);
    expect(comboCount("AKs")).toBe(4);
    expect(comboCount("AKo")).toBe(12);
  });
});

describe("the deck", () => {
  it("holds 52 distinct cards", () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });
});

describe("dealHoleCards", () => {
  it("never deals the same card twice", () => {
    const rng = seededRng(7);
    for (let i = 0; i < 2000; i++) {
      const [a, b] = dealHoleCards(rng);
      expect(a).not.toBe(b);
    }
  });

  it("deals combinations, not classes, so pairs stay rare", () => {
    // The bug this guards: picking uniformly from the 169 classes would make
    // pairs 13/169 = 7.7% of deals. Dealing real cards makes them 78/1326 = 5.88%.
    const rng = seededRng(42);
    const draws = 60_000;
    let pairs = 0;
    for (let i = 0; i < draws; i++) {
      const [a, b] = dealHoleCards(rng);
      if (handClassOf(a, b).length === 2) pairs++;
    }
    const rate = (pairs / draws) * 100;
    expect(rate).toBeGreaterThan(5.4);
    expect(rate).toBeLessThan(6.4);
  });

  it("deals every one of the 169 classes given enough hands", () => {
    const rng = seededRng(99);
    const seen = new Set<string>();
    for (let i = 0; i < 60_000; i++) {
      const [a, b] = dealHoleCards(rng);
      seen.add(handClassOf(a, b));
    }
    expect(seen.size).toBe(169);
  });
});
