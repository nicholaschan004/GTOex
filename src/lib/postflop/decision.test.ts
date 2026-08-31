import { describe, expect, it } from "vitest";
import {
  aggregateToClasses,
  costOf,
  dealFrom,
  describeActions,
  isCloseEnough,
  solveDecision,
  solveStreet,
} from "./decision";
import { RIVER_BETTING, SPOTS, SPOTS_BY_ID, buildSpot } from "./spots";
import { buildHandSet, weightsFromClasses } from "../solver/hands";
import { buildTree } from "../solver/tree";
import { parseRange } from "../range";
import { parseCards } from "../equity";
import { CLASS_COUNT } from "../combos";
import { mulberry32 } from "../rng";

/** A river spot standing in for the ones a played hand reaches. */
function riverSpot(iterations = 120) {
  const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2s"));
  const ranges: [Float64Array, Float64Array] = [
    weightsFromClasses(hands, parseRange(SPOTS[0]!.oopRange)),
    weightsFromClasses(hands, parseRange(SPOTS[0]!.ipRange)),
  ];
  const tree = buildTree({ ...RIVER_BETTING, startingPot: 60, effectiveStack: 180 });
  const spot = {
    definition: SPOTS[0]!,
    hands,
    views: undefined,
    tree,
    ranges,
    node: tree.root as never,
  };
  return { spot, decision: solveDecision(spot, { iterations }) };
}

describe("the scenario catalogue", () => {
  it("builds every scenario, on a turn board, with both players holding something", () => {
    for (const definition of SPOTS) {
      const built = buildSpot(definition, { withViews: false });
      expect(definition.street).toBe("turn");
      expect(built.hands.board).toHaveLength(4);
      expect(built.hands.count).toBe(1128);
      for (const range of built.ranges) {
        expect([...range].filter((weight) => weight > 0).length).toBeGreaterThan(50);
      }
    }
  });

  it("has unique ids, since progress is keyed on them", () => {
    expect(SPOTS_BY_ID.size).toBe(SPOTS.length);
  });

  it("starts every hand where out of position acts", () => {
    for (const definition of SPOTS) {
      const built = buildSpot(definition, { withViews: false });
      expect(built.tree.root.kind).toBe("player");
    }
  });

  it("names actions with the sizes they actually are", () => {
    const { spot } = riverSpot(1);
    const actions = describeActions(spot.node);
    expect(actions.length).toBeGreaterThan(1);
    expect(actions[0]!.label).toMatch(/^(Check|Fold)$/);
    for (const action of actions) expect(action.label).not.toMatch(/NaN|undefined/);
  });
});

describe("solving a river", () => {
  const { spot, decision } = riverSpot();

  it("is fast enough to do mid-hand", () => {
    const started = Date.now();
    solveDecision(spot, { iterations: 120 });
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("returns a probability distribution per hand", () => {
    const count = decision.hands.length;
    expect(count).toBeGreaterThan(100);
    for (let i = 0; i < count; i++) {
      let total = 0;
      for (let a = 0; a < decision.actions.length; a++) {
        expect(decision.frequency[a * count + i]!).toBeGreaterThanOrEqual(0);
        total += decision.frequency[a * count + i]!;
      }
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("gets close to equilibrium", () => {
    expect(decision.exploitabilityPercent).toBeLessThan(0.5);
  });

  /**
   * The claim the whole postflop mode rests on. A hand bet 40% and checked 60%
   * has no right answer, so an action the solver plays with real frequency must
   * cost about nothing, or the scoring is measuring something other than what
   * it says on screen.
   */
  it("charges almost nothing for an action the solver genuinely mixes", () => {
    const count = decision.hands.length;
    let checked = 0;
    for (let i = 0; i < count; i++) {
      for (let a = 0; a < decision.actions.length; a++) {
        if (decision.frequency[a * count + i]! < 0.15) continue;
        checked++;
        expect(costOf(decision, a, i)).toBeLessThan(60 * 0.02);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("charges nothing for the best action, and never a negative amount", () => {
    const count = decision.hands.length;
    for (let i = 0; i < count; i += 7) {
      const costs = decision.actions.map((_, a) => costOf(decision, a, i));
      expect(Math.min(...costs)).toBeCloseTo(0, 9);
      for (const cost of costs) expect(cost).toBeGreaterThanOrEqual(0);
    }
  });

  it("deals hands in the proportion they arrive", () => {
    const rng = mulberry32(4);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(dealFrom(decision, rng));
    expect(seen.size).toBeGreaterThan(30);
  });
  // These solve real subgames and the suite runs several such files at once, so
  // the default five seconds is a coin flip rather than a threshold.
}, 120_000);

describe("solveStreet", () => {
  /**
   * Playing a hand out needs every node and every hand, not one node and the
   * hands that usually get there, because you are allowed to play badly:
   * betting a hand the solver never bets still has to leave the hand playable
   * at the node after the bet.
   */
  it("covers every node and every hand, from one solve", () => {
    const { spot } = riverSpot(1);
    const strategies = solveStreet(spot, { iterations: 40 });

    expect(strategies.size).toBe(spot.tree.playerNodes.length);
    for (const node of spot.tree.playerNodes) {
      const strategy = strategies.get(node.id)!;
      const expected = node.actions.length * spot.hands.count;
      expect(strategy.frequency).toHaveLength(expected);
      expect(strategy.ev).toHaveLength(expected);
      expect(strategy.player).toBe(node.player);
    }
  });

  it("gives every hand a distribution, including ones nobody would have here", () => {
    const { spot } = riverSpot(1);
    const strategies = solveStreet(spot, { iterations: 40 });
    const node = spot.tree.playerNodes[0]!;
    const strategy = strategies.get(node.id)!;

    for (let h = 0; h < spot.hands.count; h += 29) {
      let total = 0;
      for (let a = 0; a < node.actions.length; a++) {
        total += strategy.frequency[a * spot.hands.count + h]!;
      }
      expect(total).toBeCloseTo(1, 6);
    }
  });
}, 120_000);

describe("aggregating onto the grid", () => {
  const { spot, decision } = riverSpot(60);
  const classes = aggregateToClasses(decision, spot.hands);

  it("covers all 169 cells and marks the empty ones", () => {
    expect(classes.present).toHaveLength(CLASS_COUNT);
    expect(classes.present.filter(Boolean).length).toBeGreaterThan(20);
    expect(classes.present.filter((present) => !present).length).toBeGreaterThan(20);
  });

  it("keeps every occupied cell a distribution", () => {
    for (let k = 0; k < CLASS_COUNT; k++) {
      if (!classes.present[k]) continue;
      let total = 0;
      for (let a = 0; a < decision.actions.length; a++) total += classes.frequency[a * CLASS_COUNT + k]!;
      expect(total).toBeCloseTo(1, 6);
    }
  });
}, 120_000);

describe("isCloseEnough", () => {
  it("forgives what is inside the solve's own error and nothing more", () => {
    expect(isCloseEnough(0, 60)).toBe(true);
    expect(isCloseEnough(0.6, 60)).toBe(true);
    expect(isCloseEnough(0.61, 60)).toBe(false);
    expect(isCloseEnough(5, 60)).toBe(false);
  });
});
