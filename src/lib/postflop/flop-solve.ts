/**
 * Solving a whole hand, which happens at build time and nowhere else.
 *
 * ## Why the river has to be bucketed here and did not have to be before
 *
 * A turn solve holds 48 river subgames. A flop solve holds 21,168 of them, one
 * for every (flop line, turn card, turn line, river card). At full resolution
 * that is a regret table per node per action per hand, which comes to gigabytes
 * of arrays that exist so a few hundred kilobytes of flop strategy can be read
 * off the top.
 *
 * `docs/postflop-solver.md` measured what river bucketing costs on a turn solve,
 * where the exact answer is affordable to compare against: 0.204% of pot at
 * K=64 against 0.030% exact. That measurement is why this is a considered
 * approximation rather than a shrug.
 *
 * The metric is each hand's equity against the opponent's range on that exact
 * river, sorted into equal-frequency groups. It is exact rather than sampled --
 * the board is known and both ranges are given -- and it keeps blockers, which
 * a bucketing on raw hand rank would throw away: two hands of identical rank
 * that block different amounts of the calling range are different hands, and on
 * a river that difference is most of what decides a bluff.
 */

import { bucketByScalar, riverEquities } from "../solver/abstraction";
import { evaluateDecision } from "../solver/evaluate";
import { measureExploitability, solve, type Solution } from "../solver/cfr";
import type { Bucketing } from "../solver/cfr";
import type { PlayerNode } from "../solver/tree";
import { describeActions, type StreetStrategy } from "./decision";
import type { FlopGame } from "./scenario";

/**
 * One clustering per river board per player.
 *
 * Per player because the metric is equity against the OPPONENT's range, and the
 * two players are not facing the same range. Per board because the ranks are
 * not the same board to board, which is the whole reason a flop tree carries a
 * view set per turn card.
 */
export function riverBuckets(game: FlopGame, buckets: number): (node: PlayerNode) => Bucketing | null {
  const { hands, ranges, viewSets } = game;

  const live: [Int32Array, Int32Array] = [
    Int32Array.from([...ranges[0].keys()].filter((h) => ranges[0][h]! > 0)),
    Int32Array.from([...ranges[1].keys()].filter((h) => ranges[1][h]! > 0)),
  ];

  // Keyed on the pair that names the board -- which turn card, then which river
  // under it -- plus who is acting.
  const cache = new Map<number, Bucketing>();

  return (node: PlayerNode) => {
    // Only the river is bucketed. The flop and turn layers are a few hundred
    // nodes between them and cost nothing to keep exact.
    if (node.street !== 2) return null;

    const key = (node.viewSet * 64 + node.chanceIndex) * 2 + node.player;
    const hit = cache.get(key);
    if (hit) return hit;

    const view = viewSets[node.viewSet]![node.chanceIndex]!;
    const opponent = ranges[node.player === 0 ? 1 : 0]!;
    const clustering = bucketByScalar(
      riverEquities(hands, view, opponent),
      live[node.player]!,
      buckets,
      hands.count,
    );
    const bucketing: Bucketing = { map: clustering.map, count: clustering.count };
    cache.set(key, bucketing);
    return bucketing;
  };
}

export interface SolvedFlop {
  game: FlopGame;
  solution: Solution;
  /** Flop and turn nodes. Only the flop ones are shipped; see `flop-data.ts`. */
  strategies: Map<number, StreetStrategy>;
  /**
   * How far from equilibrium the pair got, as a percentage of the flop pot,
   * measured in the FULL game: the strategy is expanded back over every hand
   * and the best response is free to punish hands that were bucketed together.
   */
  exploitabilityPercent: number;
}

export interface SolveFlopOptions {
  iterations?: number;
  buckets?: number;
  onProgress?: (iteration: number) => void;
}

/**
 * Solve a scenario and pull out the strategy for the streets that get shipped.
 *
 * The river is solved -- the flop and turn strategies would be wrong if it were
 * not -- but it is not kept. Twenty one thousand river subgames is megabytes,
 * of which one is ever played, and `playthrough.ts` solves that one live from
 * the ranges the hand actually produced. Which is also more accurate than
 * reading it out of here would be, because by then both ranges are known
 * exactly rather than bucketed.
 */
export function solveFlop(game: FlopGame, options: SolveFlopOptions = {}): SolvedFlop {
  const { iterations = 200, buckets = 16 } = options;

  const solution = solve(game.tree, game.hands, game.ranges, {
    iterations,
    viewSets: game.viewSets,
    bucketsFor: riverBuckets(game, buckets),
    skipExploitability: true,
    onProgress: options.onProgress,
    reportEvery: 10,
  });

  const average = game.tree.playerNodes.map((node) => solution.strategyAt(node));
  const strategies = new Map<number, StreetStrategy>();

  for (const node of game.tree.playerNodes) {
    if (node.street === 2) continue;
    strategies.set(node.id, {
      actions: describeActions(node),
      player: node.player,
      frequency: average[node.id]!,
      // Values only where the hero decides: they are what prices a decision,
      // and the opponent's nodes only need frequencies to act out of.
      ev:
        node.player === game.seats.hero
          ? evaluateDecision(
              game.tree,
              game.hands,
              game.ranges,
              average,
              node,
              game.viewSets,
            ).values
          : new Float64Array(node.actions.length * game.hands.count),
    });
  }

  const gap = measureExploitability(
    game.tree,
    game.hands,
    game.ranges,
    average,
    game.viewSets,
  );

  return {
    game,
    solution,
    strategies,
    exploitabilityPercent: (gap / game.seats.pot) * 100,
  };
}
