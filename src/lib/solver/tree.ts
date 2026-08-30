/**
 * The betting tree for one street.
 *
 * Bet sizes are configuration, not constants buried in here, because the set of
 * sizes IS an approximation and usually the biggest one. A real player can bet
 * any amount; a solver can only find strategies built from the sizes it was
 * given, and every size left out is strategy it cannot find. Card abstraction
 * gets discussed more, but at reasonable bucket counts action abstraction is
 * typically the larger error. Making it a parameter is what lets it be measured
 * rather than assumed. See docs/postflop-solver.md.
 *
 * Out of position acts first, which is what being out of position means.
 */

export const OOP = 0;
export const IP = 1;
export type Player = typeof OOP | typeof IP;

export type ActionKind = "check" | "bet" | "call" | "fold" | "raise";

export interface Action {
  kind: ActionKind;
  /** Total the acting player has invested once the action is taken. */
  to: number;
}

export interface PlayerNode {
  kind: "player";
  player: Player;
  actions: Action[];
  children: TreeNode[];
  /**
   * Which betting round this node belongs to: 0 is the first street the tree
   * covers, 1 the one after it. Abstraction is applied per street, so the
   * solver has to be able to tell a turn decision from a river one.
   */
  street: number;
  /**
   * Which chance branch this node sits under, or -1 on the first street. Two
   * river nodes under different cards are different decisions and can be
   * abstracted differently, so the solver has to be able to tell them apart.
   */
  chanceIndex: number;
  /**
   * Position in `Tree.playerNodes`, so the solver can index its storage with an
   * array rather than a Map. This is walked millions of times per solve and a
   * hash lookup per node per iteration is not free.
   */
  id: number;
}

export interface FoldNode {
  kind: "fold";
  /** The player who did not fold, and therefore collects. */
  winner: Player;
  /** What the winner gains: the dead money's half plus what the folder put in. */
  amount: number;
}

export interface ShowdownNode {
  kind: "showdown";
  /** Half the final pot. Both players contributed equally to reach a showdown. */
  amount: number;
}

/**
 * A card comes off. One child per river, all structurally identical, because
 * the betting that follows does not depend on which card it was.
 *
 * What DOES depend on the card is who wins at showdown, and that lives in the
 * rank views the solver carries alongside, not in the tree.
 */
export interface ChanceNode {
  kind: "chance";
  children: TreeNode[];
  /**
   * Probability of any one of them, which is not one over the number of
   * children: the dealer's deck has more cards in it than the players can
   * actually see come. See `riverChanceWeight`.
   */
  weight: number;
}

export type TreeNode = PlayerNode | FoldNode | ShowdownNode | ChanceNode;

export interface BettingConfig {
  /** Money already in the middle before this street. Belongs to neither player. */
  startingPot: number;
  /** What each player still has behind. Assumed equal, as it is in any real spot. */
  effectiveStack: number;
  /** Opening bet sizes, as fractions of the pot. */
  betSizes: number[];
  /** Raise sizes, as fractions of the pot after calling. */
  raiseSizes: number[];
  /**
   * How many bets or raises a street may contain before only calling and
   * folding remain. Two means one bet and one raise.
   */
  maxBets: number;
  /**
   * Snap a bet to all in when it would leave less than this fraction of the pot
   * behind. Betting 90% of your stack and keeping a token amount back is a
   * strategy no equilibrium wants and a branch no solver should pay for.
   */
  allInSnap: number;
}

export const DEFAULT_BETTING: BettingConfig = {
  startingPot: 20,
  effectiveStack: 100,
  betSizes: [0.33, 0.75],
  raiseSizes: [1],
  maxBets: 2,
  allInSnap: 0.25,
};

export interface Tree {
  root: TreeNode;
  config: BettingConfig;
  /** Every player node, in the order they were created. */
  playerNodes: PlayerNode[];
  /** How many betting rounds the tree covers. One for a river solve, two for a turn. */
  streets: number;
}

/**
 * What happens when nobody has anything left to say on this street.
 *
 * A river tree ends in a showdown. A turn tree deals a card and starts another
 * betting round, which is why this is a hook rather than a hardcoded showdown:
 * the two streets are the same betting logic and differ only here.
 */
export type StreetEnd = (invested: number, amount: number) => TreeNode;

/**
 * Total invested by each player so far in this street.
 *
 * The winner of a terminal takes half the dead money plus everything the loser
 * put in. Shifting both players by half the dead money is what makes the
 * subgame zero sum, and shifting a game by a constant cannot move where its
 * equilibria are. At a showdown the two contributions are equal, so the same
 * formula collapses to half the final pot.
 */
function winnings(config: BettingConfig, loserInvested: number): number {
  return config.startingPot / 2 + loserInvested;
}

