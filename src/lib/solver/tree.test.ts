import { describe, expect, it } from "vitest";
import {
  DEFAULT_BETTING,
  IP,
  OOP,
  buildTree,
  countNodes,
  walk,
  type BettingConfig,
  type PlayerNode,
  type TreeNode,
} from "./tree";

const config = (overrides: Partial<BettingConfig> = {}): BettingConfig => ({
  ...DEFAULT_BETTING,
  ...overrides,
});

const asPlayer = (node: TreeNode): PlayerNode => {
  if (node.kind !== "player") throw new Error(`Expected a player node, got ${node.kind}`);
  return node;
};

describe("shape", () => {
  it("has the out of position player act first", () => {
    expect(asPlayer(buildTree(config()).root).player).toBe(OOP);
  });

  it("passes the action across on a check, and ends the street on the second one", () => {
    const tree = buildTree(config());
    const root = asPlayer(tree.root);
    expect(root.actions[0]!.kind).toBe("check");

    const afterCheck = asPlayer(root.children[0]!);
    expect(afterCheck.player).toBe(IP);
    expect(afterCheck.actions[0]!.kind).toBe("check");
    expect(afterCheck.children[0]!.kind).toBe("showdown");
  });

  it("offers a fold and a call, in that order, to anyone facing a bet", () => {
    const tree = buildTree(config());
    const root = asPlayer(tree.root);
    const facingABet = asPlayer(root.children[1]!);

    expect(facingABet.actions[0]!.kind).toBe("fold");
    expect(facingABet.actions[1]!.kind).toBe("call");
    expect(facingABet.children[0]!.kind).toBe("fold");
    expect(facingABet.children[1]!.kind).toBe("showdown");
  });

  it("gives every player node an id matching its slot", () => {
    const tree = buildTree(config());
    tree.playerNodes.forEach((node, index) => expect(node.id).toBe(index));
  });

  it("never offers an action nobody can afford", () => {
    const settings = config({ effectiveStack: 40 });
    const tree = buildTree(settings);
    walk(tree.root, (node) => {
      if (node.kind !== "player") return;
      for (const action of node.actions) {
        expect(action.to).toBeLessThanOrEqual(settings.effectiveStack);
        expect(action.to).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

describe("the raise cap", () => {
  it("leaves only a check and a showdown when no bets are allowed", () => {
    const tree = buildTree(config({ maxBets: 0 }));
    const root = asPlayer(tree.root);

    expect(root.actions).toHaveLength(1);
    expect(root.actions[0]!.kind).toBe("check");
    const afterCheck = asPlayer(root.children[0]!);
    expect(afterCheck.actions).toHaveLength(1);
    expect(afterCheck.children[0]!.kind).toBe("showdown");
  });

  it("stops offering raises once the cap is reached", () => {
    const tree = buildTree(config({ maxBets: 1 }));
    const facingABet = asPlayer(asPlayer(tree.root).children[1]!);
    expect(facingABet.actions.map((a) => a.kind)).toEqual(["fold", "call"]);
  });

  it("grows the tree when the cap is raised", () => {
    const small = countNodes(buildTree(config({ maxBets: 1 })));
    const large = countNodes(buildTree(config({ maxBets: 3 })));
    expect(large.player).toBeGreaterThan(small.player);
    expect(large.terminal).toBeGreaterThan(small.terminal);
  });
});

describe("bet sizing", () => {
  it("bets the configured fraction of the pot", () => {
    const tree = buildTree(config({ startingPot: 100, effectiveStack: 1000, betSizes: [0.5, 1] }));
    const bets = asPlayer(tree.root).actions.filter((action) => action.kind === "bet");
    expect(bets.map((action) => action.to)).toEqual([50, 100]);
  });

  it("sizes a raise off the pot as it would be after calling", () => {
    // Pot 100, IP bets 100 into it. OOP calling would make the pot 300, so a
    // pot-sized raise puts in 100 + 300 = 400 total.
    const tree = buildTree(
      config({ startingPot: 100, effectiveStack: 1000, betSizes: [1], raiseSizes: [1], maxBets: 2 }),
    );
    const facingABet = asPlayer(asPlayer(tree.root).children[1]!);
    const raise = facingABet.actions.find((action) => action.kind === "raise");
    expect(raise?.to).toBe(400);
  });

  it("snaps to all in rather than leaving a stub behind", () => {
    // A 75% bet would be 15 into a pot of 20, leaving only 1 behind out of 16.
    const tree = buildTree(
      config({ startingPot: 20, effectiveStack: 16, betSizes: [0.75], allInSnap: 0.25 }),
    );
    const bets = asPlayer(tree.root).actions.filter((action) => action.kind === "bet");
    expect(bets).toHaveLength(1);
    expect(bets[0]!.to).toBe(16);
  });

  it("collapses sizes that snap to the same number", () => {
    const tree = buildTree(
      config({ startingPot: 20, effectiveStack: 20, betSizes: [0.75, 1, 1.5], allInSnap: 0.25 }),
    );
    const bets = asPlayer(tree.root).actions.filter((action) => action.kind === "bet");
    expect(bets).toHaveLength(1);
    expect(bets[0]!.to).toBe(20);
  });

  it("refuses a raise smaller than the bet it faces", () => {
    // A 10% raise over a pot-sized bet would not even be a min-raise.
    const tree = buildTree(
      config({ startingPot: 100, effectiveStack: 10000, betSizes: [1], raiseSizes: [0.01, 1] }),
    );
    const facingABet = asPlayer(asPlayer(tree.root).children[1]!);
    const raises = facingABet.actions.filter((action) => action.kind === "raise");
    expect(raises).toHaveLength(1);
    expect(raises[0]!.to).toBe(400);
  });
});

describe("payoffs", () => {
  /**
   * Every terminal pays the winner half the dead money plus whatever the loser
   * put in. Shifting both players by half the dead money is what makes the
   * subgame zero sum; the check that it was done consistently is that a fold on
   * the first action is worth exactly half the starting pot.
   */
  it("pay half the starting pot when the first bet takes it down", () => {
    const tree = buildTree(config({ startingPot: 60, effectiveStack: 500 }));
    const facingABet = asPlayer(asPlayer(tree.root).children[1]!);
    const folded = facingABet.children[0]!;

    expect(folded.kind).toBe("fold");
    if (folded.kind !== "fold") throw new Error("unreachable");
    expect(folded.amount).toBe(30);
    expect(folded.winner).toBe(OOP);
  });

  it("pay half the final pot at a showdown", () => {
    const tree = buildTree(
      config({ startingPot: 100, effectiveStack: 1000, betSizes: [1], maxBets: 1 }),
    );
    const facingABet = asPlayer(asPlayer(tree.root).children[1]!);
    const called = facingABet.children[1]!;

    expect(called.kind).toBe("showdown");
    if (called.kind !== "showdown") throw new Error("unreachable");
    // 100 in the middle plus 100 each: a final pot of 300.
    expect(called.amount).toBe(150);
  });

  it("award a fold to whoever did not fold, everywhere in the tree", () => {
    const tree = buildTree(config());
    const folders = new Map<TreeNode, PlayerNode>();
    walk(tree.root, (node) => {
      if (node.kind !== "player") return;
      node.actions.forEach((action, index) => {
        if (action.kind === "fold") folders.set(node.children[index]!, node);
      });
    });

    expect(folders.size).toBeGreaterThan(0);
    for (const [terminal, parent] of folders) {
      if (terminal.kind !== "fold") throw new Error("A fold action must lead to a fold node");
      expect(terminal.winner).not.toBe(parent.player);
    }
  });

  it("never pay a negative amount", () => {
    const tree = buildTree(config());
    walk(tree.root, (node) => {
      if (node.kind === "player" || node.kind === "chance") return;
      expect(node.amount).toBeGreaterThan(0);
    });
  });
});

describe("validation", () => {
  it("refuses a stack or a pot that is not there", () => {
    expect(() => buildTree(config({ effectiveStack: 0 }))).toThrow(/stack/i);
    expect(() => buildTree(config({ startingPot: 0 }))).toThrow(/pot/i);
  });
});
