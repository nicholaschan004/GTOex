/**
 * Terminal node evaluation, in linear time.
 *
 * At a terminal you need, for each of the hero's hands, its value against the
 * opponent's entire reach-weighted range. Written the obvious way that is
 * 1081 x 1081 per terminal per iteration, and the solver is unusable. Both
 * kinds of terminal are O(n) instead, and this file is those two algorithms.
 *
 * The thing that makes both of them fiddly is card removal. If the hero holds
 * the ace of hearts then every opponent hand containing it is impossible, so
 * every sum has to exclude them. That is not a rounding correction: which hands
 * you block is a large part of why a river bluff works, and a solver that
 * skipped it would find bluffs that do not exist.
 */

import { CARD_COUNT } from "../equity";
import type { HandSet, RankView } from "./hands";

/**
 * Value of a fold, for every hero hand.
 *
 * The hero collects `payoff` against every opponent hand its own two cards do
 * not make impossible, so the only work is the live weight of the opponent's
 * range. Sum the whole range once, sum it per card once, and each hero hand is
 * then three lookups:
 *
 *     live(a,b) = total - perCard[a] - perCard[b] + reach[{a,b}]
 *
 * The last term adds back the hand {a,b} itself, which both card sums removed
 * and which should only be removed once.
 */
export function foldValues(
  hands: HandSet,
  opponentReach: Float64Array,
  payoff: number,
  out: Float64Array,
  scratch: Float64Array,
): void {
  const { count, cardA, cardB } = hands;
  scratch.fill(0);

  let total = 0;
  for (let i = 0; i < count; i++) {
    const weight = opponentReach[i]!;
    if (weight === 0) continue;
    total += weight;
    const a = cardA[i]!;
    const b = cardB[i]!;
    scratch[a] = scratch[a]! + weight;
    scratch[b] = scratch[b]! + weight;
  }

  for (let i = 0; i < count; i++) {
    const live = total - scratch[cardA[i]!]! - scratch[cardB[i]!]! + opponentReach[i]!;
    out[i] = payoff * live;
  }
}

/**
 * Value of a showdown, for every hero hand.
 *
 * Ranks are a total order, so sorting once turns "how much of the range do I
 * beat" into a running sum. Sweep up the order carrying the reach of everything
 * strictly weaker, plus the same sums per card; each hand then reads its answer
 * off the sweep with the blocked part subtracted. Sweep back down for the part
 * that beats it. Equal ranks are processed as a group and fold into the running
 * sums only after the whole group has read from them, which is what makes a tie
 * worth nothing to either side.
 *
 * `amount` is half the final pot: at a showdown both players have contributed
 * equally, so winning gains exactly what losing costs.
 *
 * The sort itself is not here. It happens once when the ranks are built,
 * because the board does not change during a solve. `view` is what separates
 * the two: the hands are fixed for a whole turn solve, but what they are worth
 * changes with every river, so the ranks and their order arrive separately.
 */
export function showdownValues(
  hands: HandSet,
  view: RankView,
  opponentReach: Float64Array,
  amount: number,
  out: Float64Array,
  scratch: Float64Array,
): void {
  const { count, cardA, cardB } = hands;
  const { rank, byRank } = view;

  out.fill(0);
  scratch.fill(0);

  // Upward: everything the hand beats.
  let running = 0;
  for (let start = 0; start < count; ) {
    const groupRank = rank[byRank[start]!]!;
    let end = start;
    while (end < count && rank[byRank[end]!]! === groupRank) end++;

    for (let k = start; k < end; k++) {
      const hand = byRank[k]!;
      out[hand] = out[hand]! + amount * (running - scratch[cardA[hand]!]! - scratch[cardB[hand]!]!);
    }
    for (let k = start; k < end; k++) {
      const hand = byRank[k]!;
      const weight = opponentReach[hand]!;
      if (weight === 0) continue;
      running += weight;
      const a = cardA[hand]!;
      const b = cardB[hand]!;
      scratch[a] = scratch[a]! + weight;
      scratch[b] = scratch[b]! + weight;
    }
    start = end;
  }

  // Downward: everything that beats the hand.
  scratch.fill(0);
  running = 0;
  for (let end = count; end > 0; ) {
    const groupRank = rank[byRank[end - 1]!]!;
    let start = end;
    while (start > 0 && rank[byRank[start - 1]!]! === groupRank) start--;

    for (let k = start; k < end; k++) {
      const hand = byRank[k]!;
      out[hand] = out[hand]! - amount * (running - scratch[cardA[hand]!]! - scratch[cardB[hand]!]!);
    }
    for (let k = start; k < end; k++) {
      const hand = byRank[k]!;
      const weight = opponentReach[hand]!;
      if (weight === 0) continue;
      running += weight;
      const a = cardA[hand]!;
      const b = cardB[hand]!;
      scratch[a] = scratch[a]! + weight;
      scratch[b] = scratch[b]! + weight;
    }
    end = start;
  }
}

/**
 * The total probability mass of the two ranges facing each other, which is what
 * a counterfactual value has to be divided by to become an expected value.
 *
 * It is the fold computation with a payoff of one: for each hero hand, how much
 * opponent range is live behind it.
 */
export function jointMass(
  hands: HandSet,
  heroReach: Float64Array,
  opponentReach: Float64Array,
): number {
  const scratch = new Float64Array(CARD_COUNT);
  const live = new Float64Array(hands.count);
  foldValues(hands, opponentReach, 1, live, scratch);

  let mass = 0;
  for (let i = 0; i < hands.count; i++) mass += heroReach[i]! * live[i]!;
  return mass;
}

/** A scratch buffer sized for the card sums the two sweeps need. */
export function terminalScratch(): Float64Array {
  return new Float64Array(CARD_COUNT);
}
