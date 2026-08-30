/**
 * Setting up a turn solve.
 *
 * A turn subgame is a betting round, then one of forty eight rivers, then
 * another betting round. Everything underneath is the river solver: the same
 * tree builder, the same linear time terminals, the same discounted CFR. All
 * this module does is wire the two streets together and hand the solver the
 * rank views it needs.
 *
 * The cost is worth stating plainly, because it is the whole reason the next
 * phase exists. One turn iteration is forty eight river iterations plus change.
 * The tree is not forty eight times bigger in any interesting sense, it is the
 * same betting logic forty eight times over, and that multiplier is what makes
 * an exact turn solve a script rather than something a browser does while you
 * wait.
 */

import { buildHandSet, buildRiverViews, riverChanceWeight, type HandSet, type RiverView } from "./hands";
import { buildTurnTree, type BettingConfig, type PlayerNode, type Tree } from "./tree";
import { solve, type SolveOptions, type Solution } from "./cfr";

/** The betting settings for the river, minus the parts the turn decides. */
export type RiverBetting = Omit<BettingConfig, "startingPot" | "effectiveStack">;

export interface TurnSpot {
  hands: HandSet;
  views: RiverView[];
  tree: Tree;
}

export function buildTurnSpot(
  board: readonly number[],
  turn: BettingConfig,
  river: RiverBetting,
): TurnSpot {
  if (board.length !== 4) throw new Error(`A turn needs four board cards, got ${board.length}`);

  // Ranks are meaningless on an incomplete board, so the hand set is built
  // without them and every showdown reads a river view instead.
  const hands = buildHandSet(board, false);
  const views = buildRiverViews(hands);
  const tree = buildTurnTree(turn, river, views.length, riverChanceWeight(board.length));

  return { hands, views, tree };
}

export function solveTurn(
  spot: TurnSpot,
  ranges: readonly [Float64Array, Float64Array],
  options: Omit<SolveOptions, "views"> = {},
): Solution {
  return solve(spot.tree, spot.hands, ranges, { ...options, views: spot.views });
}

/**
 * Roughly how much the solver will hold on to, in bytes.
 *
 * Only regret and the strategy average survive between iterations; everything
 * else is pooled by depth. Worth being able to ask before starting a solve that
 * would other run the machine out of memory twenty minutes in.
 */
export function storageEstimate(
  tree: Tree,
  handCount: number,
  bucketsFor?: (node: PlayerNode) => { count: number } | null,
): number {
  let entries = 0;
  for (const node of tree.playerNodes) {
    entries += node.actions.length * (bucketsFor?.(node)?.count ?? handCount);
  }
  return entries * 8 * 2;
}
