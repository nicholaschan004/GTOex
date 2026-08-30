/**
 * Discounted counterfactual regret minimisation over a river subgame.
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
 * Every buffer is allocated once at setup. Nothing in the hot loop allocates,
 * because a solve is millions of vector operations and a garbage collector
 * running through the middle of it is pure loss.
 */

import type { HandSet } from "./hands";
import { foldValues, jointMass, showdownValues, terminalScratch } from "./terminal";
import { IP, OOP, type Player, type PlayerNode, type Tree, type TreeNode } from "./tree";

export interface SolveOptions {
  iterations?: number;
  /** Discount exponent for positive regret. */
  alpha?: number;
  /** Discount exponent for negative regret. Zero halves it every iteration. */
  beta?: number;
  /** Discount exponent for the strategy average. */
  gamma?: number;
  /** Called with progress after every `reportEvery` iterations. */
  onProgress?: (iteration: number) => void;
  reportEvery?: number;
}

export const DEFAULT_SOLVE: Required<Omit<SolveOptions, "onProgress">> = {
  iterations: 400,
  alpha: 1.5,
  beta: 0,
  gamma: 2,
  reportEvery: 50,
};

interface Store {
  actions: number;
  regret: Float64Array;
  strategySum: Float64Array;
  /** Regret-matched strategy for the current iteration. */
  current: Float64Array;
  /** Reach vectors handed to each child. */
  childReach: Float64Array;
  /** Values coming back from each child. */
  childValue: Float64Array;
  /** This node's value, and the buffer its parent reads. */
  value: Float64Array;
}

export interface Solution {
  tree: Tree;
  hands: HandSet;
  ranges: readonly [Float64Array, Float64Array];
  iterations: number;
  /**
   * What the pair of strategies leaves on the table, in chips per hand. Zero at
   * a true equilibrium.
   */
  exploitability: number;
  /** The same number as a percentage of the starting pot, which is how solvers quote it. */
  exploitabilityPercent: number;
  /**
   * Average strategy at a node: `actions x hands`, each hand's column summing
   * to one. This is the answer; the final iteration's strategy is not.
   */
  strategyAt(node: PlayerNode): Float64Array;
}

