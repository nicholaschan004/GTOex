/**
 * Discounted counterfactual regret minimisation over a postflop subgame.
 *
 * CFR converges to a Nash equilibrium of a two player zero sum game by having
 * each player accumulate regret for the actions it did not take and then play
 * in proportion to whatever regret is positive. The average of the strategies
 * played converges even though the strategies themselves do not settle, which
 * is the same reason the preflop push/fold solver had to average rather than
 * iterate best responses.
 *
 * This is the discounted variant (Brown and Sandholm, AAAI 2019), which
 * multiplies old regret down each iteration instead of clamping it at zero the
 * way CFR+ does, and beats CFR+ on poker. The paper's exponents are the
 * defaults here.
 *
 * The important structural choice is that this is VECTOR CFR. A traversal
 * carries a vector of reach probabilities, one per hand, and updates every
 * hand's regret in one pass. Walking the tree once per hand instead would mean
 * a thousand traversals per iteration rather than two.
 *
 * Three things this file has to get right that a river-only solver did not:
 *
 *   - CHANCE NODES. A turn solve deals one of forty eight rivers and plays a
 *     whole betting round underneath each. What each hand is worth changes with
 *     the card, so the rank view travels down the traversal alongside the reach
 *     vectors.
 *
 *   - MEMORY. Forty eight river subtrees under every street ending is thousands
 *     of nodes, and giving each its own scratch buffers would cost hundreds of
 *     megabytes for arrays that are live for microseconds. Scratch is pooled by
 *     DEPTH instead: only one node per depth is ever mid-computation, so one set
 *     of buffers per level of the tree is enough. Only regret and the strategy
 *     average are stored per node, because only those have to survive.
 *
 *   - ABSTRACTION. A node can be told to share one strategy across a group of
 *     hands. Regret then accumulates per bucket rather than per hand, which is
 *     what makes an abstraction an abstraction. See `abstraction.ts` for what
 *     the groups are and `docs/postflop-solver.md` for what it costs.
 */

import type { HandSet, RankView, RiverView } from "./hands";
import { foldValues, jointMass, showdownValues, terminalScratch } from "./terminal";
import {
  IP,
  OOP,
  maxDepth,
  widestNode,
  type Player,
  type PlayerNode,
  type Tree,
  type TreeNode,
} from "./tree";

/** How a node's hands are grouped, or null to give every hand its own strategy. */
export interface Bucketing {
  /** Hand index to bucket index. */
  map: Int32Array;
  count: number;
}

export interface SolveOptions {
  iterations?: number;
  /** Discount exponent for positive regret. */
  alpha?: number;
  /** Discount exponent for negative regret. Zero halves it every iteration. */
  beta?: number;
  /** Discount exponent for the strategy average. */
  gamma?: number;
  /**
   * One rank view per chance child, in the order the chance node lists them.
   * Required when the tree contains a chance node, unused when it does not.
   */
  views?: readonly RiverView[];
  /** Which hands share a strategy at a given node. Return null for none. */
  bucketsFor?: (node: PlayerNode) => Bucketing | null;
  /** Skip the best-response pass, which costs about one iteration per player. */
  skipExploitability?: boolean;
  onProgress?: (iteration: number) => void;
  reportEvery?: number;
}

export const DEFAULT_SOLVE = {
  iterations: 400,
  alpha: 1.5,
  beta: 0,
  gamma: 2,
  reportEvery: 50,
};

interface Store {
  actions: number;
  buckets: number;
  /** Hand to bucket, or null when every hand has its own strategy. */
  map: Int32Array | null;
  /** actions x buckets. */
  regret: Float64Array;
  /** actions x buckets. */
  strategySum: Float64Array;
  /** actions x buckets, the regret-matched strategy for this iteration. */
  probability: Float64Array;
  /** actions x hands, `probability` spread back over the hands that share it. */
  current: Float64Array;
}

/** Buffers for one level of the tree. Only one node per level is ever mid-flight. */
interface Level {
  value: Float64Array;
  childReach: Float64Array;
  childValue: Float64Array;
  maskSelf: Float64Array;
  maskOpponent: Float64Array;
}

