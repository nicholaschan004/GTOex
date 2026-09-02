import { describe, expect, it } from "vitest";
import { buildHandSet, buildRunoutViews, compactToLive, deckAfter, weightsFromClasses } from "./hands";
import { buildStreets, countNodes, walk, type BettingConfig, type TreeNode } from "./tree";
import { solve } from "./cfr";
import { parseCards } from "../equity";
import { parseRange } from "../range";
import { RFI_BY_DEPTH } from "../charts/rfi";
import { VS_OPEN_100BB } from "../charts/vs-open";

const BETTING: Omit<BettingConfig, "startingPot" | "effectiveStack"> = {
  betSizes: [0.75],
  raiseSizes: [],
  maxBets: 1,
  allInSnap: 0.25,
};

/** A three street tree with a handful of cards a street, so it stays inspectable. */
function threeStreets(effectiveStack: number) {
  return buildStreets({ ...BETTING, startingPot: 10, effectiveStack }, [
    { cards: 3, chanceWeight: 1 / 3, betting: BETTING, viewSet: () => 0 },
    { cards: 2, chanceWeight: 1 / 2, betting: BETTING, viewSet: (dealt) => 1 + dealt[0]! },
  ]);
}

describe("a three street tree", () => {
  const tree = threeStreets(100);

  it("covers three betting rounds", () => {
    expect(tree.streets).toBe(3);
    const streets = new Set(tree.playerNodes.map((node) => node.street));
    expect([...streets].sort()).toEqual([0, 1, 2]);
  });

  it("names the board a node sits on with the view set and the chance index", () => {
    for (const node of tree.playerNodes) {
      if (node.street === 0) {
        expect(node.viewSet).toBe(-1);
        expect(node.chanceIndex).toBe(-1);
      }
      // The turn layer is one set of cards, so every turn node reads set zero.
      if (node.street === 1) {
        expect(node.viewSet).toBe(0);
        expect(node.chanceIndex).toBeGreaterThanOrEqual(0);
        expect(node.chanceIndex).toBeLessThan(3);
      }
      // The river layer has a set per turn card, which is the whole point of
      // carrying a view set at all: chance index 1 under turn 0 and chance
      // index 1 under turn 2 are different boards.
      if (node.street === 2) {
        expect(node.viewSet).toBeGreaterThanOrEqual(1);
        expect(node.viewSet).toBeLessThanOrEqual(3);
        expect(node.chanceIndex).toBeLessThan(2);
      }
    }
  });

  /**
   * The turn views of a flop solve carry no ranks, because a four card board has
   * no showdown. That is only safe if no showdown ever sits directly under the
   * turn layer, which is a property of the builder rather than of the caller.
   */
  it("never shows a hand down before the board has run out", () => {
    function check(node: TreeNode, chanceLayersAbove: number): void {
      if (node.kind === "showdown") {
        expect(chanceLayersAbove).toBe(2);
        return;
      }
      if (node.kind === "fold") return;
      const deeper = node.kind === "chance" ? chanceLayersAbove + 1 : chanceLayersAbove;
      for (const child of node.children) check(child, deeper);
    }
    check(tree.root, 0);
  });

  /**
   * The accounting has to telescope. A showdown pays half the dead money plus
   * everything the loser put in, and the loser put in the same as the winner to
   * get there, so betting the same fraction on all three streets has to arrive
   * at a number the caller can predict on paper.
   */
  it("pays a showdown what three streets of betting are worth", () => {
    let deepest = 0;
    walk(tree.root, (node) => {
      if (node.kind === "showdown") deepest = Math.max(deepest, node.amount);
    });

    // Bet 75% of 10 into 10, called: 7.5 each, pot 25. Then 18.75 each, pot
    // 62.5. Then 46.875 each. Half the original pot plus every chip the loser
    // put in.
    expect(deepest).toBeCloseTo(10 / 2 + 7.5 + 18.75 + 46.875, 6);
  });

  /**
   * Two chips behind against a ten chip pot, so a flop bet is the whole stack.
   * That line has no betting left, but the board still has to run out: two
   * chance layers with showdowns underneath, not one showdown standing in for
   * both cards.
   */
  it("runs the board out when the money goes in early", () => {
    const shallow = threeStreets(2);
    const root = shallow.root;
    if (root.kind !== "player") throw new Error("expected a player node");

    const bet = root.actions.findIndex((action) => action.kind === "bet");
    expect(bet).toBeGreaterThanOrEqual(0);
    const facing = root.children[bet]!;
    if (facing.kind !== "player") throw new Error("expected a player node");

    const called = facing.children[facing.actions.findIndex((a) => a.kind === "call")]!;
    expect(called.kind).toBe("chance");
    if (called.kind !== "chance") return;

    for (const turn of called.children) {
      expect(turn.kind).toBe("chance");
      if (turn.kind !== "chance") continue;
      for (const river of turn.children) expect(river.kind).toBe("showdown");
    }

    // The checked-through line still has money behind, so it does keep betting.
    expect(shallow.playerNodes.some((node) => node.street > 0)).toBe(true);
  });

  it("is the size the card counts imply", () => {
    const nodes = countNodes(tree);
    // 4 flop nodes; 3 street endings x 3 turns, 4 nodes each; then each of
    // those 9 turn rounds ends 3 ways x 2 rivers, 4 nodes each.
    expect(nodes.player).toBe(4 + 3 * 3 * 4 + 3 * 3 * 3 * 2 * 4);
  });
});

