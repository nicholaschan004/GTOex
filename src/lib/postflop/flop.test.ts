import { describe, expect, it } from "vitest";
import { SCENARIOS, SCENARIOS_BY_ID, buildFlopGame, seatsOf } from "./scenario";
import { riverBuckets } from "./flop-solve";
import { solve } from "../solver/cfr";
import { buildStreets, countNodes, IP, OOP } from "../solver/tree";
import { riverChanceWeight } from "../solver/hands";
import { parseCards } from "../equity";

describe("the scenario catalogue", () => {
  it("has unique ids, since the shipped data is keyed on them", () => {
    expect(SCENARIOS_BY_ID.size).toBe(SCENARIOS.length);
  });

  it("builds every scenario, on a flop, with both players holding something", () => {
    for (const scenario of SCENARIOS) {
      expect(parseCards(scenario.flop)).toHaveLength(3);
      const game = buildFlopGame(scenario);

      expect(game.hands.board).toHaveLength(3);
      expect(game.turnCards).toHaveLength(49);
      expect(game.viewSets).toHaveLength(50);
      for (const set of game.viewSets.slice(1)) expect(set).toHaveLength(48);

      for (const range of game.ranges) {
        expect([...range].filter((weight) => weight > 0).length).toBeGreaterThan(100);
      }
    }
  });

  it("counts the preflop pot from the sizing rules rather than a table", () => {
    // The button opens to 2.5 and the big blind calls, so both have 2.5 in and
    // the small blind's half is dead. Stacks started at 100.
    const seats = seatsOf(SCENARIOS_BY_ID.get("bb-defends-two-tone")!);
    expect(seats.pot).toBeCloseTo(5.5, 9);
    expect(seats.stack).toBeCloseTo(97.5, 9);
    expect(seats.openTo).toBeCloseTo(2.5, 9);
  });

  it("seats the button in position and the big blind out of it", () => {
    const defending = seatsOf(SCENARIOS_BY_ID.get("bb-defends-two-tone")!);
    expect(defending.raiser).toBe(IP);
    expect(defending.hero).toBe(OOP);

    const opening = seatsOf(SCENARIOS_BY_ID.get("btn-opens-dry")!);
    expect(opening.raiser).toBe(IP);
    expect(opening.hero).toBe(IP);
  });

  it("gives the raiser the opening range and the defender the calling one", () => {
    const game = buildFlopGame(SCENARIOS_BY_ID.get("bb-defends-two-tone")!);
    let raiserCombos = 0;
    let defenderCombos = 0;
    for (let h = 0; h < game.hands.count; h++) {
      if (game.ranges[IP][h]! > 0) raiserCombos++;
      if (game.ranges[OOP][h]! > 0) defenderCombos++;
    }
    // A button opening range is wider than a big blind flat-calling one, which
    // is the asymmetry the whole scenario is about.
    expect(raiserCombos).toBeGreaterThan(defenderCombos);
  });
  // Building a scenario means 2,352 runout views over 520 hands, which is a
  // second and a half of real work per scenario rather than a slow test.
}, 120_000);

/**
 * The arithmetic check that matters most, and the same one the turn solver got.
 *
 * Take the betting away entirely. Neither player has a decision, so the game
 * has no strategy to get wrong and its exploitability has to be zero. Anything
 * else means a chance layer is masking the wrong hands, weighting them wrongly,
 * or handing a showdown the ranks from the wrong board -- and with two chance
 * layers there are twice as many ways to do that, none of which would announce
 * themselves. The solve would converge, to the wrong game.
 */
describe("three streets with nothing to decide", () => {
  it("leaves nothing on the table", () => {
    const game = buildFlopGame(SCENARIOS[0]!);
    const silent = {
      betSizes: [] as number[],
      raiseSizes: [] as number[],
      maxBets: 0,
      allInSnap: 0.25,
    };

    const tree = buildStreets(
      { ...silent, startingPot: game.seats.pot, effectiveStack: game.seats.stack },
      [
        {
          cards: 49,
          chanceWeight: riverChanceWeight(3),
          betting: silent,
          viewSet: () => 0,
        },
        {
          cards: 48,
          chanceWeight: riverChanceWeight(4),
          betting: silent,
          viewSet: (dealt) => 1 + dealt[0]!,
        },
      ],
    );

    // Two checks a street and no bets, so the only nodes are the ones that have
    // to exist for the street to close.
    expect(countNodes(tree).player).toBe(2 + 49 * 2 + 49 * 48 * 2);

    const solution = solve(tree, game.hands, game.ranges, {
      iterations: 2,
      viewSets: game.viewSets,
    });
    expect(Math.abs(solution.exploitability)).toBeLessThan(1e-9);
  });
}, 120_000);

describe("river bucketing", () => {
  const game = buildFlopGame(SCENARIOS[0]!);

  it("groups only the river, and leaves the flop and turn exact", () => {
    const bucketsFor = riverBuckets(game, 16);
    for (const node of game.tree.playerNodes) {
      const bucketing = bucketsFor(node);
      if (node.street === 2) {
        expect(bucketing).not.toBeNull();
        expect(bucketing!.count).toBeLessThanOrEqual(16);
        expect(bucketing!.map).toHaveLength(game.hands.count);
      } else {
        expect(bucketing).toBeNull();
      }
    }
  });

  /**
   * Two rivers are different boards and have to get different groupings, and
   * the two players are facing different ranges so they do too. Sharing either
   * would be a silent way to solve a game nobody described.
   */
  it("gives every river board and every seat its own grouping", () => {
    const bucketsFor = riverBuckets(game, 16);
    const rivers = game.tree.playerNodes.filter((node) => node.street === 2);

    const first = rivers.find((node) => node.viewSet === 1 && node.chanceIndex === 0)!;
    const otherRiver = rivers.find((node) => node.viewSet === 1 && node.chanceIndex === 5)!;
    const otherTurn = rivers.find((node) => node.viewSet === 9 && node.chanceIndex === 0)!;
    const otherSeat = rivers.find(
      (node) => node.viewSet === 1 && node.chanceIndex === 0 && node.player !== first.player,
    )!;

    const key = (node: (typeof rivers)[number]) => [...bucketsFor(node)!.map].join(",");
    expect(key(otherRiver)).not.toBe(key(first));
    expect(key(otherTurn)).not.toBe(key(first));
    expect(key(otherSeat)).not.toBe(key(first));
  });
}, 120_000);
