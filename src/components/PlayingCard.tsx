import { type Card, type Rank, type Suit, splitCard } from "../lib/cards";

const SUIT_SYMBOL: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<Suit, string> = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
};

const RANK_NAME: Record<Rank, string> = {
  A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten",
  "9": "Nine", "8": "Eight", "7": "Seven", "6": "Six",
  "5": "Five", "4": "Four", "3": "Three", "2": "Two",
};

/**
 * A real card face rather than an abstract chip.
 *
 * White stock with the standard red and black suits, because the whole point
 * of this screen is that you read your hand at a glance the way you would at a
 * table. A themed monochrome card would look tidier against the dark page and
 * would make you stop and decode it, which is the one thing a drill timer
 * should not be measuring.
 */
export function PlayingCard({ card, scale = 1 }: { card: Card; scale?: number }) {
  const { rank, suit } = splitCard(card);
  const isRed = suit === "h" || suit === "d";

  // Board cards are the same card at a smaller size rather than a different
  // component, so a five card board and the two in your hand cannot drift
  // apart in how they read.
  return (
    <div
      className="flex select-none flex-col items-center justify-center rounded-lg bg-neutral-50 shadow-lg ring-1 ring-black/20"
      style={{ width: `${4.5 * scale}rem`, height: `${6.25 * scale}rem` }}
      role="img"
      aria-label={`${RANK_NAME[rank]} of ${SUIT_NAME[suit]}`}
    >
      <span
        className={isRed ? "text-red-600" : "text-neutral-900"}
        style={{ fontSize: `${2 * scale}rem`, lineHeight: 1, fontWeight: 600 }}
      >
        {rank}
      </span>
      <span
        className={isRed ? "text-red-600" : "text-neutral-900"}
        style={{ fontSize: `${1.5 * scale}rem`, lineHeight: 1.2 }}
        aria-hidden
      >
        {SUIT_SYMBOL[suit]}
      </span>
    </div>
  );
}
