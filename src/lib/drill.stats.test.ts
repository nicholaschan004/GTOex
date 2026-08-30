import { describe, expect, it } from "vitest";
import { correctAction, dealSpot, layersFor, spotKey, type Action } from "./drill";
import { comboPercent } from "./cards";
import { mulberry32 } from "./rng";

/**
 * Statistical proof that dealing, the charts and the scoring agree.
 *
 * If you gave one fixed answer to every hand, your accuracy in a given spot
 * would have to converge on how often that spot's chart says to take that
 * action. Anything else means the deal, the chart lookup or the scoring
 * disagree with each other, and that is exactly the kind of fault that stays
 * invisible while playing because every individual hand still looks plausible.
 *
 * This is the test that would catch a mode being wired to the wrong chart,
 * which is the most likely way this code breaks as more charts are added.
 */
function measure(mode: Parameters<typeof dealSpot>[0], answer: Action, hands: number) {
  const rng = mulberry32(2024);
  const attempts = new Map<string, number>();
  const agreed = new Map<string, number>();
  const expected = new Map<string, number>();

  for (let i = 0; i < hands; i++) {
    const spot = dealSpot(mode, {}, rng);
    const key = spotKey(spot);
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    if (correctAction(spot) === answer) agreed.set(key, (agreed.get(key) ?? 0) + 1);

    if (!expected.has(key)) {
      const layer = layersFor(spot).find((entry) => entry.action === answer);
      expected.set(key, layer ? comboPercent(layer.hands) : 0);
    }
  }

  return [...attempts.entries()].map(([key, count]) => ({
    key,
    count,
    observed: ((agreed.get(key) ?? 0) / count) * 100,
    expected: expected.get(key) ?? 0,
  }));
}

describe("always opening scores the opening frequency", () => {
  const rows = measure("rfi", "raise", 400_000);

  it("covers every seat at every depth", () => {
    expect(rows).toHaveLength(20); // 5 seats x 4 depths
  });

  for (const row of rows.sort((a, b) => a.key.localeCompare(b.key))) {
    it(`${row.key} is within half a point of its chart`, () => {
      expect(row.count).toBeGreaterThan(1000);
      expect(Math.abs(row.observed - row.expected)).toBeLessThan(0.5);
    });
  }
});

describe("always three-betting scores the three-bet frequency", () => {
  const rows = measure("vs-open", "raise", 400_000);

  it("covers all fifteen defending spots", () => {
    expect(rows).toHaveLength(15);
  });

  it("matches every spot's chart", () => {
    for (const row of rows) {
      expect(row.count).toBeGreaterThan(1000);
      expect(Math.abs(row.observed - row.expected)).toBeLessThan(0.6);
    }
  });
});

describe("always calling scores the calling frequency", () => {
  it("matches every spot's chart", () => {
    for (const row of measure("vs-open", "call", 400_000)) {
      expect(Math.abs(row.observed - row.expected)).toBeLessThan(0.6);
    }
  });
});

describe("push and fold score the solved charts", () => {
  it("shoving matches the small blind's solved range", () => {
    const rows = measure("pushfold", "raise", 300_000).filter((row) => row.key === "pf:SB");
    expect(rows).toHaveLength(1);
    // Averaged across every stack from 2bb to 20bb, so the expectation is the
    // mean of nineteen different charts rather than any single one.
    expect(rows[0]!.observed).toBeGreaterThan(40);
    expect(rows[0]!.observed).toBeLessThan(75);
  });

  it("never says to call in the seat that cannot call", () => {
    const rng = mulberry32(31);
    for (let i = 0; i < 5000; i++) {
      const spot = dealSpot("pushfold", {}, rng);
      if (spot.kind === "pushfold" && spot.seat === "SB") {
        expect(correctAction(spot)).not.toBe("call");
      } else {
        expect(correctAction(spot)).not.toBe("raise");
      }
    }
  });
});
