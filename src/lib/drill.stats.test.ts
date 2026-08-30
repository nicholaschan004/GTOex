import { describe, expect, it } from "vitest";
import { correctAction, dealSpot, rfiRange } from "./drill";
import { RFI_POSITIONS, type RfiPosition } from "./positions";
import { comboPercent } from "./cards";

/**
 * Statistical proof that dealing and scoring agree with the charts.
 *
 * If you answered "raise" to every hand, your accuracy at a seat would have to
 * converge on that seat's opening frequency. Anything else means the deal, the
 * chart lookup or the scoring disagree with each other, and that is exactly the
 * kind of fault that stays invisible while playing because every individual
 * hand still looks plausible.
 */
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("always raising scores the opening frequency", () => {
  const rng = seededRng(2024);
  const hands = 200_000;
  const attempts = new Map<RfiPosition, number>();
  const raised = new Map<RfiPosition, number>();

  for (const position of RFI_POSITIONS) {
    attempts.set(position, 0);
    raised.set(position, 0);
  }

  for (let i = 0; i < hands; i++) {
    const spot = dealSpot(rng);
    attempts.set(spot.position, (attempts.get(spot.position) ?? 0) + 1);
    if (correctAction(spot) === "raise") {
      raised.set(spot.position, (raised.get(spot.position) ?? 0) + 1);
    }
  }

  for (const position of RFI_POSITIONS) {
    it(`${position} matches its chart within half a point`, () => {
      const n = attempts.get(position) ?? 0;
      const observed = ((raised.get(position) ?? 0) / n) * 100;
      const expected = comboPercent(rfiRange(position));
      expect(n).toBeGreaterThan(hands / RFI_POSITIONS.length / 2);
      expect(Math.abs(observed - expected)).toBeLessThan(0.5);
    });
  }

  it("deals the five seats about evenly", () => {
    for (const position of RFI_POSITIONS) {
      const share = ((attempts.get(position) ?? 0) / hands) * 100;
      expect(share).toBeGreaterThan(19);
      expect(share).toBeLessThan(21);
    }
  });
});
