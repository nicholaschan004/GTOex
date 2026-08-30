/**
 * What each action is actually worth, hand by hand.
 *
 * Preflop this project could score an answer as right or wrong, because a chart
 * says open or fold and there is nothing in between. Postflop that stops being
 * true. A solved strategy is MIXED: the same hand bets sixty percent of the time
 * and checks forty, and both are correct. Marking the forty wrong would be
 * teaching a fiction.
 *
 * So the scoring has to be the number solvers actually use, which is how much
 * expected value an action gives up against the best one available. Checking a
 * hand the solver bets 60% of the time usually costs nearly nothing, and a
 * trainer that says "wrong" instead of "that costs 0.02 big blinds" is worse
 * than useless: it teaches you to distrust it on exactly the spots where the
 * answer is genuinely close.
 *
 * The value of an action here is its value when BOTH players go on to play the
 * solved strategy afterwards. That is deliberately not a best response. "What if
 * I bet here and then played perfectly for the rest of the hand" is a different
 * and less useful question than "what does betting here cost me".
 */

import type { HandSet, RankView, RiverView } from "./hands";
import { foldValues, showdownValues, terminalScratch } from "./terminal";
import {
  maxDepth,
  widestNode,
  type Player,
  type PlayerNode,
  type Tree,
  type TreeNode,
} from "./tree";

export interface Decision {
  /** `actions x hands`, the expected value of each action in chips. */
  values: Float64Array;
  /**
   * How much opponent range is live behind each of the hero's hands at this
   * node, which is what turns a counterfactual value into chips.
   */
  liveOpponent: Float64Array;
  /**
   * Whether the hero's hand can reach this node at all. A hand the hero never
   * bets is not making a decision at the node after betting, and the numbers
   * there mean nothing.
   */
  reachable: Float64Array;
}

/**
 * Expected value of every action at one node, for every hand.
 *
 * Both players follow `average` throughout. The traversal is the same shape as
 * the solver's, minus the regret bookkeeping: reach vectors go down, values come
 * back, and at the target node the per-action values are copied out before they
 * are collapsed into the node's own value.
 */
export function evaluateDecision(
  tree: Tree,
  hands: HandSet,
  ranges: readonly [Float64Array, Float64Array],
  average: readonly Float64Array[],
  target: PlayerNode,
  views?: readonly RiverView[],
): Decision {
  const n = hands.count;
  const hero: Player = target.player;
  const actions = target.actions.length;

  const levels = Array.from({ length: maxDepth(tree.root) + 2 }, () => ({
    value: new Float64Array(n),
    childReach: new Float64Array(widestNode(tree) * n),
    childValue: new Float64Array(widestNode(tree) * n),
    maskSelf: new Float64Array(n),
    maskOpponent: new Float64Array(n),
  }));
  const cardScratch = terminalScratch();

  const captured = new Float64Array(actions * n);
  const capturedOpponent = new Float64Array(n);
  const capturedSelf = new Float64Array(n);
  let found = false;

  function walk(
    node: TreeNode,
    reachSelf: Float64Array,
    reachOpponent: Float64Array,
    view: RankView,
    depth: number,
  ): Float64Array {
    const level = levels[depth]!;

    if (node.kind === "fold") {
      const payoff = hero === node.winner ? node.amount : -node.amount;
      foldValues(hands, reachOpponent, payoff, level.value, cardScratch);
      return level.value;
    }

    if (node.kind === "showdown") {
      showdownValues(hands, view, reachOpponent, node.amount, level.value, cardScratch);
      return level.value;
    }

    if (node.kind === "chance") {
      if (!views) throw new Error("A tree with chance nodes needs a rank view for each card");
      const { value, maskSelf, maskOpponent } = level;
      value.fill(0);

      for (let card = 0; card < node.children.length; card++) {
        const next = views[card]!;
        maskSelf.set(reachSelf);
        maskOpponent.set(reachOpponent);
        for (const blocked of next.blocked) {
          maskSelf[blocked] = 0;
          maskOpponent[blocked] = 0;
        }

        const child = walk(node.children[card]!, maskSelf, maskOpponent, next, depth + 1);
        for (let h = 0; h < n; h++) value[h] = value[h]! + child[h]!;
        for (const blocked of next.blocked) value[blocked] = value[blocked]! - child[blocked]!;
      }

      for (let h = 0; h < n; h++) value[h] = value[h]! * node.weight;
      return value;
    }

    const count = node.actions.length;
    const { value, childReach, childValue } = level;
    const strategy = average[node.id]!;
    const heroActs = node.player === hero;
    const source = heroActs ? reachSelf : reachOpponent;

    for (let a = 0; a < count; a++) {
      const offset = a * n;
      for (let h = 0; h < n; h++) childReach[offset + h] = source[h]! * strategy[offset + h]!;
      const reach = childReach.subarray(offset, offset + n);

      const returned = heroActs
        ? walk(node.children[a]!, reach, reachOpponent, view, depth + 1)
        : walk(node.children[a]!, reachSelf, reach, view, depth + 1);
      childValue.set(returned, offset);
    }

    if (node === target) {
      captured.set(childValue.subarray(0, count * n));
      capturedOpponent.set(reachOpponent);
      capturedSelf.set(reachSelf);
      found = true;
    }

    for (let h = 0; h < n; h++) {
      let total = 0;
      if (heroActs) {
        for (let a = 0; a < count; a++) total += strategy[a * n + h]! * childValue[a * n + h]!;
      } else {
        for (let a = 0; a < count; a++) total += childValue[a * n + h]!;
      }
      value[h] = total;
    }

    return value;
  }

  walk(tree.root, ranges[hero], ranges[hero === 0 ? 1 : 0], hands, 0);
  if (!found) throw new Error("That node is not in this tree");

  // Counterfactual values are weighted by how much opponent range is behind
  // them. Dividing that back out is what turns them into chips.
  const liveOpponent = new Float64Array(n);
  foldValues(hands, capturedOpponent, 1, liveOpponent, cardScratch);

  const values = new Float64Array(actions * n);
  for (let h = 0; h < n; h++) {
    const live = liveOpponent[h]!;
    for (let a = 0; a < actions; a++) {
      values[a * n + h] = live > 1e-12 ? captured[a * n + h]! / live : 0;
    }
  }

  return { values, liveOpponent, reachable: capturedSelf };
}

/**
 * What an action costs, against the best one available for that hand.
 *
 * Zero for any action tied for best, and never negative. This is the number to
 * put in front of someone: "that check is fine" and "that check costs you half a
 * big blind" are different lessons, and a right-or-wrong verdict can express
 * neither.
 */
export function actionCost(decision: Decision, action: number, hand: number, actions: number): number {
  const n = decision.values.length / actions;
  let best = -Infinity;
  for (let a = 0; a < actions; a++) {
    const value = decision.values[a * n + hand]!;
    if (value > best) best = value;
  }
  return Math.max(0, best - decision.values[action * n + hand]!);
}
