/**
 * Seven card hand evaluation and all-in preflop equity.
 *
 * This is the part of the project that computes rather than looks up. The
 * push/fold charts are solved on top of it, and the only reason those charts
 * can claim to be right is that this file can be checked against equities
 * everyone already agrees on.
 *
 * Cards are packed into integers for speed: `rank * 4 + suit`, where rank runs
 * 0 for a deuce to 12 for an ace. Note that is the REVERSE of `cards.ts`, where
 * index 0 is an ace. Straight detection wants ascending ranks and the rest of
 * the app wants aces first, so the two orderings are converted at the boundary
 * rather than compromised in the middle.
 */

import { RANKS, type Card, type HandClass, SUITS, isRank, isSuit, rankIndex, splitCard } from "./cards";

export const CARD_COUNT = 52;

/** cards.ts is ace-first; the evaluator is deuce-first. */
export function rankValue(rank: (typeof RANKS)[number]): number {
  return 12 - rankIndex(rank);
}

export function cardToInt(card: Card): number {
  const { rank, suit } = splitCard(card);
  return rankValue(rank) * 4 + SUITS.indexOf(suit);
}

export function intToCard(value: number): Card {
  const rank = RANKS[12 - (value >> 2)];
  const suit = SUITS[value & 3];
  if (!rank || !suit) throw new Error(`Card out of range: ${value}`);
  return `${rank}${suit}`;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

/**
 * Pack a category and up to five tiebreak ranks into one comparable integer.
 * Four bits each, category on top, so a plain numeric compare orders hands.
 */
function score(category: number, kickers: number[]): number {
  let packed = category;
  for (let i = 0; i < 5; i++) {
    packed = (packed << 4) | (kickers[i] ?? 0);
  }
  return packed;
}

/**
 * The high rank of the best straight in a 13 bit rank mask, or -1.
 * Returns 3 (a five) for the wheel, since A2345 is the one straight where the
 * ace plays low.
 */
function straightHigh(mask: number): number {
  for (let high = 12; high >= 4; high--) {
    const need =
      (1 << high) | (1 << (high - 1)) | (1 << (high - 2)) | (1 << (high - 3)) | (1 << (high - 4));
    if ((mask & need) === need) return high;
  }
  const wheel = (1 << 12) | (1 << 3) | (1 << 2) | (1 << 1) | 1;
  return (mask & wheel) === wheel ? 3 : -1;
}

function topRanks(mask: number, count: number, exclude = 0): number[] {
  const out: number[] = [];
  for (let rank = 12; rank >= 0 && out.length < count; rank--) {
    if (exclude & (1 << rank)) continue;
    if (mask & (1 << rank)) out.push(rank);
  }
  while (out.length < count) out.push(0);
  return out;
}

/** Rank a seven card hand. Higher is better; values are only comparable to each other. */
export function evaluate7(cards: readonly number[]): number {
  const rankCount = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const suitCount = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];
  let mask = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i] as number;
    const rank = card >> 2;
    const suit = card & 3;
    rankCount[rank]!++;
    suitCount[suit]!++;
    suitMask[suit]! |= 1 << rank;
    mask |= 1 << rank;
  }

  let flushSuit = -1;
  for (let suit = 0; suit < 4; suit++) {
    if (suitCount[suit]! >= 5) flushSuit = suit;
  }

  if (flushSuit >= 0) {
    const high = straightHigh(suitMask[flushSuit]!);
    if (high >= 0) return score(CATEGORY.STRAIGHT_FLUSH, [high]);
  }

  let quad = -1;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let rank = 12; rank >= 0; rank--) {
    const count = rankCount[rank]!;
    if (count === 4 && quad < 0) quad = rank;
    else if (count === 3) trips.push(rank);
    else if (count === 2) pairs.push(rank);
  }

  if (quad >= 0) {
    return score(CATEGORY.QUADS, [quad, ...topRanks(mask, 1, 1 << quad)]);
  }

  // Two sets plays the lower one as the pair; a set plus pairs takes the best pair.
  if (trips.length >= 2) return score(CATEGORY.FULL_HOUSE, [trips[0]!, trips[1]!]);
  if (trips.length === 1 && pairs.length >= 1) {
    return score(CATEGORY.FULL_HOUSE, [trips[0]!, pairs[0]!]);
  }

  if (flushSuit >= 0) return score(CATEGORY.FLUSH, topRanks(suitMask[flushSuit]!, 5));

  const straight = straightHigh(mask);
  if (straight >= 0) return score(CATEGORY.STRAIGHT, [straight]);

  if (trips.length === 1) {
    return score(CATEGORY.TRIPS, [trips[0]!, ...topRanks(mask, 2, 1 << trips[0]!)]);
  }
  if (pairs.length >= 2) {
    const exclude = (1 << pairs[0]!) | (1 << pairs[1]!);
    return score(CATEGORY.TWO_PAIR, [pairs[0]!, pairs[1]!, ...topRanks(mask, 1, exclude)]);
  }
  if (pairs.length === 1) {
    return score(CATEGORY.PAIR, [pairs[0]!, ...topRanks(mask, 3, 1 << pairs[0]!)]);
  }
  return score(CATEGORY.HIGH_CARD, topRanks(mask, 5));
}

