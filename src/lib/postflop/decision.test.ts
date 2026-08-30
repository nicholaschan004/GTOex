import { describe, expect, it } from "vitest";
import {
  aggregateToClasses,
  costOf,
  dealFrom,
  describeActions,
  isCloseEnough,
  packDecision,
  solveDecision,
  unpackDecision,
  type SolvedDecision,
} from "./decision";
import { SPOTS, SPOTS_BY_ID, buildSpot } from "./spots";
import { TURN_DECISIONS, TURN_DECISIONS_BY_SPOT } from "../charts/turn.generated";
import { CLASS_COUNT } from "../combos";
import { mulberry32 } from "../rng";

const river = SPOTS.filter((spot) => spot.street === "river");
const turn = SPOTS.filter((spot) => spot.street === "turn");

describe("the spot catalogue", () => {
  it("builds every spot, with the board the street calls for", () => {
    for (const definition of SPOTS) {
      const built = buildSpot(definition);
      expect(built.hands.board).toHaveLength(definition.street === "river" ? 5 : 4);
      expect(built.hands.count).toBe(definition.street === "river" ? 1081 : 1128);
      expect(built.node.player).toBe(definition.hero);
    }
  });

  it("gives both players a range the board leaves something of", () => {
    for (const definition of SPOTS) {
      const built = buildSpot(definition);
      for (const range of built.ranges) {
        const combos = [...range].filter((weight) => weight > 0).length;
        expect(combos).toBeGreaterThan(50);
      }
    }
  });

  it("has unique ids, since progress is keyed on them", () => {
    expect(SPOTS_BY_ID.size).toBe(SPOTS.length);
  });

  it("only builds a chance layer for the turn", () => {
    for (const definition of SPOTS) {
      const built = buildSpot(definition);
      if (definition.street === "turn") expect(built.views).toHaveLength(48);
      else expect(built.views).toBeUndefined();
    }
  });

  it("names the actions with the sizes they actually are", () => {
    const built = buildSpot(river[0]!);
    const actions = describeActions(built);
    expect(actions.length).toBeGreaterThan(1);
    expect(actions[0]!.label).toMatch(/^(Check|Fold)$/);
    for (const action of actions) expect(action.label).not.toMatch(/NaN|undefined/);
  });
});

