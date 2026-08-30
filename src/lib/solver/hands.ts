/**
 * The hands a player can hold on a given board.
 *
 * Preflop the unit of strategy is the hand class: AhKh and AsKs are the same
 * decision. On a board of Ah 7h 2c they are not remotely the same decision, so
 * postflop the unit is the combination, and there are C(47,2) = 1081 of them on
 * a five card board.
 *
 * Everything the solver needs about a hand that does not change during a solve
 * is computed once, here: which cards it holds, what it makes on this board,
 * and where it sits in the rank order. The board is fixed for the whole solve,
 * so the seven card evaluation and the sort both happen at setup and never
 * again. That matters more than it sounds: the sort is what makes showdown
 * evaluation linear rather than quadratic, and paying for it once per solve
 * rather than once per iteration is the difference between a solver that runs
 * in a browser tab and one that does not.
 */

import { CARD_COUNT, evaluate7, intToCard } from "../equity";

export interface HandSet {
  /** The board these hands are live on, as packed card integers. */
  board: readonly number[];
  /** Number of hands. 1081 on a five card board, 1128 on a four card one. */
  count: number;
  /** First card of hand i. Always the lower card index of the two. */
  cardA: Int32Array;
  /** Second card of hand i. */
  cardB: Int32Array;
  /**
   * Showdown rank of hand i on this board. Higher beats lower and equal ties.
   * Only meaningful when the board is complete; on a turn board it is the rank
   * of the four card board plus the hand, which orders nothing useful and is
   * not used.
   */
  rank: Float64Array;
  /** Hand indices sorted weakest rank first. Ties stay adjacent. */
  byRank: Int32Array;
  /** Hands containing card c, for card removal sums. */
  handsWithCard: readonly Int32Array[];
  /** Index of the hand holding cards a and b, or -1 if the board blocks it. */
  indexOf(a: number, b: number): number;
}

/**
 * Build the hand set for a board.
 *
 * `rankable` is false for an incomplete board, where a showdown rank does not
 * exist yet. Turn solving builds one of those for the turn betting round and a
 * separate ranked set per river card.
 */
export function buildHandSet(board: readonly number[], rankable = board.length === 5): HandSet {
  const onBoard = new Uint8Array(CARD_COUNT);
  for (const card of board) {
    if (card < 0 || card >= CARD_COUNT) throw new Error(`Card out of range: ${card}`);
    if (onBoard[card]) throw new Error(`Duplicate board card: ${intToCard(card)}`);
    onBoard[card] = 1;
  }

  const cardA: number[] = [];
  const cardB: number[] = [];
  // -1 rather than 0, so a lookup for a board-blocked hand is a value that
  // cannot be mistaken for hand zero.
  const lookup = new Int32Array(CARD_COUNT * CARD_COUNT).fill(-1);

  for (let a = 0; a < CARD_COUNT; a++) {
    if (onBoard[a]) continue;
    for (let b = a + 1; b < CARD_COUNT; b++) {
      if (onBoard[b]) continue;
      const index = cardA.length;
      lookup[a * CARD_COUNT + b] = index;
      lookup[b * CARD_COUNT + a] = index;
      cardA.push(a);
      cardB.push(b);
    }
  }

  const count = cardA.length;
  const rank = new Float64Array(count);
  if (rankable) {
    if (board.length !== 5) {
      throw new Error(`Showdown ranks need a five card board, got ${board.length}`);
    }
    const seven = [board[0]!, board[1]!, board[2]!, board[3]!, board[4]!, 0, 0];
    for (let i = 0; i < count; i++) {
      seven[5] = cardA[i]!;
      seven[6] = cardB[i]!;
      rank[i] = evaluate7(seven);
    }
  }

  const byRank = Int32Array.from({ length: count }, (_, i) => i);
  if (rankable) {
    // Sort by rank, then by index, so the order is deterministic. Two hands of
    // equal rank are genuinely equal at showdown, but a stable order keeps
    // solver output reproducible between runs.
    const order = Array.from(byRank).sort((x, y) => rank[x]! - rank[y]! || x - y);
    byRank.set(order);
  }

  const buckets: number[][] = Array.from({ length: CARD_COUNT }, () => []);
  for (let i = 0; i < count; i++) {
    buckets[cardA[i]!]!.push(i);
    buckets[cardB[i]!]!.push(i);
  }

  return {
    board: [...board],
    count,
    cardA: Int32Array.from(cardA),
    cardB: Int32Array.from(cardB),
    rank,
    byRank,
    handsWithCard: buckets.map((list) => Int32Array.from(list)),
    indexOf: (a, b) => lookup[a * CARD_COUNT + b] ?? -1,
  };
}

/**
 * Weights for every hand in the set, from a set of hand classes.
 *
 * A range written preflop ("22+, A2s+") expands to combinations, and the ones
 * the board blocks drop out. This is how a preflop chart becomes a postflop
 * starting range.
 */
export function weightsFromCombos(
  hands: HandSet,
  combos: Iterable<readonly [number, number]>,
  weight = 1,
): Float64Array {
  const out = new Float64Array(hands.count);
  for (const [a, b] of combos) {
    const index = hands.indexOf(a, b);
    if (index >= 0) out[index] = weight;
  }
  return out;
}