export function solveRiver(
  tree: Tree,
  hands: HandSet,
  ranges: readonly [Float64Array, Float64Array],
  options: SolveOptions = {},
): Solution {
  const { iterations, alpha, beta, gamma, reportEvery } = { ...DEFAULT_SOLVE, ...options };
  const n = hands.count;

  for (const range of ranges) {
    if (range.length !== n) {
      throw new Error(`Range has ${range.length} weights but the board allows ${n} hands`);
    }
  }

  const stores: Store[] = tree.playerNodes.map((node) => {
    const actions = node.actions.length;
    return {
      actions,
      regret: new Float64Array(actions * n),
      strategySum: new Float64Array(actions * n),
      current: new Float64Array(actions * n),
      childReach: new Float64Array(actions * n),
      childValue: new Float64Array(actions * n),
      value: new Float64Array(n),
    };
  });

  // One shared buffer for every terminal in the tree. Safe because a parent
  // copies a child's result out before it visits the next child, so what a
  // terminal writes is always read before anything else can write it.
  const terminalValue = new Float64Array(n);
  const cardScratch = terminalScratch();

  function evaluateTerminal(
    node: Exclude<TreeNode, PlayerNode>,
    traverser: Player,
    reachOpponent: Float64Array,
  ): Float64Array {
    if (node.kind === "fold") {
      const payoff = traverser === node.winner ? node.amount : -node.amount;
      foldValues(hands, reachOpponent, payoff, terminalValue, cardScratch);
    } else {
      showdownValues(hands, reachOpponent, node.amount, terminalValue, cardScratch);
    }
    return terminalValue;
  }

  /** Regret matching: play positive regret in proportion, uniform when there is none. */
  function matchRegret(store: Store): void {
    const { actions, regret, current } = store;
    const uniform = 1 / actions;
    for (let h = 0; h < n; h++) {
      let positive = 0;
      for (let a = 0; a < actions; a++) {
        const value = regret[a * n + h]!;
        if (value > 0) positive += value;
      }
      if (positive > 0) {
        for (let a = 0; a < actions; a++) {
          const value = regret[a * n + h]!;
          current[a * n + h] = value > 0 ? value / positive : 0;
        }
      } else {
        for (let a = 0; a < actions; a++) current[a * n + h] = uniform;
      }
    }
  }

  function traverse(
    node: TreeNode,
    traverser: Player,
    reachSelf: Float64Array,
    reachOpponent: Float64Array,
  ): Float64Array {
    if (node.kind !== "player") return evaluateTerminal(node, traverser, reachOpponent);

    const store = stores[node.id]!;
    const { actions, current, childReach, childValue, value, regret, strategySum } = store;
    matchRegret(store);

    const acting = node.player === traverser;
    const source = acting ? reachSelf : reachOpponent;

    for (let a = 0; a < actions; a++) {
      const offset = a * n;
      for (let h = 0; h < n; h++) childReach[offset + h] = source[h]! * current[offset + h]!;

      const reach = childReach.subarray(offset, offset + n);
      const returned = acting
        ? traverse(node.children[a]!, traverser, reach, reachOpponent)
        : traverse(node.children[a]!, traverser, reachSelf, reach);

      // Copy before touching the next child: `returned` is that child's own
      // buffer and the next call will overwrite it.
      childValue.set(returned, offset);
    }

    if (acting) {
      for (let h = 0; h < n; h++) {
        let expected = 0;
        for (let a = 0; a < actions; a++) expected += current[a * n + h]! * childValue[a * n + h]!;
        value[h] = expected;

        const reach = reachSelf[h]!;
        for (let a = 0; a < actions; a++) {
          const index = a * n + h;
          regret[index] = regret[index]! + childValue[index]! - expected;
          strategySum[index] = strategySum[index]! + reach * current[index]!;
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

    traverse(tree.root, OOP, ranges[0], ranges[1]);
    traverse(tree.root, IP, ranges[1], ranges[0]);

    if (options.onProgress && t % reportEvery === 0) options.onProgress(t);
  }

  const average = stores.map((store) => normalise(store.strategySum, store.actions, n));

  const gap = measureExploitability(tree, hands, ranges, average);

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

/**
 * Turn accumulated strategy weight into probabilities.
 *
 * A hand with no accumulated weight was never reached, so its column is
 * meaningless rather than wrong; uniform keeps it from being NaN and keeps a
 * best response from reading garbage out of it.
 */
function normalise(strategySum: Float64Array, actions: number, n: number): Float64Array {
  const out = new Float64Array(actions * n);
  for (let h = 0; h < n; h++) {
    let total = 0;
    for (let a = 0; a < actions; a++) total += strategySum[a * n + h]!;
    if (total > 0) {
      for (let a = 0; a < actions; a++) out[a * n + h] = strategySum[a * n + h]! / total;
    } else {
      for (let a = 0; a < actions; a++) out[a * n + h] = 1 / actions;
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
 */
export function measureExploitability(
  tree: Tree,
  hands: HandSet,
  ranges: readonly [Float64Array, Float64Array],
  average: readonly Float64Array[],
): number {
  const n = hands.count;
  const mass = jointMass(hands, ranges[0], ranges[1]);
  if (mass <= 0) throw new Error("The two ranges never face each other on this board");

  const terminalValue = new Float64Array(n);
  const cardScratch = terminalScratch();
  const buffers = tree.playerNodes.map((node) => ({
    childReach: new Float64Array(node.actions.length * n),
    childValue: new Float64Array(node.actions.length * n),
    value: new Float64Array(n),
  }));

  function respond(node: TreeNode, hero: Player, reachOpponent: Float64Array): Float64Array {
    if (node.kind !== "player") {
      if (node.kind === "fold") {
        const payoff = hero === node.winner ? node.amount : -node.amount;
        foldValues(hands, reachOpponent, payoff, terminalValue, cardScratch);
      } else {
        showdownValues(hands, reachOpponent, node.amount, terminalValue, cardScratch);
      }
      return terminalValue;
    }

    const actions = node.actions.length;
    const { childReach, childValue, value } = buffers[node.id]!;
    const strategy = average[node.id]!;
    const heroActs = node.player === hero;

    for (let a = 0; a < actions; a++) {
      const offset = a * n;
      let returned: Float64Array;
      if (heroActs) {
        // The hero is free to pick per hand, so its own reach never enters the
        // recursion: a best response is computed hand by hand regardless of how
        // often it would have arrived here.
        returned = respond(node.children[a]!, hero, reachOpponent);
      } else {
        for (let h = 0; h < n; h++) {
          childReach[offset + h] = reachOpponent[h]! * strategy[offset + h]!;
        }
        returned = respond(node.children[a]!, hero, childReach.subarray(offset, offset + n));
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
    const values = respond(tree.root, hero, ranges[hero === OOP ? 1 : 0]);
    let sum = 0;
    for (let h = 0; h < n; h++) sum += ranges[hero]![h]! * values[h]!;
    total += sum / mass;
  }
  return total / 2;
}
