import { describe, expect, it } from "vitest";
import { VS_OPEN_100BB, defendersAgainst } from "./vs-open";
import { RFI_POSITIONS, type Position, type RfiPosition } from "../positions";
import { parseRange } from "../range";
import { comboPercent, type HandClass } from "../cards";

interface Spot {
  opener: RfiPosition;
  defender: Position;
  threeBet: Set<HandClass>;
  call: Set<HandClass>;
  defend: Set<HandClass>;
}

const spots: Spot[] = [];
for (const opener of RFI_POSITIONS) {
  for (const defender of defendersAgainst(opener)) {
    const entry = VS_OPEN_100BB[opener][defender]!;
    const threeBet = parseRange(entry.threeBet);
    const call = parseRange(entry.call);
    spots.push({
      opener,
      defender,
      threeBet,
      call,
      defend: new Set([...threeBet, ...call]),
    });
  }
}

const spotFor = (opener: RfiPosition, defender: Position): Spot => {
  const found = spots.find((s) => s.opener === opener && s.defender === defender);
  if (!found) throw new Error(`No spot for ${defender} vs ${opener}`);
  return found;
};

describe("coverage", () => {
  it("has all fifteen opener and defender pairs", () => {
    expect(spots).toHaveLength(15);
  });

  it("only lists defenders who act after the opener", () => {
    const order = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
    for (const spot of spots) {
      expect(order.indexOf(spot.defender)).toBeGreaterThan(order.indexOf(spot.opener));
    }
  });
});

/**
 * The check the data format exists for. An overlapping hand would otherwise be
 * resolved silently by whichever range was consulted first, and the chart would
 * be teaching two different actions for the same holding.
 */
describe("three-bet and call never overlap", () => {
  for (const spot of spots) {
    it(`${spot.defender} vs ${spot.opener}`, () => {
      const both = [...spot.threeBet].filter((hand) => spot.call.has(hand));
      expect(both).toEqual([]);
    });
  }
});

describe("value hands are always three-bet", () => {
  for (const spot of spots) {
    it(`${spot.defender} vs ${spot.opener}`, () => {
      for (const hand of ["AA", "KK", "QQ", "AKs", "AKo"] as HandClass[]) {
        expect(spot.threeBet.has(hand)).toBe(true);
      }
    });
  }
});

describe("trash is always folded", () => {
  for (const spot of spots) {
    it(`${spot.defender} vs ${spot.opener}`, () => {
      for (const hand of ["72o", "83o", "94o", "32o"] as HandClass[]) {
        expect(spot.defend.has(hand)).toBe(false);
      }
    });
  }
});

describe("defending widens as the opener's seat gets later", () => {
  // The big blind faces every seat, so it is the one defender that gives a
  // clean read on how defence responds to the opener alone.
  it("the big blind defends more against each later opener", () => {
    const widths = RFI_POSITIONS.map((opener) =>
      comboPercent(spotFor(opener, "BB").defend),
    );
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    }
  });

  it("the button defends more against the cutoff than against under the gun", () => {
    expect(comboPercent(spotFor("CO", "BTN").defend)).toBeGreaterThan(
      comboPercent(spotFor("UTG", "BTN").defend),
    );
  });
});

describe("position and price shape the defence", () => {
  it("the big blind defends wider than the small blind against the same open", () => {
    for (const opener of ["UTG", "HJ", "CO", "BTN"] as RfiPosition[]) {
      expect(comboPercent(spotFor(opener, "BB").defend)).toBeGreaterThan(
        comboPercent(spotFor(opener, "SB").defend),
      );
    }
  });

  it("the small blind three-bets more of its defence than the big blind does", () => {
    for (const opener of ["UTG", "HJ", "CO", "BTN"] as RfiPosition[]) {
      const sb = spotFor(opener, "SB");
      const bb = spotFor(opener, "BB");
      const sbShare = comboPercent(sb.threeBet) / comboPercent(sb.defend);
      const bbShare = comboPercent(bb.threeBet) / comboPercent(bb.defend);
      expect(sbShare).toBeGreaterThan(bbShare);
    }
  });

  it("in position defends wider than the small blind against the same open", () => {
    expect(comboPercent(spotFor("UTG", "BTN").defend)).toBeGreaterThan(
      comboPercent(spotFor("UTG", "SB").defend),
    );
  });
});

describe("frequencies are sane", () => {
  for (const spot of spots) {
    it(`${spot.defender} vs ${spot.opener} defends a plausible share`, () => {
      const defend = comboPercent(spot.defend);
      expect(defend).toBeGreaterThan(3);
      expect(defend).toBeLessThan(60);
    });
  }

  it("nobody three-bets more than a fifth of all hands", () => {
    for (const spot of spots) {
      expect(comboPercent(spot.threeBet)).toBeLessThan(20);
    }
  });
});
