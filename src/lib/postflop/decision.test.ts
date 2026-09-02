import { describe, expect, it } from "vitest";
import { aggregateStrategy, describeActions } from "./decision";
import { buildHandSet, weightsFromClasses } from "../solver/hands";
import { buildStreets } from "../solver/tree";
import { parseRange } from "../range";
import { intToCard, parseCards } from "../equity";
import { CLASS_COUNT, classIndexOf } from "../combos";
import { handClassOf } from "../cards";
import { RFI_BY_DEPTH } from "../charts/rfi";

const BETTING = { betSizes: [0.33, 0.75], raiseSizes: [1], maxBets: 2, allInSnap: 0.25 };

describe("naming actions", () => {
  const tree = buildStreets({ ...BETTING, startingPot: 5.5, effectiveStack: 97.5 }, []);

  it("names them with the sizes they actually are", () => {
    for (const node of tree.playerNodes) {
      const actions = describeActions(node);
      expect(actions.length).toBeGreaterThan(1);
      for (const action of actions) expect(action.label).not.toMatch(/NaN|undefined/);
    }
  });

  it("quotes a bet as what it adds and a raise as what it makes the total", () => {
    const root = tree.root;
    if (root.kind !== "player") throw new Error("expected a player node");
    const opening = describeActions(root);

    expect(opening[0]!.label).toBe("Check");
    // A third of a 5.5bb pot, to a tenth of a blind. Rounding it to a whole
    // number would quote a size the tree does not have.
    expect(opening[1]!.label).toBe("Bet 1.8");
    expect(opening[2]!.label).toBe("Bet 4.1");
  });

  it("prices a call by what it costs, not by what is already in", () => {
    const root = tree.root;
    if (root.kind !== "player") throw new Error("expected a player node");
    const facing = root.children[1]!;
    if (facing.kind !== "player") throw new Error("expected a player node");

    const actions = describeActions(facing);
    expect(actions.map((action) => action.kind)).toContain("call");
    expect(actions.find((action) => action.kind === "call")!.label).toBe("Call 1.8");
  });
});

describe("aggregating onto the grid", () => {
  const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2s"));
  const weights = weightsFromClasses(hands, parseRange(RFI_BY_DEPTH[100].BTN));

  /** Two actions: the first taken with every hand, the second with none. */
  const frequency = new Float64Array(2 * hands.count);
  for (let i = 0; i < hands.count; i++) frequency[i] = 1;

  it("covers all 169 cells and marks the empty ones", () => {
    const classes = aggregateStrategy(2, frequency, weights, hands);
    expect(classes.present).toHaveLength(CLASS_COUNT);
    expect(classes.present.filter(Boolean).length).toBeGreaterThan(20);
    expect(classes.present.filter((present) => !present).length).toBeGreaterThan(20);
  });

  it("keeps every occupied cell a distribution", () => {
    const classes = aggregateStrategy(2, frequency, weights, hands);
    for (let k = 0; k < CLASS_COUNT; k++) {
      if (!classes.present[k]) continue;
      let total = 0;
      for (let a = 0; a < 2; a++) total += classes.frequency[a * CLASS_COUNT + k]!;
      expect(total).toBeCloseTo(1, 9);
    }
  });

  it("weights a class by how much of it is actually in the range", () => {
    // Split the strategy so one combination of a class does something different
    // from the rest; the cell has to land between them rather than on either.
    const split = new Float64Array(2 * hands.count);
    let first = -1;
    for (let i = 0; i < hands.count; i++) {
      if (weights[i]! > 0 && first < 0) first = i;
      const takesFirst = i === first ? 0 : 1;
      split[i] = takesFirst;
      split[hands.count + i] = 1 - takesFirst;
    }

    const classes = aggregateStrategy(2, split, weights, hands);
    const cell = classIndexOfHand(hands, first);
    expect(classes.frequency[cell]).toBeGreaterThan(0);
    expect(classes.frequency[cell]).toBeLessThan(1);
  });
});

function classIndexOfHand(hands: ReturnType<typeof buildHandSet>, hand: number): number {
  return classIndexOf(handClassOf(intToCard(hands.cardA[hand]!), intToCard(hands.cardB[hand]!)));
}