function buildLevels(depth: number, width: number, n: number): Level[] {
  return Array.from({ length: depth + 2 }, () => ({
    value: new Float64Array(n),
    childReach: new Float64Array(width * n),
    childValue: new Float64Array(width * n),
    maskSelf: new Float64Array(n),
    maskOpponent: new Float64Array(n),
  }));
}

export interface Solution {
  tree: Tree;
  hands: HandSet;
  ranges: readonly [Float64Array, Float64Array];
  iterations: number;
  /** Chips per hand either player could gain by deviating. Zero at equilibrium. */
  exploitability: number;
  /** The same number as a percentage of the starting pot, which is how solvers quote it. */
  exploitabilityPercent: number;
  /**
   * Average strategy at a node, expanded to `actions x hands` even when the node
   * was solved over buckets, so callers never have to know whether it was.
   */
  strategyAt(node: PlayerNode): Float64Array;
}

export function solve(
  tree: Tree,
  hands: HandSet,
  ranges: readonly [Float64Array, Float64Array],
  options: SolveOptions = {},
): Solution {
  const { iterations, alpha, beta, gamma, reportEvery } = { ...DEFAULT_SOLVE, ...options };
  const n = hands.count;
  const views = options.views;

  for (const range of ranges) {
    if (range.length !== n) {
      throw new Error(`Range has ${range.length} weights but the board allows ${n} hands`);
    }
  }

  const stores: Store[] = tree.playerNodes.map((node) => {
    const actions = node.actions.length;
    const bucketing = options.bucketsFor?.(node) ?? null;
    const buckets = bucketing?.count ?? n;
    const probability = new Float64Array(actions * buckets);
    return {
      actions,
      buckets,
      map: bucketing?.map ?? null,
      regret: new Float64Array(actions * buckets),
      strategySum: new Float64Array(actions * buckets),
      probability,
      // Unbucketed, the per-hand strategy IS the per-bucket one, so it shares
      // the array rather than copying it every visit.
      current: bucketing ? new Float64Array(actions * n) : probability,
    };
  });

  const levels = buildLevels(maxDepth(tree.root), widestNode(tree), n);
  const cardScratch = terminalScratch();

  /** Regret matching, then spread over the hands that share each bucket. */
  function matchRegret(store: Store): void {
    const { actions, buckets, regret, probability, current, map } = store;
    const uniform = 1 / actions;

    for (let b = 0; b < buckets; b++) {
      let positive = 0;
      for (let a = 0; a < actions; a++) {
        const value = regret[a * buckets + b]!;
        if (value > 0) positive += value;
      }
      if (positive > 0) {
        for (let a = 0; a < actions; a++) {
          const value = regret[a * buckets + b]!;
          probability[a * buckets + b] = value > 0 ? value / positive : 0;
        }
      } else {
        for (let a = 0; a < actions; a++) probability[a * buckets + b] = uniform;
      }
    }

    if (map) expand(probability, current, actions, buckets, map, n);
  }

  function traverse(
    node: TreeNode,
    traverser: Player,
    reachSelf: Float64Array,
    reachOpponent: Float64Array,
    view: RankView,
    depth: number,
  ): Float64Array {
    const level = levels[depth]!;

    if (node.kind === "fold") {
      const payoff = traverser === node.winner ? node.amount : -node.amount;
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
        // Nobody can be holding the card that just came.
        for (const blocked of next.blocked) {
          maskSelf[blocked] = 0;
          maskOpponent[blocked] = 0;
        }

        const child = traverse(
          node.children[card]!,
          traverser,
          maskSelf,
          maskOpponent,
          next,
          depth + 1,
        );
        for (let h = 0; h < n; h++) value[h] = value[h]! + child[h]!;
        // Add everything, then take back the hands that could not have seen
        // this river. Cheaper than testing every hand, since only 47 are dead.
        for (const blocked of next.blocked) value[blocked] = value[blocked]! - child[blocked]!;
      }

      for (let h = 0; h < n; h++) value[h] = value[h]! * node.weight;
      return value;
    }

    const store = stores[node.id]!;
    const { actions, buckets, current, map, regret, strategySum } = store;
    const { value, childReach, childValue } = level;
    matchRegret(store);

    const acting = node.player === traverser;
    const source = acting ? reachSelf : reachOpponent;

    for (let a = 0; a < actions; a++) {
      const offset = a * n;
      for (let h = 0; h < n; h++) childReach[offset + h] = source[h]! * current[offset + h]!;

      const reach = childReach.subarray(offset, offset + n);
      const returned = acting
        ? traverse(node.children[a]!, traverser, reach, reachOpponent, view, depth + 1)
        : traverse(node.children[a]!, traverser, reachSelf, reach, view, depth + 1);

      // Copy before touching the next child: `returned` belongs to the level
      // below and the next call overwrites it.
      childValue.set(returned, offset);
    }

    if (acting) {
      for (let h = 0; h < n; h++) {
        let expected = 0;
        for (let a = 0; a < actions; a++) expected += current[a * n + h]! * childValue[a * n + h]!;
        value[h] = expected;

        // Regret lands on the bucket, not the hand. When there is no bucketing
        // the bucket IS the hand and this is the ordinary update.
        const bucket = map ? map[h]! : h;
        const reach = reachSelf[h]!;
        for (let a = 0; a < actions; a++) {
          const stored = a * buckets + bucket;
          regret[stored] = regret[stored]! + childValue[a * n + h]! - expected;
          strategySum[stored] = strategySum[stored]! + reach * current[a * n + h]!;
        }
      }
    } else {
      // The opponent's action probabilities are already folded into the reach
      // vectors handed down, so the traverser's value is the plain sum.
      for (let h = 0; h < n; h++) {
        let total = 0;
        for (let a = 0; a < actions; a++) total += childValue[a * n + h]!;
        value[h] = total;
      }
    }

    return value;
  }

  for (let t = 1; t <= iterations; t++) {
    // Discount what has accumulated so far, then add this iteration's regret.
    // The exponents use the completed iteration count, so the first pass
    // discounts nothing that exists yet.
    const previous = t - 1;
    const positiveFactor = previous === 0 ? 0 : previous ** alpha / (previous ** alpha + 1);
    const negativeFactor = previous === 0 ? 0 : previous ** beta / (previous ** beta + 1);
    const strategyFactor = previous === 0 ? 0 : (previous / (previous + 1)) ** gamma;

    for (const store of stores) {
      const { regret, strategySum } = store;
      for (let i = 0; i < regret.length; i++) {
        regret[i] = regret[i]! > 0 ? regret[i]! * positiveFactor : regret[i]! * negativeFactor;
        strategySum[i] = strategySum[i]! * strategyFactor;
      }
    }

    traverse(tree.root, OOP, ranges[0], ranges[1], hands, 0);
    traverse(tree.root, IP, ranges[1], ranges[0], hands, 0);

    if (options.onProgress && t % reportEvery === 0) options.onProgress(t);
  }

  const average = stores.map((store) => {
    const perBucket = normalise(store.strategySum, store.actions, store.buckets);
    if (!store.map) return perBucket;
    const perHand = new Float64Array(store.actions * n);
    expand(perBucket, perHand, store.actions, store.buckets, store.map, n);
    return perHand;
  });

  const gap = options.skipExploitability
    ? Number.NaN
    : measureExploitability(tree, hands, ranges, average, views);

  return {
    tree,
    hands,
    ranges,
    iterations,
    exploitability: gap,
    exploitabilityPercent: (gap / tree.config.startingPot) * 100,
    strategyAt: (node) => average[node.id]!,
  };
}

