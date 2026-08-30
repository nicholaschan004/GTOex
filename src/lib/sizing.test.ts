import { describe, expect, it } from "vitest";
import {
  ALL_POSITIONS,
  POSTFLOP_ORDER,
  THREE_BET_IN_POSITION,
  THREE_BET_OUT_OF_POSITION,
  blindPostedBy,
  formatChips,
  inPositionOn,
  openSize,
  threeBetSize,
} from "./sizing";
import { POSITIONS, RFI_POSITIONS, STACK_DEPTHS } from "./positions";
import { VS_OPEN_100BB, defendersAgainst } from "./charts/vs-open";
import type { Position } from "./positions";

describe("POSTFLOP_ORDER", () => {
  // Two hand-written orderings of the same six seats is exactly the kind of
  // thing that drifts apart in a rename, and nothing else in the app would
  // notice: a missing seat would just come back as index -1, which compares as
  // "acts first" and silently makes that seat out of position against everyone.
  it("is a rearrangement of the preflop order, not a second list of seats", () => {
    expect([...POSTFLOP_ORDER].sort()).toEqual([...ALL_POSITIONS].sort());
    expect(POSTFLOP_ORDER).toHaveLength(POSITIONS.length);
  });

  it("puts the blinds first and the button last", () => {
    expect(POSTFLOP_ORDER[0]).toBe("SB");
    expect(POSTFLOP_ORDER[1]).toBe("BB");
    expect(POSTFLOP_ORDER[POSTFLOP_ORDER.length - 1]).toBe("BTN");
  });
});

describe("inPositionOn", () => {
  it("puts the button in position on every other seat", () => {
    for (const other of POSITIONS) {
      if (other === "BTN") continue;
      expect(inPositionOn("BTN", other)).toBe(true);
    }
  });

  it("puts the small blind out of position against every other seat", () => {
    for (const other of POSITIONS) {
      if (other === "SB") continue;
      expect(inPositionOn("SB", other)).toBe(false);
    }
  });

  // The one that reads wrong preflop and is right postflop: the big blind acts
  // last before the flop and second after it, so it has position on the small
  // blind and nobody else.
  it("puts the big blind in position on the small blind only", () => {
    expect(inPositionOn("BB", "SB")).toBe(true);
    for (const other of ["UTG", "HJ", "CO", "BTN"] as Position[]) {
      expect(inPositionOn("BB", other)).toBe(false);
    }
  });

  it("is antisymmetric", () => {
    for (const a of POSITIONS) {
      for (const b of POSITIONS) {
        if (a === b) continue;
        expect(inPositionOn(a, b)).toBe(!inPositionOn(b, a));
      }
    }
  });
});

describe("openSize", () => {
  it("opens larger from the small blind at every depth", () => {
    for (const depth of STACK_DEPTHS) {
      for (const position of RFI_POSITIONS) {
        if (position === "SB") continue;
        expect(openSize("SB", depth)).toBeGreaterThan(openSize(position, depth));
      }
    }
  });

  it("never opens for more than a raise, or for less than a call", () => {
    for (const depth of STACK_DEPTHS) {
      for (const position of RFI_POSITIONS) {
        const size = openSize(position, depth);
        expect(size).toBeGreaterThan(1);
        expect(size).toBeLessThan(depth / 4);
      }
    }
  });

  it("opens smaller at twenty big blinds than at a hundred", () => {
    for (const position of RFI_POSITIONS) {
      expect(openSize(position, 20)).toBeLessThan(openSize(position, 100));
    }
  });
});

describe("threeBetSize", () => {
  // Spot checks against the sizes these spots are conventionally played at.
  // Nothing here is derived from the rule under test, so if the rule changes
  // these have to be re-argued rather than re-run.
  it("lands on the conventional sizes", () => {
    expect(threeBetSize("BTN", "BB", 100)).toBe(10);
    expect(threeBetSize("BTN", "SB", 100)).toBe(10);
    expect(threeBetSize("CO", "BTN", 100)).toBe(7.5);
    expect(threeBetSize("UTG", "HJ", 100)).toBe(7.5);
    expect(threeBetSize("SB", "BB", 100)).toBe(9);
  });

  it("charges more out of position than in", () => {
    expect(THREE_BET_OUT_OF_POSITION).toBeGreaterThan(THREE_BET_IN_POSITION);
    // The button and the big blind both defend against a cutoff open, from
    // opposite sides of it, off the same open size.
    expect(threeBetSize("CO", "BB", 100)).toBeGreaterThan(threeBetSize("CO", "BTN", 100));
  });

  it("is a real raise in every spot the defending charts cover", () => {
    for (const opener of RFI_POSITIONS) {
      for (const defender of defendersAgainst(opener)) {
        const open = openSize(opener, 100);
        const size = threeBetSize(opener, defender, 100);
        expect(size).toBeGreaterThan(open * 2);
        expect(size).toBeLessThan(100 / 4);
      }
    }
  });

  it("covers every spot the defending charts define, and no others", () => {
    for (const opener of RFI_POSITIONS) {
      for (const defender of defendersAgainst(opener)) {
        expect(VS_OPEN_100BB[opener][defender]).toBeDefined();
        expect(Number.isFinite(threeBetSize(opener, defender, 100))).toBe(true);
      }
    }
  });
});

describe("blindPostedBy", () => {
  it("charges the blinds and nobody else", () => {
    expect(blindPostedBy("SB")).toBe(0.5);
    expect(blindPostedBy("BB")).toBe(1);
    for (const position of ["UTG", "HJ", "CO", "BTN"] as Position[]) {
      expect(blindPostedBy(position)).toBe(0);
    }
  });
});

describe("formatChips", () => {
  it("drops the trailing zero a fixed decimal would leave", () => {
    expect(formatChips(10)).toBe("10bb");
    expect(formatChips(2.5)).toBe("2.5bb");
    expect(formatChips(0.5)).toBe("0.5bb");
    // 2.5 * 3 in binary floating point is 7.5 exactly, but 0.1 + 0.2 style
    // drift is one multiplication away in a spot like this.
    expect(formatChips(7.500000000000001)).toBe("7.5bb");
  });
});
