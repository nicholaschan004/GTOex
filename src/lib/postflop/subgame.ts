/**
 * Solving the street you are standing on, from the ranges the hand produced.
 *
 * The flop comes out of a precomputed three street solve. The turn and the
 * river do not, and could not: after two players have acted on the flop, the
 * ranges are whatever those actions imply, and there are far too many pairs of
 * those to precompute. So they get solved when they arrive.
 *
 * That is not a compromise. It is better than reading them out of the flop
 * solve would have been, on two counts. The ranges are exact rather than the
 * flop's starting ones, and nothing here is bucketed -- the memory pressure
 * that forced the river into buckets came from holding 21,168 river subgames at
 * once, and there is only ever one of these.
 *
 * ## Why the request is plain numbers
 *
 * This runs in a Web Worker, so everything crossing the boundary has to be
 * structured-cloneable: no hand sets, no trees, no closures. The board and the
 * combinations that can be held are enough to rebuild both deterministically on
 * the other side, and rebuilding is microseconds against a solve that is
 * seconds.
 */

import { solve } from "../solver/cfr";
import { evaluateDecision } from "../solver/evaluate";
import {
  buildHandSet,
  buildRunoutViews,
  riverChanceWeight,
  type HandSet,
} from "../solver/hands";
import { buildStreets, streetNodesByPath, type Player, type Tree } from "../solver/tree";
import { CARD_COUNT } from "../equity";
import { describeActions, type ActionOption } from "./decision";
import { FULL_HAND_BETTING, LIVE_RIVER_BETTING } from "./scenario";

export interface SubgameRequest {
  /** The whole board: four cards to solve a turn, five to solve a river. */
  board: number[];
  /** Two entries per hand -- its cards -- in ascending order. */
  combos: number[];
  /** One weight per hand, out of position then in. */
  ranges: [number[], number[]];
  pot: number;
  stack: number;
  iterations: number;
}

export interface SubgameNode {
  /** Action indices from the root of this street. */
  path: string;
  player: Player;
  actions: ActionOption[];
  /** actions x hands, in the order `combos` gave them. */
  frequency: number[];
  /** actions x hands, in chips. */
  ev: number[];
}

export interface SubgameSolution {
  nodes: SubgameNode[];
  /** How long the solve took, so the screen can be honest about the wait. */
  elapsed: number;
}

/**
 * How hard to solve each street.
 *
 * A turn is a two street game -- turn betting, then 48 rivers each with a
 * betting round -- so it is fifty times the work of a river and gets fewer
 * iterations for it. Both numbers are read off `scripts/bench-live.ts` rather
 * than picked, measured on the widest ranges the mode can produce (504 hands,
 * no flop narrowing at all, so a real hand is faster than this):
 *
 * | iterations | turn | | river | |
 * | --- | --- | --- | --- | --- |
 * | 20 / 50 | 443ms | 1.765% | 31ms | 0.335% |
 * | 40 / 100 | 834ms | 0.377% | 41ms | 0.128% |
 * | **60 / 150** | **1260ms** | **0.177%** | **61ms** | **0.070%** |
 * | 100 / 300 | 2058ms | 0.062% | 122ms | 0.025% |
 *
 * 60 and 150 are where both clear the 0.5% of pot bar with room, and where the
 * turn still lands inside the time its card takes to reach the table. Going to
 * 100 would buy 0.1 points the flop solve upstream (0.393%) has already spent,
 * for another second of the hand spent waiting.
 */
export const LIVE_ITERATIONS = { turn: 60, river: 150 };

/** The tree a street is played on, which is not the tree it was solved with. */
export function subgameTree(board: number[], pot: number, stack: number): Tree {
  if (board.length === 5) {
    return buildStreets({ ...LIVE_RIVER_BETTING, startingPot: pot, effectiveStack: stack }, []);
  }
  if (board.length !== 4) throw new Error(`Cannot solve a street on ${board.length} cards`);
  return buildStreets({ ...FULL_HAND_BETTING.turn, startingPot: pot, effectiveStack: stack }, [
    {
      cards: 52 - board.length,
      chanceWeight: riverChanceWeight(board.length),
      betting: FULL_HAND_BETTING.river,
      viewSet: () => 0,
    },
  ]);
}

/** Rebuild the hand set a request describes. Deterministic, so both sides agree. */
export function handsOf(request: SubgameRequest): HandSet {
  const allowed = new Set<number>();
  for (let i = 0; i < request.combos.length; i += 2) {
    allowed.add(request.combos[i]! * CARD_COUNT + request.combos[i + 1]!);
  }
  return buildHandSet(request.board, request.board.length === 5, (a, b) =>
    allowed.has(a * CARD_COUNT + b),
  );
}

/**
 * Solve one street.
 *
 * Pure, and deliberately free of anything the worker boundary cannot carry, so
 * the same function is the worker's body and the tests' solver.
 */
export function solveSubgame(request: SubgameRequest): SubgameSolution {
  const started = Date.now();
  const hands = handsOf(request);

  if (hands.count * 2 !== request.combos.length) {
    throw new Error(
      `Asked for ${request.combos.length / 2} hands but the board allows ${hands.count}`,
    );
  }

  const ranges: [Float64Array, Float64Array] = [
    Float64Array.from(request.ranges[0]),
    Float64Array.from(request.ranges[1]),
  ];

  const tree = subgameTree(request.board, request.pot, request.stack);
  // A turn tree deals 48 rivers and needs to know what every hand is worth
  // under each. A river tree has no cards left to come.
  const views = request.board.length === 4 ? [buildRunoutViews(hands)] : undefined;

  const solution = solve(tree, hands, ranges, {
    iterations: request.iterations,
    viewSets: views,
    skipExploitability: true,
  });

  const average = tree.playerNodes.map((node) => solution.strategyAt(node));
  const nodes: SubgameNode[] = [];

  for (const [path, node] of streetNodesByPath(tree)) {
    const values = evaluateDecision(tree, hands, ranges, average, node, views);
    nodes.push({
      path,
      player: node.player,
      actions: describeActions(node),
      frequency: [...average[node.id]!],
      ev: [...values.values],
    });
  }

  return { nodes, elapsed: Date.now() - started };
}
