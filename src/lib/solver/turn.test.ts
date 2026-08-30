import { describe, expect, it } from "vitest";
import { buildTurnSpot, solveTurn, storageEstimate } from "./turn";
import { buildRiverViews, buildHandSet, riverChanceWeight, weightsFromClasses } from "./hands";
import { countNodes, walk, DEFAULT_BETTING, type ChanceNode } from "./tree";
import { parseCards } from "../equity";
import { parseRange } from "../range";

const BOARD = parseCards("Ks Jc 9h 7d");
const CHECK_IT_DOWN = {
  turn: { ...DEFAULT_BETTING, startingPot: 20, effectiveStack: 80, maxBets: 0 },
  river: { ...DEFAULT_BETTING, maxBets: 0 },
};
const SMALL = {
  turn: { ...DEFAULT_BETTING, startingPot: 20, effectiveStack: 80, betSizes: [0.75], maxBets: 1 },
  river: { ...DEFAULT_BETTING, betSizes: [0.75], maxBets: 1 },
};

describe("river views", () => {
  const hands = buildHandSet(BOARD, false);
  const views = buildRiverViews(hands);

  it("has one for every card the board has not taken", () => {
    expect(views).toHaveLength(48);
    expect(new Set(views.map((view) => view.card)).size).toBe(48);
    for (const view of views) expect(BOARD).not.toContain(view.card);
  });

  it("kills exactly the hands holding the card that came", () => {
    for (const view of views) {
      // 48 live cards on a turn board, so the river pairs with the other 47.
      expect(view.blocked).toHaveLength(47);
      for (const hand of view.blocked) {
        expect([hands.cardA[hand], hands.cardB[hand]]).toContain(view.card);
      }
    }
  });

  it("keeps the turn's hand numbering rather than renumbering", () => {
    // The whole solve indexes by turn hand. If a view ever disagreed about
    // which hand index 400 was, reach vectors would silently mean different
    // things on different rivers.
    for (const view of views) {
      expect(view.rank).toHaveLength(hands.count);
      expect(view.byRank).toHaveLength(hands.count);
    }
  });

  it("sorts the dead hands into one group at the bottom", () => {
    const view = views[0]!;
    const dead = new Set(view.blocked);
    for (let i = 0; i < view.blocked.length; i++) {
      expect(dead.has(view.byRank[i]!)).toBe(true);
      expect(view.rank[view.byRank[i]!]).toBe(-1);
    }
    // And everything after them is live and in order.
    for (let i = view.blocked.length + 1; i < hands.count; i++) {
      expect(view.rank[view.byRank[i]!]!).toBeGreaterThanOrEqual(view.rank[view.byRank[i - 1]!]!);
    }
  });

  it("ranks a hand by the five card board it ends up on", () => {
    const hands5 = buildHandSet([...BOARD, views[0]!.card]);
    const view = views[0]!;
    for (let i = 0; i < 50; i++) {
      const hand = view.byRank[hands.count - 1 - i]!;
      const same = hands5.indexOf(hands.cardA[hand]!, hands.cardB[hand]!);
      expect(view.rank[hand]).toBe(hands5.rank[same]);
    }
  });

  it("refuses a board that is not a turn", () => {
    expect(() => buildRiverViews(buildHandSet(parseCards("Ks Jc 9h 7d 2c")))).toThrow(/four card/i);
  });
});

describe("the chance weight", () => {
  /**
   * Not one over forty eight. The dealer's deck has forty eight cards in it,
   * but four of them are already in the two players' hands, so conditional on
   * any pair of hands that can coexist there are forty four rivers left. Using
   * the dealer's count would quietly misprice every decision to see a card
   * against every decision to fold now.
   */
  it("counts the cards the players cannot see, not the ones the dealer holds", () => {
    expect(riverChanceWeight(4)).toBeCloseTo(1 / 44, 12);
    expect(1 / riverChanceWeight(4)).toBe(44);
  });
});