/** Backwards-compatible name for a single street solve. */
export const solveRiver = solve;

/** Spread a per-bucket table over the hands that share each bucket. */
function expand(
  perBucket: Float64Array,
  perHand: Float64Array,
  actions: number,
  buckets: number,
  map: Int32Array,
  n: number,
): void {
  for (let a = 0; a < actions; a++) {
    const from = a * buckets;
    const to = a * n;
    for (let h = 0; h < n; h++) perHand[to + h] = perBucket[from + map[h]!]!;
  }
}

/**
 * Turn accumulated strategy weight into probabilities.
 *
 * A bucket with no accumulated weight was never reached, so its column is
 * meaningless rather than wrong; uniform keeps it from being NaN and keeps a
 * best response from reading garbage out of it.
 */
function normalise(strategySum: Float64Array, actions: number, buckets: number): Float64Array {
  const out = new Float64Array(actions * buckets);
  for (let b = 0; b < buckets; b++) {
    let total = 0;
    for (let a = 0; a < actions; a++) total += strategySum[a * buckets + b]!;
    if (total > 0) {
      for (let a = 0; a < actions; a++) out[a * buckets + b] = strategySum[a * buckets + b]! / total;
    } else {
      for (let a = 0; a < actions; a++) out[a * buckets + b] = 1 / actions;
    }
  }
  return out;
}

