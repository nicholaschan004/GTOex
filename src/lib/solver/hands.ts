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

import { CARD_COUNT, combosOfClass, evaluate7, intToCard } from "../equity";
import type { HandClass } from "../cards";

/**
 * Everything a showdown needs to know: how strong each hand is and what order
 * that puts them in.
 *
 * Split out from `HandSet` because a turn solve has one hand set and forty
 * eight of these, one per river card. The hands do not change when the river
 * lands, only what they are worth.
 */
export interface RankView {
  /** Showdown rank of hand i. Higher beats lower, equal ties. */
  rank: Float64Array;
  /** Hand indices sorted weakest first. Ties stay adjacent. */
  byRank: Int32Array;
}

export interface HandSet extends RankView {
  /** The board these hands are live on, as packed card integers. */
  board: readonly number[];
  /** Number of hands. 1081 on a five card board, 1128 on a four card one. */
  count: number;
  /** First card of hand i. Always the lower card index of the two. */
  cardA: Int32Array;
  /** Second card of hand i. */
  cardB: Int32Array;
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
 *
 * `allows` narrows the set to the combinations it accepts. Every loop in the
 * solver runs over every hand, and on a real spot most hands are ones neither
 * player can hold -- 491 of 1128 on a button-versus-big-blind turn. Dropping
 * them is not an approximation: a hand with no weight in either range
 * contributes zero to every reach sum, every card-removal sum and every
 * showdown sweep it appears in. See `compactToLive`, which is where the
 * predicate usually comes from.
 */
export function buildHandSet(
  board: readonly number[],
  rankable = board.length === 5,
  allows?: (a: number, b: number) => boolean,
): HandSet {
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
      if (allows && !allows(a, b)) continue;
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

/** A river card and what every turn hand is worth once it lands. */
export interface RiverView extends RankView {
  /** The card that came. */
  card: number;
  /** Hands this river makes impossible, because they were holding it. */
  blocked: Int32Array;
}

/**
 * What each of the forty eight possible rivers does to a turn hand set.
 *
 * The important decision here is that the INDEX SPACE DOES NOT CHANGE. A turn
 * board leaves 1128 hands and a river board leaves 1081, and it would be
 * natural to rebuild the hand set for each river. Doing that would mean
 * translating every reach vector through a different mapping forty eight times
 * per chance node, which is both slow and a rich source of off-by-one bugs.
 *
 * Instead every hand keeps its turn index for the whole solve. When a river
 * lands, the hands holding that card do not get renumbered, they get a reach of
 * zero and a rank of -1, so they sort to the bottom in one group, contribute
 * nothing to any running sum, and are subtracted back out at the chance node.
 * The cost is carrying 47 dead entries per river; the saving is that one index
 * means one meaning everywhere.
 */
export function buildRiverViews(hands: HandSet): RiverView[] {
  if (hands.board.length !== 4) {
    throw new Error(`River views need a four card board, got ${hands.board.length}`);
  }
  return buildRunoutViews(hands);
}

/** The cards still in the deck, in ascending order. */
export function deckAfter(taken: readonly number[]): number[] {
  const gone = new Uint8Array(CARD_COUNT);
  for (const card of taken) gone[card] = 1;
  const out: number[] = [];
  for (let card = 0; card < CARD_COUNT; card++) if (!gone[card]) out.push(card);
  return out;
}

/**
 * The same thing one street earlier, for a hand set built on a flop.
 *
 * A three street solve has two chance layers, and the second one's views depend
 * on which card the first one dealt: the ranks after `Th` comes on the turn and
 * then `2c` on the river are not the ranks after `2c` then `Th`, because the
 * hands that survive differ. So the caller passes the cards already dealt and
 * gets the views for the next one, and the tree records which set each chance
 * node uses.
 *
 * Ranks only exist once the board reaches five cards. On the turn layer of a
 * flop solve there is no showdown to rank for, and the tree guarantees it: a
 * showdown never sits directly under a chance layer that is not the last one,
 * because a line that gets all in early still deals the rest of the board
 * before anyone tables a hand.
 */
export function buildRunoutViews(hands: HandSet, dealt: readonly number[] = []): RiverView[] {
  const seen = [...hands.board, ...dealt];
  if (seen.length > 4) {
    throw new Error(`A runout view needs at most four cards down, got ${seen.length}`);
  }
  const rankable = seen.length === 4;

  // Hands holding a card that came earlier in the runout are already dead. They
  // cannot be ranked either, since evaluating them would use a card twice.
  const dealtOut = new Uint8Array(hands.count);
  for (const card of dealt) for (const hand of hands.handsWithCard[card]!) dealtOut[hand] = 1;

  const views: RiverView[] = [];
  const seven = [...seen, 0, 0, 0];

  for (const card of deckAfter(seen)) {
    const rank = new Float64Array(hands.count);
    const blocked = hands.handsWithCard[card]!;

    if (rankable) {
      const dead = Uint8Array.from(dealtOut);
      for (const hand of blocked) dead[hand] = 1;
      seven[4] = card;

      for (let i = 0; i < hands.count; i++) {
        if (dead[i]) {
          // Never read: the chance node zeroes these hands' reach and subtracts
          // their value back out. -1 keeps them in one group at the bottom of
          // the sort rather than scattered through it.
          rank[i] = -1;
          continue;
        }
        seven[5] = hands.cardA[i]!;
        seven[6] = hands.cardB[i]!;
        rank[i] = evaluate7(seven);
      }
    }

    const byRank = Int32Array.from({ length: hands.count }, (_, i) => i);
    if (rankable) {
      byRank.set(Array.from(byRank).sort((x, y) => rank[x]! - rank[y]! || x - y));
    }
    views.push({ card, rank, byRank, blocked });
  }

  return views;
}

/** A hand set with the hands nobody can hold taken out, and the ranges to match. */
export interface Compacted {
  hands: HandSet;
  ranges: [Float64Array, Float64Array];
  /** Index in the original set for each hand kept, for reading results back. */
  source: Int32Array;
}

/**
 * Drop the hands neither range holds.
 *
 * Exact, not an approximation, and measurably so: on a button-versus-big-blind
 * turn this takes 1128 hands down to 491 and the solve comes back with the same
 * exploitability to three decimal places, roughly twice as fast. A hand with no
 * weight in either range contributes nothing to any sum it appears in, so
 * carrying it is arithmetic on zero.
 *
 * `keep` is for hands that are not in either range but are being held anyway --
 * a player who took a hand to the flop that the chart folds still has to be
 * able to play it out.
 */
export function compactToLive(
  hands: HandSet,
  ranges: readonly [Float64Array, Float64Array],
  { threshold = 0, keep = [] as readonly number[] } = {},
): Compacted {
  const live = new Uint8Array(hands.count);
  for (let h = 0; h < hands.count; h++) {
    if (ranges[0][h]! > threshold || ranges[1][h]! > threshold) live[h] = 1;
  }
  for (const hand of keep) if (hand >= 0) live[hand] = 1;

  const source: number[] = [];
  for (let h = 0; h < hands.count; h++) if (live[h]) source.push(h);

  const allowed = new Set(source.map((h) => hands.cardA[h]! * CARD_COUNT + hands.cardB[h]!));
  const compact = buildHandSet(hands.board, hands.board.length === 5, (a, b) =>
    allowed.has(a * CARD_COUNT + b),
  );

  return {
    hands: compact,
    ranges: [
      Float64Array.from(source, (h) => ranges[0][h]!),
      Float64Array.from(source, (h) => ranges[1][h]!),
    ],
    source: Int32Array.from(source),
  };
}

/**
 * The chance probability of any one river, given that both players are holding
 * two cards each.
 *
 * Fifty two cards, less the four on the turn, less two in each hand, is forty
 * four. It is the same for every pair of hands that can coexist, which is what
 * lets the chance node use one constant instead of a per-hand weight, and it is
 * NOT forty eight: the deck the dealer draws from has forty eight cards, but
 * four of them are already in front of the two players.
 */
export function riverChanceWeight(boardLength: number): number {
  return 1 / (52 - boardLength - 4);
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

/**
 * A preflop range, on a board.
 *
 * The chart data this project already has is written in hand classes, and the
 * solver speaks combinations, so this is the join between the two halves of the
 * repo: a big blind defending range becomes 300-odd specific holdings once the
 * board has taken some of the cards away.
 */
export function weightsFromClasses(
  hands: HandSet,
  classes: Iterable<HandClass>,
  weight = 1,
): Float64Array {
  const out = new Float64Array(hands.count);
  for (const hand of classes) {
    for (const [a, b] of combosOfClass(hand)) {
      const index = hands.indexOf(a, b);
      if (index >= 0) out[index] = weight;
    }
  }
  return out;
}