describe("runout views", () => {
  const flop = parseCards("Ks Jc 9h");
  const hands = buildHandSet(flop, false);

  it("deals every card the board has not taken", () => {
    expect(buildRunoutViews(hands)).toHaveLength(49);
    expect(buildRunoutViews(hands, [flop[0]! === 0 ? 1 : 0])).toHaveLength(48);
  });

  it("leaves the turn layer unranked, since a four card board has no showdown", () => {
    const turns = buildRunoutViews(hands);
    expect([...turns[0]!.rank].every((rank) => rank === 0)).toBe(true);
  });

  /**
   * The check that matters. A river view under a turn card has to rank hands
   * exactly as a hand set built on that five card board would, or the whole
   * solve is scoring the wrong showdowns.
   */
  it("ranks a river the same way a five card board does", () => {
    const turn = deckAfter(flop)[7]!;
    const rivers = buildRunoutViews(hands, [turn]);
    const view = rivers[11]!;
    const direct = buildHandSet([...flop, turn, view.card]);

    let compared = 0;
    for (let h = 0; h < hands.count; h++) {
      const a = hands.cardA[h]!;
      const b = hands.cardB[h]!;
      if (a === turn || b === turn || a === view.card || b === view.card) {
        expect(view.rank[h]).toBe(-1);
        continue;
      }
      expect(view.rank[h]).toBe(direct.rank[direct.indexOf(a, b)!]);
      compared++;
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("blocks the hands holding the card that came", () => {
    const turns = buildRunoutViews(hands);
    for (const view of turns) {
      for (const hand of view.blocked) {
        expect([hands.cardA[hand], hands.cardB[hand]]).toContain(view.card);
      }
    }
  });

  it("refuses a board that is already complete", () => {
    expect(() => buildRunoutViews(buildHandSet(parseCards("Ks Jc 9h 7d")), [0])).toThrow(
      /at most four/i,
    );
  });
});

/**
 * Compaction is claimed to be exact rather than an approximation, so the test
 * is not that it is close. It is that the solve comes back with the same
 * answer.
 */
describe("compacting to the hands anyone holds", () => {
  const board = parseCards("Ks Jc 9h 7d");
  const hands = buildHandSet(board);
  const ranges: [Float64Array, Float64Array] = [
    weightsFromClasses(hands, parseRange(VS_OPEN_100BB.BTN.BB!.call)),
    weightsFromClasses(hands, parseRange(RFI_BY_DEPTH[100].BTN)),
  ];
  const compact = compactToLive(hands, ranges);

  it("drops the hands neither player can hold, and only those", () => {
    expect(compact.hands.count).toBeLessThan(hands.count);
    for (let h = 0; h < hands.count; h++) {
      const kept = compact.hands.indexOf(hands.cardA[h]!, hands.cardB[h]!) >= 0;
      expect(kept).toBe(ranges[0][h]! > 0 || ranges[1][h]! > 0);
    }
  });

  it("keeps the weights lined up with the hands", () => {
    for (let i = 0; i < compact.hands.count; i++) {
      const source = compact.source[i]!;
      expect(compact.hands.cardA[i]).toBe(hands.cardA[source]);
      expect(compact.hands.cardB[i]).toBe(hands.cardB[source]);
      expect(compact.ranges[0][i]).toBe(ranges[0][source]);
      expect(compact.ranges[1][i]).toBe(ranges[1][source]);
    }
  });

  it("keeps a hand nobody holds when asked, so a misplayed hand stays playable", () => {
    const stray = [...Array(hands.count).keys()].find(
      (h) => ranges[0][h] === 0 && ranges[1][h] === 0,
    )!;
    const withStray = compactToLive(hands, ranges, { keep: [stray] });
    expect(withStray.hands.count).toBe(compact.hands.count + 1);
    expect(withStray.hands.indexOf(hands.cardA[stray]!, hands.cardB[stray]!)).toBeGreaterThanOrEqual(0);
  });

  it("solves to the same answer as the full hand set", () => {
    const tree = buildStreets({ ...BETTING, startingPot: 40, effectiveStack: 130 }, []);
    const full = solve(tree, hands, ranges, { iterations: 60 });
    const small = solve(tree, compact.hands, compact.ranges, { iterations: 60 });

    expect(small.exploitability).toBeCloseTo(full.exploitability, 9);

    const node = tree.playerNodes[tree.playerNodes.length - 1]!;
    const fullStrategy = full.strategyAt(node);
    const smallStrategy = small.strategyAt(node);
    for (let i = 0; i < compact.hands.count; i++) {
      for (let a = 0; a < node.actions.length; a++) {
        expect(smallStrategy[a * compact.hands.count + i]).toBeCloseTo(
          fullStrategy[a * hands.count + compact.source[i]!]!,
          9,
        );
      }
    }
  });
});
