import { describe, expect, it } from "vitest";
import { FLOPS, FLOPS_BY_SCENARIO } from "../charts/flop.generated";
import { buildFlopShell, flopNodesByPath, loadFlop } from "./flop-data";
import { Hand } from "./hand";
import { SCENARIOS, SCENARIOS_BY_ID } from "./scenario";
import { mulberry32 } from "../rng";

/**
 * The generated flop data, checked against the scenarios it claims to be for.
 *
 * The tree the browser plays on is rebuilt from the scenario rather than
 * serialised, so a scenario edited without regenerating would line a strategy
 * up against the wrong hands and nothing would complain: the trainer would keep
 * working and keep pricing decisions against a board it was not solved for.
 * That is the failure this file exists to make loud.
 */
describe("the shipped flop data", () => {
  it("covers every scenario", () => {
    expect(FLOPS).toHaveLength(SCENARIOS.length);
    for (const scenario of SCENARIOS) expect(FLOPS_BY_SCENARIO.has(scenario.id)).toBe(true);
  });

  it("still matches the scenarios it was generated from", () => {
    for (const packed of FLOPS) {
      expect(() => loadFlop(packed)).not.toThrow();
      const shell = buildFlopShell(SCENARIOS_BY_ID.get(packed.scenarioId)!);
      expect(shell.hands.count).toBe(packed.handCount);
      expect(flopNodesByPath(shell.tree).size).toBe(packed.nodes.length);
    }
  });

  it("refuses data that no longer fits its scenario", () => {
    const packed = FLOPS[0]!;
    expect(() => loadFlop({ ...packed, handCount: 999 })).toThrow(/Regenerate/);
    expect(() => loadFlop({ ...packed, nodes: packed.nodes.slice(1) })).toThrow(/Regenerate/);
    expect(() =>
      loadFlop({ ...packed, nodes: [{ ...packed.nodes[0]!, path: "9,9,9" }, ...packed.nodes.slice(1)] }),
    ).toThrow(/Regenerate/);
  });

  /**
   * The bar the single street solves clear. A three street game is harder and
   * there was no guarantee it would, which is exactly why the number is
   * asserted here and printed on screen rather than described in a README.
   */
  it("was solved to under half a percent of pot", () => {
    for (const packed of FLOPS) {
      expect(packed.exploitabilityPercent).toBeGreaterThan(0);
      expect(packed.exploitabilityPercent).toBeLessThan(0.5);
    }
  });

  it("carries values where you decide and not where the opponent does", () => {
    for (const packed of FLOPS) {
      const loaded = loadFlop(packed);
      const byPath = flopNodesByPath(loaded.tree);
      for (const stored of packed.nodes) {
        const node = byPath.get(stored.path)!;
        if (node.player === loaded.seats.hero) expect(stored.ev).not.toBeNull();
        else expect(stored.ev).toBeNull();
      }
    }
  });

  it("gives every hand a distribution at every flop node", () => {
    for (const packed of FLOPS) {
      const loaded = loadFlop(packed);
      for (const [, node] of flopNodesByPath(loaded.tree)) {
        const strategy = loaded.strategies.get(node.id)!;
        const n = loaded.hands.count;
        for (let h = 0; h < n; h += 37) {
          let total = 0;
          for (let a = 0; a < node.actions.length; a++) total += strategy.frequency[a * n + h]!;
          // Quantised to a byte per action, so the sum is within a rounding step
          // of one rather than exactly one.
          expect(total).toBeGreaterThan(0.99);
          expect(total).toBeLessThan(1.01);
        }
      }
    }
  });
});

describe("playing the real thing", () => {
  it("reaches a result in every scenario, from either seat", async () => {
    for (const packed of FLOPS) {
      const source = loadFlop(packed);
      const rng = mulberry32(7);
      for (let i = 0; i < 2; i++) {
        const hand = new Hand(source, { rng, iterations: { turn: 4, river: 4 } });
        for (let step = 0; step < 16; step++) {
          const view = hand.view();
          if (view.finished || !view.choice) break;
          // Continue preflop, then take the aggressive line so the hand runs
          // long enough to reach the streets that get solved live.
          const at = view.street === "preflop" ? 1 : view.choice.actions.length - 1;
          await hand.act(at);
        }
        expect(hand.view().finished).toBe(true);
      }
    }
  });

  /**
   * The solver plays a mixed strategy, so a hand it bets 40% of the time has to
   * cost about nothing to bet, or the scoring is measuring something other than
   * what it says on screen.
   *
   * Over hands the range actually holds. Over hands it does not, the average
   * strategy is uniform rather than mixed -- CFR weights its average by how
   * often a hand arrived, and these never arrived -- so there is nothing there
   * to be close to. `Hand.priceable` is where that is handled; this is the
   * measurement it rests on.
   */
  it("charges almost nothing for an action the solver genuinely mixes", () => {
    for (const packed of FLOPS) {
      const loaded = loadFlop(packed);
      const n = loaded.hands.count;
      const own = loaded.ranges[loaded.seats.hero]!;
      const costs: number[] = [];

      for (const [, node] of flopNodesByPath(loaded.tree)) {
        if (node.player !== loaded.seats.hero) continue;
        const { frequency, ev } = loaded.strategies.get(node.id)!;

        for (let h = 0; h < n; h++) {
          if (own[h]! <= 0) continue;
          let best = -Infinity;
          for (let a = 0; a < node.actions.length; a++) best = Math.max(best, ev[a * n + h]!);
          for (let a = 0; a < node.actions.length; a++) {
            if (frequency[a * n + h]! < 0.2) continue;
            costs.push(best - ev[a * n + h]!);
          }
        }
      }

      expect(costs.length).toBeGreaterThan(100);
      const mean = costs.reduce((total, cost) => total + cost, 0) / costs.length;
      const tiny = costs.filter((cost) => cost < 0.02).length / costs.length;
      expect(mean).toBeLessThan(0.02);
      expect(tiny).toBeGreaterThan(0.9);
    }
  });

}, 120_000);