describe("solving a river spot", () => {
  const built = buildSpot(river[0]!);
  const decision = solveDecision(built, { iterations: 120 });

  it("is fast enough to do while someone reads their cards", () => {
    const started = Date.now();
    solveDecision(built, { iterations: 120 });
    // Generous, because a test machine is not a user's machine. The point is
    // that it is a fraction of a second and not a fraction of a minute.
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("returns a probability distribution per hand", () => {
    const count = decision.hands.length;
    expect(count).toBeGreaterThan(100);
    for (let i = 0; i < count; i++) {
      let total = 0;
      for (let a = 0; a < decision.actions.length; a++) {
        const share = decision.frequency[a * count + i]!;
        expect(share).toBeGreaterThanOrEqual(0);
        total += share;
      }
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("only offers hands the hero can actually hold here", () => {
    for (const hand of decision.hands) {
      expect(built.ranges[built.definition.hero]![hand]!).toBeGreaterThan(0);
    }
  });

  it("gets close to equilibrium", () => {
    expect(decision.exploitabilityPercent).toBeLessThan(0.5);
  });

  /**
   * The claim the whole postflop drill rests on. A hand that is bet 40% and
   * checked 60% is not a hand with a right answer, and an action the solver
   * plays with real frequency has to cost about nothing, or the scoring is
   * measuring something other than what it says.
   */
  it("charges almost nothing for an action the solver genuinely mixes", () => {
    const count = decision.hands.length;
    let checked = 0;

    for (let i = 0; i < count; i++) {
      for (let a = 0; a < decision.actions.length; a++) {
        if (decision.frequency[a * count + i]! < 0.15) continue;
        checked++;
        expect(costOf(decision, a, i)).toBeLessThan(built.definition.pot * 0.02);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("charges nothing at all for the best action, and never a negative amount", () => {
    const count = decision.hands.length;
    for (let i = 0; i < count; i += 7) {
      const costs = decision.actions.map((_, a) => costOf(decision, a, i));
      expect(Math.min(...costs)).toBeCloseTo(0, 9);
      for (const cost of costs) expect(cost).toBeGreaterThanOrEqual(0);
    }
  });

  it("deals in the proportion hands arrive, and only hands that do", () => {
    const rng = mulberry32(4);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const index = dealFrom(decision, rng);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(decision.hands.length);
      seen.add(index);
    }
    expect(seen.size).toBeGreaterThan(30);
  });
});

describe("aggregating onto the grid", () => {
  const built = buildSpot(river[0]!);
  const decision = solveDecision(built, { iterations: 60 });
  const classes = aggregateToClasses(decision, built.hands);

  it("covers all 169 cells and marks the ones with nothing in them", () => {
    expect(classes.present).toHaveLength(CLASS_COUNT);
    expect(classes.frequency).toHaveLength(CLASS_COUNT * decision.actions.length);
    expect(classes.present.filter(Boolean).length).toBeGreaterThan(20);
    expect(classes.present.filter((p) => !p).length).toBeGreaterThan(20);
  });

  it("keeps every occupied cell a distribution", () => {
    for (let k = 0; k < CLASS_COUNT; k++) {
      if (!classes.present[k]) continue;
      let total = 0;
      for (let a = 0; a < decision.actions.length; a++) {
        total += classes.frequency[a * CLASS_COUNT + k]!;
      }
      expect(total).toBeCloseTo(1, 6);
    }
  });
});

describe("packing", () => {
  const built = buildSpot(river[0]!);
  const original = solveDecision(built, { iterations: 60 });
  const restored = unpackDecision(packDecision(original));

  it("round-trips the hands and the actions exactly", () => {
    expect([...restored.hands]).toEqual([...original.hands]);
    expect(restored.actions).toEqual(original.actions);
    expect(restored.spotId).toBe(original.spotId);
  });

  it("keeps frequencies within a 255th, which is finer than anyone can play", () => {
    for (let i = 0; i < original.frequency.length; i++) {
      expect(restored.frequency[i]!).toBeCloseTo(original.frequency[i]!, 2);
    }
  });

  /**
   * Expected values get sixteen bits because the number that matters is the
   * difference between two of them, and that difference is often a fraction of
   * a chip. One byte would put the quantisation step at about the size of the
   * thing being measured.
   */
  it("keeps expected values fine enough for the difference between two to survive", () => {
    const span = Math.max(...original.ev) - Math.min(...original.ev);
    for (let i = 0; i < original.ev.length; i += 13) {
      expect(Math.abs(restored.ev[i]! - original.ev[i]!)).toBeLessThan(span / 10000);
    }
  });

  it("preserves which action is best, for every hand", () => {
    const count = original.hands.length;
    for (let i = 0; i < count; i++) {
      const bestOriginal = argmax(original, i, count);
      const bestRestored = argmax(restored, i, count);
      // Ties can swap harmlessly, so compare the value rather than the index.
      expect(original.ev[bestRestored * count + i]!).toBeCloseTo(
        original.ev[bestOriginal * count + i]!,
        3,
      );
    }
  });
});

function argmax(decision: SolvedDecision, index: number, count: number): number {
  let best = 0;
  for (let a = 1; a < decision.actions.length; a++) {
    if (decision.ev[a * count + index]! > decision.ev[best * count + index]!) best = a;
  }
  return best;
}

describe("the shipped turn data", () => {
  it("covers every turn spot and nothing else", () => {
    expect(TURN_DECISIONS).toHaveLength(turn.length);
    for (const definition of turn) {
      expect(TURN_DECISIONS_BY_SPOT.has(definition.id)).toBe(true);
    }
  });

  /**
   * The generated file is committed, and a spot definition can be edited
   * without anyone remembering to regenerate it. That would leave the drill
   * quietly asking about one board and scoring against another, so the shape
   * is checked against the definition it claims to be for.
   */
  it("still matches the spots it was generated from", () => {
    for (const definition of turn) {
      const packed = TURN_DECISIONS_BY_SPOT.get(definition.id)!;
      const built = buildSpot(definition);
      const decision = unpackDecision(packed);

      expect(decision.actions).toEqual(describeActions(built));
      for (const hand of decision.hands) {
        expect(hand).toBeLessThan(built.hands.count);
        expect(built.ranges[definition.hero]![hand]!).toBeGreaterThan(0);
      }
    }
  });

  it("was solved to something worth calling solved", () => {
    for (const packed of TURN_DECISIONS) {
      expect(packed.exploitabilityPercent).toBeLessThan(0.5);
      expect(packed.exploitabilityPercent).toBeGreaterThanOrEqual(0);
    }
  });

  it("unpacks into usable distributions", () => {
    for (const packed of TURN_DECISIONS) {
      const decision = unpackDecision(packed);
      const count = decision.hands.length;
      expect(count).toBeGreaterThan(100);

      for (let i = 0; i < count; i += 5) {
        let total = 0;
        for (let a = 0; a < decision.actions.length; a++) total += decision.frequency[a * count + i]!;
        expect(total).toBeCloseTo(1, 1);
        expect(costOf(decision, 0, i)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("isCloseEnough", () => {
  it("forgives what is inside the solve's own error and nothing more", () => {
    expect(isCloseEnough(0, 60)).toBe(true);
    expect(isCloseEnough(0.5, 60)).toBe(true);
    expect(isCloseEnough(0.6, 60)).toBe(true);
    expect(isCloseEnough(0.61, 60)).toBe(false);
    expect(isCloseEnough(5, 60)).toBe(false);
  });
});
