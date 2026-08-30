import { describe, expect, it } from "vitest";
import { correctAction, dealSpot, foldedBefore, judge, rfiRange, type Spot } from "./drill";
import { RFI_POSITIONS } from "./positions";
import type { Card, HandClass } from "./cards";

function spotOf(position: (typeof RFI_POSITIONS)[number], cards: [Card, Card], hand: HandClass): Spot {
  return { kind: "rfi", position, depth: 100, cards, hand };
}

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("dealSpot", () => {
  it("produces a valid spot every time", () => {
    const rng = seededRng(3);
    for (let i = 0; i < 1000; i++) {
      const spot = dealSpot(rng);
      expect(RFI_POSITIONS).toContain(spot.position);
      expect(spot.cards[0]).not.toBe(spot.cards[1]);
      expect(spot.depth).toBe(100);
    }
  });

  it("reaches all five seats", () => {
    const rng = seededRng(11);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(dealSpot(rng).position);
    expect(seen.size).toBe(RFI_POSITIONS.length);
  });
});

describe("correctAction", () => {
  it("opens aces from everywhere", () => {
    for (const position of RFI_POSITIONS) {
      expect(correctAction(spotOf(position, ["Ah", "Ad"], "AA"))).toBe("raise");
    }
  });

  it("folds 72o from everywhere", () => {
    for (const position of RFI_POSITIONS) {
      expect(correctAction(spotOf(position, ["7h", "2d"], "72o"))).toBe("fold");
    }
  });

  it("is position dependent in between", () => {
    // KJo is a button open and an under the gun fold. If this ever stops
    // being true the charts have collapsed into each other.
    expect(correctAction(spotOf("UTG", ["Kh", "Jd"], "KJo"))).toBe("fold");
    expect(correctAction(spotOf("BTN", ["Kh", "Jd"], "KJo"))).toBe("raise");
  });
});

describe("judge", () => {
  const spot = spotOf("UTG", ["Ah", "Ad"], "AA");

  it("marks the right answer correct", () => {
    expect(judge(spot, "raise")).toEqual({ correct: true, answered: "raise", best: "raise" });
  });

  it("marks the wrong answer incorrect and still reports the best", () => {
    expect(judge(spot, "fold")).toEqual({ correct: false, answered: "fold", best: "raise" });
  });
});

describe("foldedBefore", () => {
  it("is empty under the gun and grows with position", () => {
    expect(foldedBefore("UTG")).toEqual([]);
    expect(foldedBefore("CO")).toEqual(["UTG", "HJ"]);
    expect(foldedBefore("SB")).toEqual(["UTG", "HJ", "CO", "BTN"]);
  });
});

describe("rfiRange", () => {
  it("caches, so repeated deals do not re-parse", () => {
    expect(rfiRange("BTN")).toBe(rfiRange("BTN"));
  });
});
