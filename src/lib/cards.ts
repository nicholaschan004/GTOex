/**
 * Cards, hand classes, and the 13x13 grid every poker range is drawn on.
 *
 * A "hand class" is the unit strategy is written in: AA, AKs, AKo. There are
 * 169 of them, standing in for 1326 actual two card combinations. Everything
 * downstream (charts, the grid, scoring) speaks hand classes; only dealing and
 * rendering care about suits.
 */

/** High to low, so a LOWER index is a STRONGER rank. */
export const RANKS = [
  "A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2",
] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ["s", "h", "d", "c"] as const;
export type Suit = (typeof SUITS)[number];

/** e.g. "Ah", "Ts", "2c". */
export type Card = `${Rank}${Suit}`;

/**
 * e.g. "AA", "AKs", "AKo". The higher rank always comes first, so "KAs" is not
 * a value this type is ever allowed to hold.
 */
export type HandClass =
  | `${Rank}${Rank}`
  | `${Rank}${Rank}s`
  | `${Rank}${Rank}o`;

/** Every two card combination in a 52 card deck: C(52,2). */
export const TOTAL_COMBOS = 1326;

const RANK_INDEX = new Map<string, number>(RANKS.map((r, i) => [r, i]));
const SUIT_SET = new Set<string>(SUITS);

export function isRank(value: string): value is Rank {
  return RANK_INDEX.has(value);
}

export function isSuit(value: string): value is Suit {
  return SUIT_SET.has(value);
}

/** 0 for an ace, 12 for a deuce. Lower is stronger. */
export function rankIndex(rank: Rank): number {
  const index = RANK_INDEX.get(rank);
  if (index === undefined) throw new Error(`Unknown rank: ${rank}`);
  return index;
}

export function splitCard(card: Card): { rank: Rank; suit: Suit } {
  const rank = card.charAt(0);
  const suit = card.charAt(1);
  if (!isRank(rank) || !isSuit(suit)) {
    throw new Error(`Malformed card: ${card}`);
  }
  return { rank, suit };
}

/** Reduce two concrete cards to the class strategy is written in. */
export function handClassOf(a: Card, b: Card): HandClass {
  const first = splitCard(a);
  const second = splitCard(b);

  if (first.rank === second.rank) return `${first.rank}${second.rank}`;

  const firstIsHigher = rankIndex(first.rank) < rankIndex(second.rank);
  const hi = firstIsHigher ? first.rank : second.rank;
  const lo = firstIsHigher ? second.rank : first.rank;

  return first.suit === second.suit ? `${hi}${lo}s` : `${hi}${lo}o`;
}

/** How many of the 1326 combinations a class covers. */
export function comboCount(hand: HandClass): number {
  if (hand.length === 2) return 6; // pair: C(4,2)
  return hand.endsWith("s") ? 4 : 12;
}

/**
 * The class at a position in the standard 13x13 grid.
 *
 * Ranks run A..2 across and down, so the diagonal is the pairs, everything
 * above it is suited, and everything below it is offsuit. This is the layout
 * every poker tool uses and the reason the grid is readable at a glance.
 */
export function gridCell(row: number, col: number): HandClass {
  const rowRank = RANKS[row];
  const colRank = RANKS[col];
  if (!rowRank || !colRank) {
    throw new Error(`Grid cell out of bounds: ${row},${col}`);
  }
  if (row === col) return `${rowRank}${rowRank}`;
  return col > row ? `${rowRank}${colRank}s` : `${colRank}${rowRank}o`;
}

/** All 169 classes, in grid reading order. */
export function allHandClasses(): HandClass[] {
  const out: HandClass[] = [];
  for (let row = 0; row < RANKS.length; row++) {
    for (let col = 0; col < RANKS.length; col++) {
      out.push(gridCell(row, col));
    }
  }
  return out;
}

/** Share of all possible starting hands a set of classes covers, as a percent. */
export function comboPercent(hands: Iterable<HandClass>): number {
  let combos = 0;
  for (const hand of hands) combos += comboCount(hand);
  return (combos / TOTAL_COMBOS) * 100;
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) deck.push(`${rank}${suit}`);
  }
  return deck;
}

/**
 * Deal two cards uniformly from the deck.
 *
 * Note this deals CARDS and derives the class, rather than picking one of the
 * 169 classes at random. Those are different distributions and the difference
 * matters: a pair is 6 of 1326 combinations and AKo is 12, so picking classes
 * uniformly would show you pocket aces twice as often as AKo. A trainer that
 * deals a distorted deck teaches distorted intuitions about how often spots
 * actually come up.
 */
export function dealHoleCards(rng: () => number = Math.random): [Card, Card] {
  const deck = fullDeck();
  const first = Math.floor(rng() * deck.length);
  const a = deck[first];
  if (!a) throw new Error("Deal produced no first card");

  deck.splice(first, 1);
  const second = Math.floor(rng() * deck.length);
  const b = deck[second];
  if (!b) throw new Error("Deal produced no second card");

  return [a, b];
}