export function categoryOf(handScore: number): number {
  return handScore >> 20;
}

// ---------------------------------------------------------------------------
// Combinations of a hand class
// ---------------------------------------------------------------------------

/** Every concrete two card combination a class stands for, as packed ints. */
export function combosOfClass(hand: HandClass): [number, number][] {
  const first = hand.charAt(0);
  const second = hand.charAt(1);
  const suffix = hand.charAt(2);
  if (!isRank(first) || !isRank(second)) throw new Error(`Bad hand class: ${hand}`);

  const hi = rankValue(first);
  const lo = rankValue(second);
  const out: [number, number][] = [];

  if (!suffix) {
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) out.push([hi * 4 + a, hi * 4 + b]);
    }
    return out;
  }
  if (suffix === "s") {
    for (let s = 0; s < 4; s++) out.push([hi * 4 + s, lo * 4 + s]);
    return out;
  }
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      if (a !== b) out.push([hi * 4 + a, lo * 4 + b]);
    }
  }
  return out;
}

export function parseCards(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => {
      const rank = token.charAt(0).toUpperCase();
      const suit = token.charAt(1).toLowerCase();
      if (!isRank(rank) || !isSuit(suit)) throw new Error(`Bad card: ${token}`);
      return cardToInt(`${rank}${suit}`);
    });
}

// ---------------------------------------------------------------------------
// Equity
// ---------------------------------------------------------------------------

export interface Equity {
  /** Share of the pot the first hand wins, ties split, as a fraction of 1. */
  hero: number;
  wins: number;
  ties: number;
  losses: number;
  trials: number;
}

function equityFromCounts(wins: number, ties: number, losses: number): Equity {
  const trials = wins + ties + losses;
  return { hero: trials === 0 ? 0 : (wins + ties / 2) / trials, wins, ties, losses, trials };
}

/**
 * Exact all-in equity by running out every board.
 *
 * C(48,5) is 1,712,304 boards, which is a second or two. Slow for bulk work but
 * it is ground truth, and the Monte Carlo path is checked against it.
 */
export function exactEquity(hero: readonly number[], villain: readonly number[]): Equity {
  const dead = new Set([...hero, ...villain]);
  if (dead.size !== hero.length + villain.length) {
    throw new Error("Hands share a card");
  }
  const deck: number[] = [];
  for (let card = 0; card < CARD_COUNT; card++) {
    if (!dead.has(card)) deck.push(card);
  }

  const heroHand = [hero[0]!, hero[1]!, 0, 0, 0, 0, 0];
  const villainHand = [villain[0]!, villain[1]!, 0, 0, 0, 0, 0];
  let wins = 0;
  let ties = 0;
  let losses = 0;

  const n = deck.length;
  for (let a = 0; a < n - 4; a++) {
    heroHand[2] = villainHand[2] = deck[a]!;
    for (let b = a + 1; b < n - 3; b++) {
      heroHand[3] = villainHand[3] = deck[b]!;
      for (let c = b + 1; c < n - 2; c++) {
        heroHand[4] = villainHand[4] = deck[c]!;
        for (let d = c + 1; d < n - 1; d++) {
          heroHand[5] = villainHand[5] = deck[d]!;
          for (let e = d + 1; e < n; e++) {
            heroHand[6] = villainHand[6] = deck[e]!;
            const h = evaluate7(heroHand);
            const v = evaluate7(villainHand);
            if (h > v) wins++;
            else if (h < v) losses++;
            else ties++;
          }
        }
      }
    }
  }
  return equityFromCounts(wins, ties, losses);
}

/** Sampled all-in equity. Same answer as exactEquity, far cheaper. */
export function monteCarloEquity(
  hero: readonly number[],
  villain: readonly number[],
  trials: number,
  rng: () => number = Math.random,
): Equity {
  const dead = new Set([...hero, ...villain]);
  if (dead.size !== hero.length + villain.length) {
    throw new Error("Hands share a card");
  }
  const deck: number[] = [];
  for (let card = 0; card < CARD_COUNT; card++) {
    if (!dead.has(card)) deck.push(card);
  }

  const heroHand = [hero[0]!, hero[1]!, 0, 0, 0, 0, 0];
  const villainHand = [villain[0]!, villain[1]!, 0, 0, 0, 0, 0];
  let wins = 0;
  let ties = 0;
  let losses = 0;

  for (let trial = 0; trial < trials; trial++) {
    // Partial Fisher-Yates: only the first five slots need to be shuffled.
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const swap = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = swap;
      heroHand[2 + i] = villainHand[2 + i] = deck[i]!;
    }
    const h = evaluate7(heroHand);
    const v = evaluate7(villainHand);
    if (h > v) wins++;
    else if (h < v) losses++;
    else ties++;
  }
  return equityFromCounts(wins, ties, losses);
}
