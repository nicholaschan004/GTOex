import { describe, expect, it } from "vitest";
import { solveRiver } from "./cfr";
import { buildHandSet } from "./hands";
import {
  DEFAULT_BETTING,
  IP,
  OOP,
  buildTree,
  type PlayerNode,
  type Tree,
} from "./tree";
import { cardToInt, parseCards } from "../equity";
import type { Card } from "../cards";

const BOARD = parseCards("Ks Jc 9h 7d 2c");
const hands = buildHandSet(BOARD);
const at = (a: Card, b: Card) => hands.indexOf(cardToInt(a), cardToInt(b));

function rangeOf(combos: readonly (readonly [Card, Card])[]): Float64Array {
  const out = new Float64Array(hands.count);
  for (const [a, b] of combos) {
    const index = at(a, b);
    if (index < 0) throw new Error(`${a}${b} is not live on this board`);
    out[index] = 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The textbook polarised river game
//
// Board Ks Jc 9h 7d 2c. Out of position holds either QT, which makes the nut
// straight, or 54, which makes nothing at all. In position holds trip nines,
// which beats the air and loses to the straight, and can therefore do nothing
// but guess. Nobody blocks anybody: QT, 54 and 99 share no cards.
//
// With a pot of 100 and a single pot-sized bet, the equilibrium is on paper:
//
//   the bettor's air must make up B/(P+2B) = 1/3 of its betting range, or the
//   bluff-catcher would have a profitable pure call or a profitable pure fold
//
//   the bluff-catcher must fold B/(P+B) = 1/2, or bluffing every hand would be
//   free money
//
// Four value combos to eight air combos means bluffing exactly two of the eight,
// which is 25% of the air. Nothing in the solver knows any of that.
// ---------------------------------------------------------------------------

const NUT_COMBOS = [
  ["Qs", "Ts"],
  ["Qh", "Th"],
  ["Qd", "Td"],
  ["Qc", "Tc"],
] as const;

const AIR_COMBOS = [
  ["5s", "4s"],
  ["5h", "4h"],
  ["5d", "4d"],
  ["5c", "4c"],
  ["5s", "4h"],
  ["5h", "4s"],
  ["5d", "4c"],
  ["5c", "4d"],
] as const;

const CATCHER_COMBOS = [
  ["9s", "9c"],
  ["9s", "9d"],
  ["9c", "9d"],
] as const;

/**
 * The textbook game as a tree, written out rather than generated.
 *
 * The tree builder would also let the bluff-catcher bet after a check, which is
 * a perfectly good game but not the one with a known answer. Writing the two
 * nodes by hand keeps the comparison against the paper honest.
 */
function polarisedTree(): { tree: Tree; root: PlayerNode; response: PlayerNode } {
  const response: PlayerNode = {
    kind: "player",
    player: IP,
    id: 1,
    street: 0,
    chanceIndex: -1,
    viewSet: -1,
    actions: [
      { kind: "fold", to: 0 },
      { kind: "call", to: 100 },
    ],
    children: [
      { kind: "fold", winner: OOP, amount: 50 },
      { kind: "showdown", amount: 150 },
    ],
  };
  const root: PlayerNode = {
    kind: "player",
    player: OOP,
    id: 0,
    street: 0,
    chanceIndex: -1,
    viewSet: -1,
    actions: [
      { kind: "check", to: 0 },
      { kind: "bet", to: 100 },
    ],
    children: [{ kind: "showdown", amount: 50 }, response],
  };
  return {
    tree: {
      root,
      config: { ...DEFAULT_BETTING, startingPot: 100, effectiveStack: 100 },
      playerNodes: [root, response],
      streets: 1,
    },
    root,
    response,
  };
}

describe("the polarised river game", () => {
  const { tree, root, response } = polarisedTree();
  const oop = new Float64Array(hands.count);
  for (const [a, b] of [...NUT_COMBOS, ...AIR_COMBOS]) oop[at(a, b)] = 1;
  const solution = solveRiver(tree, hands, [oop, rangeOf(CATCHER_COMBOS)], { iterations: 1500 });

  const n = hands.count;
  const frequency = (
    node: PlayerNode,
    action: number,
    combos: readonly (readonly [Card, Card])[],
  ) => {
    const strategy = solution.strategyAt(node);
    let total = 0;
    for (const [a, b] of combos) total += strategy[action * n + at(a, b)]!;
    return total / combos.length;
  };

  it("bets the nuts every time", () => {
    expect(frequency(root, 1, NUT_COMBOS)).toBeGreaterThan(0.99);
  });

  it("bluffs a quarter of its air, making bluffs a third of the bets", () => {
    const bluffRate = frequency(root, 1, AIR_COMBOS);
    expect(bluffRate).toBeCloseTo(0.25, 2);

    const bluffs = bluffRate * AIR_COMBOS.length;
    const values = frequency(root, 1, NUT_COMBOS) * NUT_COMBOS.length;
    expect(bluffs / (bluffs + values)).toBeCloseTo(1 / 3, 2);
  });

  it("calls with half of the bluff-catchers", () => {
    expect(frequency(response, 1, CATCHER_COMBOS)).toBeCloseTo(0.5, 2);
  });

  it("finds an equilibrium, not just a plausible strategy", () => {
    expect(solution.exploitabilityPercent).toBeLessThan(0.05);
  });
});

describe("solving a real subgame", () => {
  const tree = buildTree({ ...DEFAULT_BETTING, startingPot: 20, effectiveStack: 80 });
  const wide = new Float64Array(hands.count).fill(1);
  const solution = solveRiver(tree, hands, [wide, wide], { iterations: 300 });

  it("gets under half a percent of pot exploitable, over all 1081 hands", () => {
    expect(solution.exploitabilityPercent).toBeLessThan(0.5);
  });

  it("never reports a negative exploitability", () => {
    // A best response cannot do worse than the strategy it is responding to, so
    // a negative number here would mean the best response search is broken
    // rather than that the solution is unusually good.
    expect(solution.exploitability).toBeGreaterThanOrEqual(0);
  });

  it("returns a probability distribution for every hand at every node", () => {
    const n = hands.count;
    for (const node of tree.playerNodes) {
      const strategy = solution.strategyAt(node);
      const actions = node.actions.length;
      for (let h = 0; h < n; h++) {
        let total = 0;
        for (let a = 0; a < actions; a++) {
          const weight = strategy[a * n + h]!;
          expect(weight).toBeGreaterThanOrEqual(0);
          total += weight;
        }
        expect(total).toBeCloseTo(1, 9);
      }
    }
  });

  it("converges: more iterations leave less on the table", () => {
    const brief = solveRiver(tree, hands, [wide, wide], { iterations: 20 });
    const longer = solveRiver(tree, hands, [wide, wide], { iterations: 300 });
    expect(longer.exploitability).toBeLessThan(brief.exploitability);
  });
}, 60_000);

describe("degenerate spots", () => {
  it("is exactly unexploitable when there is nothing to decide", () => {
    // No bets allowed, so the whole game is check, check, showdown.
    const tree = buildTree({ ...DEFAULT_BETTING, maxBets: 0 });
    const wide = new Float64Array(hands.count).fill(1);
    const solution = solveRiver(tree, hands, [wide, wide], { iterations: 20 });
    expect(solution.exploitability).toBeCloseTo(0, 9);
  });

  it("bets the nuts and folds the air when the ranges could not be more lopsided", () => {
    const { tree, root, response } = polarisedTree();
    const solution = solveRiver(tree, hands, [rangeOf(NUT_COMBOS), rangeOf(CATCHER_COMBOS)], {
      iterations: 400,
    });
    const n = hands.count;

    const bets = solution.strategyAt(root)[1 * n + at("Qs", "Ts")]!;
    const folds = solution.strategyAt(response)[0 * n + at("9s", "9c")]!;
    expect(bets).toBeGreaterThan(0.99);
    expect(folds).toBeGreaterThan(0.99);
  });

  it("refuses a range that is not sized for the board", () => {
    const tree = buildTree(DEFAULT_BETTING);
    const wrong = new Float64Array(10);
    expect(() => solveRiver(tree, hands, [wrong, wrong], { iterations: 1 })).toThrow(/1081/);
  });

  it("refuses two ranges that can never face each other", () => {
    const tree = buildTree(DEFAULT_BETTING);
    const single = rangeOf([["Qs", "Ts"]]);
    expect(() => solveRiver(tree, hands, [single, single], { iterations: 1 })).toThrow(
      /never face each other/,
    );
  });
});