export function buildTree(
  config: BettingConfig,
  onStreetEnd: StreetEnd = (_invested, amount) => ({ kind: "showdown", amount }),
  street = 0,
  playerNodes: PlayerNode[] = [],
  chanceIndex = -1,
): Tree {
  if (config.effectiveStack <= 0) throw new Error("Effective stack must be positive");
  if (config.startingPot <= 0) throw new Error("Starting pot must be positive");


  /**
   * @param player     who is to act
   * @param invested   what each player has put in this street
   * @param betsLeft   how many more bets or raises the tree will allow
   * @param checked    whether the previous player checked (so a check now ends the street)
   */
  function build(
    player: Player,
    invested: [number, number],
    betsLeft: number,
    checked: boolean,
  ): TreeNode {
    const opponent: Player = player === OOP ? IP : OOP;
    const mine = invested[player];
    const theirs = invested[opponent];
    const toCall = theirs - mine;
    const pot = config.startingPot + mine + theirs;

    const actions: Action[] = [];
    const children: TreeNode[] = [];

    const add = (action: Action, child: TreeNode) => {
      actions.push(action);
      children.push(child);
    };

    const nextInvested = (amount: number): [number, number] => {
      const copy: [number, number] = [invested[0], invested[1]];
      copy[player] = amount;
      return copy;
    };

    if (toCall === 0) {
      // Nothing to call: check, or open the betting.
      if (checked) {
        add({ kind: "check", to: mine }, onStreetEnd(mine, winnings(config, mine)));
      } else {
        add({ kind: "check", to: mine }, build(opponent, invested, betsLeft, true));
      }
    } else {
      add(
        { kind: "fold", to: mine },
        { kind: "fold", winner: opponent, amount: winnings(config, mine) },
      );

      // A call closes the street. On the river that is the showdown; when this
      // builder is reused for the turn it becomes the river chance node, which
      // is why the amount is computed here rather than assumed downstream.
      const called = Math.min(theirs, config.effectiveStack);
      add({ kind: "call", to: called }, onStreetEnd(called, winnings(config, called)));
    }

    // Aggressive actions, if the stack and the raise cap allow any.
    const canAggress = betsLeft > 0 && mine < config.effectiveStack && theirs < config.effectiveStack;
    if (canAggress) {
      const fractions = toCall === 0 ? config.betSizes : config.raiseSizes;
      const potAfterCall = pot + toCall;
      const seen = new Set<number>();

      for (const fraction of fractions) {
        let target = theirs + fraction * potAfterCall;

        // Snap to all in rather than leaving a stub behind, and never bet more
        // than there is.
        if (target >= config.effectiveStack - config.allInSnap * potAfterCall) {
          target = config.effectiveStack;
        }
        target = Math.min(target, config.effectiveStack);

        // A raise has to be at least as large as the raise it faces, unless it
        // is all in, in which case there is nothing left to raise with.
        const raiseBy = target - theirs;
        if (target < config.effectiveStack && raiseBy < Math.max(toCall, 1e-9)) continue;
        if (target <= mine) continue;

        const key = Math.round(target * 1e6);
        if (seen.has(key)) continue;
        seen.add(key);

        add(
          { kind: toCall === 0 ? "bet" : "raise", to: target },
          build(opponent, nextInvested(target), betsLeft - 1, false),
        );
      }
    }

    const node: PlayerNode = {
      kind: "player",
      player,
      actions,
      children,
      street,
      chanceIndex,
      id: playerNodes.length,
    };
    playerNodes.push(node);
    return node;
  }

  const root = build(OOP, [0, 0], config.maxBets, false);
  return { root, config, playerNodes, streets: street + 1 };
}

/**
 * Two streets: a turn betting round, then a river card, then another.
 *
 * The pot and the stacks carry across, and that is the whole of the accounting.
 * If the turn puts `i` in from each player, the river starts with a pot of
 * `startingPot + 2i` and `effectiveStack - i` behind, and the river's own
 * payoff formula then produces exactly the number the two street version
 * needs. Worth checking rather than trusting: the winner of a river showdown
 * takes `(P + 2i) / 2 + r`, which is `P/2 + i + r`, which is what it is owed
 * once both players have been shifted by half the dead money.
 *
 * A turn line that gets both players all in has no river betting left, so the
 * chance node's children are bare showdowns. They still hang off the chance
 * node, because which hand wins still depends on the card.
 */
export function buildTurnTree(
  turn: BettingConfig,
  river: Omit<BettingConfig, "startingPot" | "effectiveStack">,
  riverCount: number,
  chanceWeight: number,
): Tree {
  const playerNodes: PlayerNode[] = [];

  const dealTheRiver: StreetEnd = (invested, amount) => {
    const behind = turn.effectiveStack - invested;
    const children: TreeNode[] = [];

    for (let i = 0; i < riverCount; i++) {
      if (behind <= 0) {
        children.push({ kind: "showdown", amount });
        continue;
      }
      children.push(
        buildTree(
          { ...river, startingPot: turn.startingPot + 2 * invested, effectiveStack: behind },
          (_i, riverAmount) => ({ kind: "showdown", amount: riverAmount }),
          1,
          playerNodes,
          i,
        ).root,
      );
    }

    return { kind: "chance", children, weight: chanceWeight };
  };

  const tree = buildTree(turn, dealTheRiver, 0, playerNodes);
  return { ...tree, streets: 2 };
}

/** Every node in the tree, for sizing storage and for tests. */
export function walk(node: TreeNode, visit: (node: TreeNode) => void): void {
  visit(node);
  if (node.kind === "player" || node.kind === "chance") {
    for (const child of node.children) walk(child, visit);
  }
}

export function countNodes(tree: Tree): { player: number; chance: number; terminal: number } {
  let player = 0;
  let chance = 0;
  let terminal = 0;
  walk(tree.root, (node) => {
    if (node.kind === "player") player++;
    else if (node.kind === "chance") chance++;
    else terminal++;
  });
  return { player, chance, terminal };
}

/** The most actions any one node offers, for sizing pooled scratch buffers. */
export function widestNode(tree: Tree): number {
  let widest = 1;
  for (const node of tree.playerNodes) widest = Math.max(widest, node.actions.length);
  return widest;
}

/** How deep the tree goes, counting chance nodes, for the same reason. */
export function maxDepth(node: TreeNode, depth = 0): number {
  if (node.kind !== "player" && node.kind !== "chance") return depth;
  let deepest = depth;
  for (const child of node.children) deepest = Math.max(deepest, maxDepth(child, depth + 1));
  return deepest;
}
