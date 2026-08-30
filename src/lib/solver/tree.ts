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

export type TreeNode = PlayerNode | FoldNode | ShowdownNode;

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
}

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

export function buildTree(config: BettingConfig): Tree {
  if (config.effectiveStack <= 0) throw new Error("Effective stack must be positive");
  if (config.startingPot <= 0) throw new Error("Starting pot must be positive");

  const playerNodes: PlayerNode[] = [];

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
        add({ kind: "check", to: mine }, { kind: "showdown", amount: winnings(config, mine) });
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
      add({ kind: "call", to: called }, { kind: "showdown", amount: winnings(config, called) });
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

    const node: PlayerNode = { kind: "player", player, actions, children, id: playerNodes.length };
    playerNodes.push(node);
    return node;
  }

  const root = build(OOP, [0, 0], config.maxBets, false);
  return { root, config, playerNodes };
}

/** Every node in the tree, for sizing storage and for tests. */
export function walk(node: TreeNode, visit: (node: TreeNode) => void): void {
  visit(node);
  if (node.kind === "player") for (const child of node.children) walk(child, visit);
}

export function countNodes(tree: Tree): { player: number; terminal: number } {
  let player = 0;
  let terminal = 0;
  walk(tree.root, (node) => (node.kind === "player" ? player++ : terminal++));
  return { player, terminal };
}