describe("the turn tree", () => {
  const spot = buildTurnSpot(BOARD, SMALL.turn, SMALL.river);

  it("deals every river at every point the turn betting can end", () => {
    const chances: ChanceNode[] = [];
    walk(spot.tree.root, (node) => {
      if (node.kind === "chance") chances.push(node);
    });

    expect(chances.length).toBeGreaterThan(0);
    for (const chance of chances) {
      expect(chance.children).toHaveLength(48);
      expect(chance.weight).toBeCloseTo(1 / 44, 12);
    }
  });

  it("marks the two streets apart, and which river each node is under", () => {
    for (const node of spot.tree.playerNodes) {
      if (node.street === 0) {
        expect(node.chanceIndex).toBe(-1);
      } else {
        expect(node.street).toBe(1);
        expect(node.chanceIndex).toBeGreaterThanOrEqual(0);
        expect(node.chanceIndex).toBeLessThan(48);
      }
    }
  });

  it("puts almost every decision on the river, which is where the cost is", () => {
    const turnNodes = spot.tree.playerNodes.filter((node) => node.street === 0).length;
    const riverNodes = spot.tree.playerNodes.filter((node) => node.street === 1).length;
    expect(riverNodes).toBeGreaterThan(turnNodes * 50);
  });

  it("carries the pot and the stack across the street", () => {
    // 20 in the middle, one 15 bet called on the turn, so the river starts with
    // 50 and 65 behind. The river's own payoffs then land on the same numbers
    // the two-street accounting needs.
    const spot2 = buildTurnSpot(
      BOARD,
      { ...DEFAULT_BETTING, startingPot: 20, effectiveStack: 80, betSizes: [0.75], maxBets: 1 },
      { ...DEFAULT_BETTING, betSizes: [0.75], maxBets: 1 },
    );
    const riverNodes = spot2.tree.playerNodes.filter((node) => node.street === 1);
    const biggest = Math.max(...riverNodes.flatMap((node) => node.actions.map((a) => a.to)));
    expect(biggest).toBeLessThanOrEqual(80);
  });

  it("reports what it will hold on to", () => {
    const bytes = storageEstimate(spot.tree, spot.hands.count);
    expect(bytes).toBeGreaterThan(1e6);
    // Bucketing every node to sixteen has to shrink it by roughly the ratio of
    // hands to buckets.
    const bucketed = storageEstimate(spot.tree, spot.hands.count, () => ({ count: 16 }));
    expect(bucketed).toBeLessThan(bytes / 50);
  });
});

describe("solving a turn", () => {
  /**
   * Nobody can bet on either street, so the game is check it down and the only
   * thing that happens is a river card and a showdown. With identical ranges
   * that is worth exactly nothing to either player, and there is no decision to
   * exploit. Anything other than zero here means the chance node's arithmetic
   * is wrong: the wrong weight, the wrong hands masked, or the blocked hands
   * not taken back out.
   */
  it("is exactly even when the whole game is a coin the two players share", () => {
    const spot = buildTurnSpot(BOARD, CHECK_IT_DOWN.turn, CHECK_IT_DOWN.river);
    const wide = new Float64Array(spot.hands.count).fill(1);
    const solution = solveTurn(spot, [wide, wide], { iterations: 3 });

    expect(countNodes(spot.tree).chance).toBe(1);
    expect(Math.abs(solution.exploitability)).toBeLessThan(1e-9);
  });

  it("converges on a real spot", () => {
    const spot = buildTurnSpot(BOARD, SMALL.turn, SMALL.river);
    const oop = weightsFromClasses(spot.hands, parseRange("22+, A2s+, K9s+, QTs+, JTs, AJo+, KQo"));
    const ip = weightsFromClasses(spot.hands, parseRange("22+, A2s+, K5s+, Q8s+, J9s+, ATo+, KJo+"));

    const brief = solveTurn(spot, [oop, ip], { iterations: 5 });
    const longer = solveTurn(spot, [oop, ip], { iterations: 40 });

    expect(longer.exploitability).toBeLessThan(brief.exploitability);
    expect(longer.exploitabilityPercent).toBeLessThan(1);
  }, 120_000);

  it("refuses a board that is not a turn", () => {
    expect(() => buildTurnSpot(parseCards("Ks Jc 9h"), SMALL.turn, SMALL.river)).toThrow(/four/i);
  });
});
