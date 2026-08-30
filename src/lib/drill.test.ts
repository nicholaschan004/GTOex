import { describe, expect, it } from "vitest";
import {
  DRILL_MODES,
  type DrillMode,
  type Spot,
  actionLabel,
  actionsFor,
  correctAction,
  dealSpot,
  foldedBefore,
  judge,
  layersFor,
  rfiRange,
  spotKey,
  spotLabel,
} from "./drill";
import { RFI_POSITIONS, STACK_DEPTHS } from "./positions";
import { mulberry32 } from "./rng";
import type { Card, HandClass } from "./cards";

const rfi = (position: (typeof RFI_POSITIONS)[number], cards: [Card, Card], hand: HandClass): Spot => ({
  kind: "rfi",
  position,
  depth: 100,
  cards,
  hand,
});

describe("dealSpot", () => {
  for (const mode of DRILL_MODES.map((m) => m.id)) {
    it(`produces a valid ${mode} spot every time`, () => {
      const rng = mulberry32(3);
      for (let i = 0; i < 500; i++) {
        const spot = dealSpot(mode, {}, rng);
        expect(spot.cards[0]).not.toBe(spot.cards[1]);
        expect(actionsFor(spot).length).toBeGreaterThanOrEqual(2);
        expect(layersFor(spot).length).toBeGreaterThanOrEqual(1);
      }
    });
  }

  it("honours a requested stack depth", () => {
    const rng = mulberry32(5);
    for (const depth of STACK_DEPTHS) {
      for (let i = 0; i < 50; i++) {
        const spot = dealSpot("rfi", { depth }, rng);
        expect(spot.kind).toBe("rfi");
        if (spot.kind === "rfi") expect(spot.depth).toBe(depth);
      }
    }
  });

  it("reaches every depth when none is requested", () => {
    const rng = mulberry32(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const spot = dealSpot("rfi", {}, rng);
      if (spot.kind === "rfi") seen.add(spot.depth);
    }
    expect(seen.size).toBe(STACK_DEPTHS.length);
  });

  it("only ever names a defender who acts after the opener", () => {
    const rng = mulberry32(11);
    const order = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
    for (let i = 0; i < 500; i++) {
      const spot = dealSpot("vs-open", {}, rng);
      if (spot.kind !== "vs-open") continue;
      expect(order.indexOf(spot.position)).toBeGreaterThan(order.indexOf(spot.opener));
    }
  });
});

/**
 * The action set is derived from the spot, not assumed. Offering a call when
 * nobody has bet would be offering an action that does not exist.
 */
describe("available actions", () => {
  it("has no call button when nobody has raised", () => {
    const rng = mulberry32(13);
    const spot = dealSpot("rfi", {}, rng);
    expect(actionsFor(spot)).toEqual(["fold", "raise"]);
    expect(actionLabel(spot, "raise")).toBe("Open");
  });

  it("adds the call once there is a raise to face", () => {
    const rng = mulberry32(17);
    const spot = dealSpot("vs-open", {}, rng);
    expect(actionsFor(spot)).toEqual(["fold", "call", "raise"]);
    expect(actionLabel(spot, "raise")).toBe("3-bet");
  });

  it("gives each push/fold seat only the decision it actually has", () => {
    const shove: Spot = { kind: "pushfold", seat: "SB", stack: 10, cards: ["Ah", "Kd"], hand: "AKo" };
    const facing: Spot = { kind: "pushfold", seat: "BB", stack: 10, cards: ["Ah", "Kd"], hand: "AKo" };
    expect(actionsFor(shove)).toEqual(["fold", "raise"]);
    expect(actionsFor(facing)).toEqual(["fold", "call"]);
    expect(actionLabel(shove, "raise")).toBe("All in");
  });
});

describe("correctAction", () => {
  it("opens aces from everywhere", () => {
    for (const position of RFI_POSITIONS) {
      expect(correctAction(rfi(position, ["Ah", "Ad"], "AA"))).toBe("raise");
    }
  });

  it("folds 72o from everywhere", () => {
    for (const position of RFI_POSITIONS) {
      expect(correctAction(rfi(position, ["7h", "2d"], "72o"))).toBe("fold");
    }
  });

  it("is position dependent in between", () => {
    // KJo is a button open and an under the gun fold. If this ever stops
    // being true the charts have collapsed into each other.
    expect(correctAction(rfi("UTG", ["Kh", "Jd"], "KJo"))).toBe("fold");
    expect(correctAction(rfi("BTN", ["Kh", "Jd"], "KJo"))).toBe("raise");
  });

  it("prefers the strongest action a hand qualifies for", () => {
    // Aces are in the 3-bet range, so they must not resolve to a call.
    const spot: Spot = {
      kind: "vs-open",
      opener: "UTG",
      position: "BB",
      depth: 100,
      cards: ["Ah", "Ad"],
      hand: "AA",
    };
    expect(correctAction(spot)).toBe("raise");
  });

  it("reads the solved charts for push/fold", () => {
    const short: Spot = { kind: "pushfold", seat: "SB", stack: 3, cards: ["9h", "6d"], hand: "96o" };
    const deep: Spot = { kind: "pushfold", seat: "SB", stack: 20, cards: ["9h", "6d"], hand: "96o" };
    expect(correctAction(short)).toBe("raise");
    expect(correctAction(deep)).toBe("fold");
  });
});

describe("judge", () => {
  const spot = rfi("UTG", ["Ah", "Ad"], "AA");

  it("marks the right answer correct", () => {
    expect(judge(spot, "raise")).toEqual({ correct: true, answered: "raise", best: "raise" });
  });

  it("marks the wrong answer incorrect and still reports the best", () => {
    expect(judge(spot, "fold")).toEqual({ correct: false, answered: "fold", best: "raise" });
  });
});

describe("identity", () => {
  it("keys the same situation the same way and different ones differently", () => {
    expect(spotKey(rfi("BTN", ["Ah", "Ad"], "AA"))).toBe("rfi:100:BTN");
    expect(spotKey(rfi("BTN", ["2h", "3d"], "32o"))).toBe("rfi:100:BTN");
    expect(spotKey(rfi("UTG", ["Ah", "Ad"], "AA"))).not.toBe(spotKey(rfi("BTN", ["Ah", "Ad"], "AA")));
  });

  it("separates depths, since they are different charts", () => {
    const shallow: Spot = { kind: "rfi", position: "BTN", depth: 20, cards: ["Ah", "Ad"], hand: "AA" };
    const deep: Spot = { kind: "rfi", position: "BTN", depth: 200, cards: ["Ah", "Ad"], hand: "AA" };
    expect(spotKey(shallow)).not.toBe(spotKey(deep));
  });

  it("labels spots readably", () => {
    expect(spotLabel(rfi("CO", ["Ah", "Ad"], "AA"))).toBe("CO open, 100bb");
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

  it("returns a different range per depth", () => {
    expect(rfiRange("BTN", 20)).not.toBe(rfiRange("BTN", 200));
    expect(rfiRange("BTN", 20).size).toBeLessThan(rfiRange("BTN", 200).size);
  });
});

describe("modes", () => {
  it("lists exactly the modes dealSpot understands", () => {
    const ids: DrillMode[] = ["rfi", "vs-open", "pushfold"];
    expect(DRILL_MODES.map((m) => m.id).sort()).toEqual([...ids].sort());
  });
});
