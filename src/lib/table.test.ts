import { describe, expect, it } from "vitest";
import { describeTable, potOddsOf, tableFor, type TableView } from "./table";
import { DRILL_MODES, type Spot, dealSpot } from "./drill";
import { POSITIONS, RFI_POSITIONS, STACK_DEPTHS, type StackDepth } from "./positions";
import { PUSHFOLD_STACKS } from "./charts/pushfold.generated";
import { callingThreshold } from "./pushfold";
import { openSize, threeBetSize } from "./sizing";
import { mulberry32 } from "./rng";
import type { Card, HandClass } from "./cards";

const CARDS: [Card, Card] = ["Ah", "Kd"];
const HAND: HandClass = "AKo";

const rfi = (position: (typeof RFI_POSITIONS)[number], depth: StackDepth = 100): Spot => ({
  kind: "rfi",
  position,
  depth,
  cards: CARDS,
  hand: HAND,
});

const seatNamed = (view: TableView, position: string) => {
  const seat = view.seats.find((s) => s.position === position);
  if (!seat) throw new Error(`No ${position} at this table`);
  return seat;
};

describe("tableFor, generally", () => {
  it("seats the hero first, so the diagram can put you at the bottom", () => {
    const rng = mulberry32(11);
    for (const mode of DRILL_MODES.map((m) => m.id)) {
      for (let i = 0; i < 200; i++) {
        const view = tableFor(dealSpot(mode, {}, rng));
        expect(view.seats[0]?.role).toBe("hero");
        expect(view.seats.filter((seat) => seat.role === "hero")).toHaveLength(1);
      }
    }
  });

  it("always has exactly one dealer button", () => {
    const rng = mulberry32(12);
    for (const mode of DRILL_MODES.map((m) => m.id)) {
      for (let i = 0; i < 200; i++) {
        const view = tableFor(dealSpot(mode, {}, rng));
        expect(view.seats.filter((seat) => seat.dealer)).toHaveLength(1);
      }
    }
  });

  it("keeps the pot equal to the chips on the table", () => {
    const rng = mulberry32(13);
    for (const mode of DRILL_MODES.map((m) => m.id)) {
      for (let i = 0; i < 200; i++) {
        const view = tableFor(dealSpot(mode, {}, rng));
        const chips = view.seats.reduce((sum, seat) => sum + seat.committed, 0);
        expect(view.pot).toBeCloseTo(chips, 6);
        expect(view.pot).toBeGreaterThan(0);
      }
    }
  });

  // A folded seat that still shows a raise, or a hero that is somehow also the
  // raiser, would draw a table that cannot happen.
  it("never marks a seat as both the hero and the raiser", () => {
    const rng = mulberry32(14);
    for (const mode of DRILL_MODES.map((m) => m.id)) {
      for (let i = 0; i < 200; i++) {
        const view = tableFor(dealSpot(mode, {}, rng));
        expect(view.seats.filter((seat) => seat.role === "raiser").length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("opening spots", () => {
  it("folds everyone before you and leaves everyone after you to act", () => {
    const view = tableFor(rfi("CO"));
    expect(seatNamed(view, "UTG").role).toBe("folded");
    expect(seatNamed(view, "HJ").role).toBe("folded");
    expect(seatNamed(view, "CO").role).toBe("hero");
    expect(seatNamed(view, "BTN").role).toBe("waiting");
    expect(seatNamed(view, "SB").role).toBe("waiting");
    expect(seatNamed(view, "BB").role).toBe("waiting");
  });

  it("folds nobody under the gun", () => {
    const view = tableFor(rfi("UTG"));
    expect(view.seats.filter((seat) => seat.role === "folded")).toHaveLength(0);
    expect(view.seats.filter((seat) => seat.role === "waiting")).toHaveLength(5);
  });

  it("has only the blinds in, and nothing to call", () => {
    for (const position of RFI_POSITIONS) {
      for (const depth of STACK_DEPTHS) {
        const view = tableFor(rfi(position, depth));
        expect(view.pot).toBe(1.5);
        expect(view.toCall).toBe(0);
        expect(view.potOdds).toBeNull();
        expect(view.raiseTo).toBe(openSize(position, depth));
      }
    }
  });

  it("runs the seats clockwise from the hero", () => {
    // The button's neighbours to the left are the blinds, then the seats that
    // will be first to act on the next hand.
    const order = tableFor(rfi("BTN")).seats.map((seat) => seat.position);
    expect(order).toEqual(["BTN", "SB", "BB", "UTG", "HJ", "CO"]);
    expect(new Set(order).size).toBe(POSITIONS.length);
  });
});

describe("facing a raise", () => {
  const spot = (opener: (typeof RFI_POSITIONS)[number], position: (typeof POSITIONS)[number]): Spot => ({
    kind: "vs-open",
    opener,
    position,
    depth: 100,
    cards: CARDS,
    hand: HAND,
  });

  it("puts the open in front of the opener and folds the seats it passed", () => {
    const view = tableFor(spot("UTG", "BTN"));
    expect(seatNamed(view, "UTG").role).toBe("raiser");
    expect(seatNamed(view, "UTG").committed).toBe(2.5);
    expect(seatNamed(view, "HJ").role).toBe("folded");
    expect(seatNamed(view, "CO").role).toBe("folded");
    expect(seatNamed(view, "BTN").role).toBe("hero");
    expect(seatNamed(view, "SB").role).toBe("waiting");
    expect(view.pot).toBe(4);
    expect(view.toCall).toBe(2.5);
    expect(view.raiseTo).toBe(7.5);
  });

  it("counts the big blind's posted blind against the price of calling", () => {
    const view = tableFor(spot("BTN", "BB"));
    expect(seatNamed(view, "BB").committed).toBe(1);
    expect(view.toCall).toBe(1.5);
    expect(view.pot).toBe(4);
    expect(view.raiseTo).toBe(10);
  });

  // The small blind opening is the only spot where the raiser has a blind
  // already posted, and the raise replaces it rather than stacking on it.
  it("does not double-count the small blind's own open", () => {
    const view = tableFor(spot("SB", "BB"));
    expect(seatNamed(view, "SB").committed).toBe(3);
    expect(view.pot).toBe(4);
    expect(view.toCall).toBe(2);
    expect(view.raiseTo).toBe(threeBetSize("SB", "BB", 100));
  });

  it("quotes no pot odds, because the hand is not over", () => {
    const rng = mulberry32(15);
    for (let i = 0; i < 100; i++) {
      expect(tableFor(dealSpot("vs-open", {}, rng)).potOdds).toBeNull();
    }
  });
});

describe("push or fold", () => {
  const shoveSpot = (stack: (typeof PUSHFOLD_STACKS)[number]): Spot => ({
    kind: "pushfold",
    seat: "SB",
    stack,
    cards: CARDS,
    hand: HAND,
  });

  const callSpot = (stack: (typeof PUSHFOLD_STACKS)[number]): Spot => ({
    kind: "pushfold",
    seat: "BB",
    stack,
    cards: CARDS,
    hand: HAND,
  });

  it("seats two players and gives the button to the small blind", () => {
    const view = tableFor(shoveSpot(10));
    expect(view.seats).toHaveLength(2);
    expect(seatNamed(view, "SB").dealer).toBe(true);
    expect(seatNamed(view, "BB").dealer).toBe(false);
  });

  it("offers the stack when it is your shove, and no price", () => {
    const view = tableFor(shoveSpot(10));
    expect(view.raiseTo).toBe(10);
    expect(view.toCall).toBe(0);
    expect(view.potOdds).toBeNull();
    expect(view.pot).toBe(1.5);
  });

  it("charges the stack less your blind when you are facing the shove", () => {
    const view = tableFor(callSpot(10));
    expect(seatNamed(view, "SB").role).toBe("raiser");
    expect(seatNamed(view, "SB").committed).toBe(10);
    expect(view.raiseTo).toBeNull();
    expect(view.toCall).toBe(9);
    expect(view.pot).toBe(11);
  });

  /**
   * The load-bearing one. The pot odds shown next to the call button are worked
   * out from the chips on the table, while the solver's calling threshold comes
   * from the payoff algebra in pushfold.ts, (S-1)/2S. They are the same number
   * arrived at two ways, and if they ever stop agreeing then one of the two is
   * describing a different game to the one being drilled.
   */
  it("shows the same price the solver solved against, at every depth", () => {
    for (const stack of PUSHFOLD_STACKS) {
      const view = tableFor(callSpot(stack));
      expect(view.potOdds).not.toBeNull();
      expect(view.potOdds!).toBeCloseTo(callingThreshold(stack), 10);
    }
  });

  it("gets cheaper to call as the stack gets shorter", () => {
    const deep = tableFor(callSpot(20)).potOdds!;
    const shallow = tableFor(callSpot(5)).potOdds!;
    expect(shallow).toBeLessThan(deep);
    expect(tableFor(callSpot(10)).potOdds!).toBeCloseTo(0.45, 10);
  });
});

describe("potOddsOf", () => {
  it("is the call as a share of the pot it creates", () => {
    expect(potOddsOf(3, 1)).toBe(0.25);
    expect(potOddsOf(11, 9)).toBe(0.45);
  });
});

describe("describeTable", () => {
  it("names every seat, so the diagram is not the only way to read the table", () => {
    const view = tableFor(rfi("CO"));
    const text = describeTable(view);
    for (const position of POSITIONS) expect(text).toContain(position);
    expect(text).toContain("you");
    expect(text).toContain("Pot 1.5bb");
  });

  it("says what the raise was and what it costs", () => {
    const text = describeTable(
      tableFor({ kind: "vs-open", opener: "BTN", position: "BB", depth: 100, cards: CARDS, hand: HAND }),
    );
    expect(text).toContain("BTN raises to 2.5bb");
    expect(text).toContain("1.5bb to you");
  });

  it("never leaves a seat undescribed in any spot the trainer can deal", () => {
    const rng = mulberry32(16);
    for (const mode of DRILL_MODES.map((m) => m.id)) {
      for (let i = 0; i < 100; i++) {
        const view = tableFor(dealSpot(mode, {}, rng));
        const text = describeTable(view);
        expect(text).not.toContain("undefined");
        for (const seat of view.seats) expect(text).toContain(seat.position);
      }
    }
  });
});