/**
 * How much either player could gain by abandoning the solution and playing the
 * best response to it, in chips per hand.
 *
 * This is the same measure the preflop push/fold solver is checked with, and it
 * is here for the same reason: it asks whether the two strategies beat each
 * other rather than whether they match an answer computed somewhere else. At a
 * true equilibrium it is zero, and it cannot be negative.
 *
 * Note it takes strategies already expanded to every hand. That is what makes
 * it the right yardstick for an abstraction: a bucketed solve is graded in the
 * FULL game, where the best response is free to exploit the fact that hands
 * sharing a bucket were forced to play alike.
 */
export function measureExploitability(
  tree: Tree,
  hands: HandSet,
  ranges: readonly [Float64Array, Float64Array],
  average: readonly Float64Array[],
  views?: readonly RiverView[],
): number {
  const n = hands.count;
  const mass = jointMass(hands, ranges[0], ranges[1]);
  if (mass <= 0) throw new Error("The two ranges never face each other on this board");

  const levels = buildLevels(maxDepth(tree.root), widestNode(tree), n);
  const cardScratch = terminalScratch();

  function respond(
    node: TreeNode,
    hero: Player,
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
      const { value, maskOpponent } = level;
      value.fill(0);

      for (let card = 0; card < node.children.length; card++) {
        const next = views[card]!;
        maskOpponent.set(reachOpponent);
        for (const blocked of next.blocked) maskOpponent[blocked] = 0;

        const child = respond(node.children[card]!, hero, maskOpponent, next, depth + 1);
        for (let h = 0; h < n; h++) value[h] = value[h]! + child[h]!;
        for (const blocked of next.blocked) value[blocked] = value[blocked]! - child[blocked]!;
      }

      for (let h = 0; h < n; h++) value[h] = value[h]! * node.weight;
      return value;
    }

    const actions = node.actions.length;
    const { value, childReach, childValue } = level;
    const strategy = average[node.id]!;
    const heroActs = node.player === hero;

    for (let a = 0; a < actions; a++) {
      const offset = a * n;
      let returned: Float64Array;
      if (heroActs) {
        // The hero picks per hand, so its own reach never enters the recursion:
        // a best response is computed hand by hand regardless of how often it
        // would have arrived here.
        returned = respond(node.children[a]!, hero, reachOpponent, view, depth + 1);
      } else {
        for (let h = 0; h < n; h++) {
          childReach[offset + h] = reachOpponent[h]! * strategy[offset + h]!;
        }
        returned = respond(
          node.children[a]!,
          hero,
          childReach.subarray(offset, offset + n),
          view,
          depth + 1,
        );
      }
      childValue.set(returned, offset);
    }

    for (let h = 0; h < n; h++) {
      if (heroActs) {
        let best = -Infinity;
        for (let a = 0; a < actions; a++) {
          const candidate = childValue[a * n + h]!;
          if (candidate > best) best = candidate;
        }
        value[h] = best;
      } else {
        let total = 0;
        for (let a = 0; a < actions; a++) total += childValue[a * n + h]!;
        value[h] = total;
      }
    }

    return value;
  }

  let total = 0;
  for (const hero of [OOP, IP] as const) {
    const values = respond(tree.root, hero, ranges[hero === OOP ? 1 : 0], hands, 0);
    let sum = 0;
    for (let h = 0; h < n; h++) sum += ranges[hero]![h]! * values[h]!;
    total += sum / mass;
  }
  return total / 2;
}
