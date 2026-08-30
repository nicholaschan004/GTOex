/**
 * Bet sizing.
 *
 * BASELINE CONVENTION, NOT SOLVER OUTPUT. Same standing as the opening and
 * defending charts, and labelled that way on screen for the same reason. A
 * chart tells you which hands to play, which is only half of the decision:
 * "open" is not an action, it is an action and a price, and a trainer that
 * leaves the price off is teaching half a habit.
 *
 * Two rules generate every number here rather than a table of sizes per spot.
 * A table would be another eighty figures to keep consistent, and these two
 * rules already land on the conventional ones:
 *
 *   1. Opens are a flat number of big blinds, larger from the small blind. At
 *      six handed the seat changes which hands you open, not what you open them
 *      for. The small blind is the exception because it plays every later
 *      street out of position against a big blind that closes the action, so it
 *      has to charge more to deny a cheap defence.
 *
 *   2. A 3-bet is 3x the open in position and 4x out of position. The extra
 *      size out of position buys the same thing the small blind's larger open
 *      buys: fewer callers, in the spots where playing on is worth least.
 *
 * Worked through, those give a big blind 3-bet over a 2.5bb button open of
 * 10bb, and a button 3-bet over a cutoff open of 7.5bb, which is where
 * convention sits. That agreement is the only claim being made for them.
 */

import { POSITIONS, type Position, type RfiPosition, type StackDepth } from "./positions";

export const SMALL_BLIND = 0.5;
export const BIG_BLIND = 1;

/**
 * Seat order once the flop is out: the blinds act first and the button acts
 * last, which is the whole reason the button is worth anything.
 *
 * This is a rotation of the preflop order in `POSITIONS`, not a second list of
 * seats, and `sizing.test.ts` holds it to that.
 */
export const POSTFLOP_ORDER = ["SB", "BB", "UTG", "HJ", "CO", "BTN"] as const;

/**
 * Whether a seat acts after another one on every street still to come.
 *
 * That is what "in position" means, and it is the only input the 3-bet rule
 * needs. Worth noting the big blind is in position on the small blind, so a big
 * blind 3-bet against a small blind open is the smaller of the two sizes.
 */
export function inPositionOn(seat: Position, other: Position): boolean {
  return POSTFLOP_ORDER.indexOf(seat) > POSTFLOP_ORDER.indexOf(other);
}

/**
 * Opens in big blinds, by stack depth.
 *
 * Twenty big blinds opens smaller because the stack is smaller: a 2.5bb open
 * puts an eighth of it in before the flop, and the shallower things get the
 * more a raise that size is a shove with extra steps. Forty and up are the same
 * number because a size in big blinds stops caring about the stack once there
 * is enough of it to play three streets.
 */
const OPEN_SIZE: Record<StackDepth, { default: number; smallBlind: number }> = {
  20: { default: 2, smallBlind: 2.5 },
  40: { default: 2.5, smallBlind: 3 },
  100: { default: 2.5, smallBlind: 3 },
  200: { default: 2.5, smallBlind: 3 },
};

export const THREE_BET_IN_POSITION = 3;
export const THREE_BET_OUT_OF_POSITION = 4;

/** Chips are quoted to a tenth of a blind. Anything finer is arithmetic noise. */
export function roundChips(bb: number): number {
  return Math.round(bb * 10) / 10;
}

/** How a size reads on screen: "2.5bb", "10bb", never "10.0bb". */
export function formatChips(bb: number): string {
  return `${roundChips(bb)}bb`;
}

export function openSize(position: RfiPosition, depth: StackDepth): number {
  const row = OPEN_SIZE[depth];
  return position === "SB" ? row.smallBlind : row.default;
}

export function threeBetSize(
  opener: RfiPosition,
  defender: Position,
  depth: StackDepth,
): number {
  const multiplier = inPositionOn(defender, opener)
    ? THREE_BET_IN_POSITION
    : THREE_BET_OUT_OF_POSITION;
  return roundChips(openSize(opener, depth) * multiplier);
}

/** The blind a seat has already posted before anyone acts. */
export function blindPostedBy(position: Position): number {
  if (position === "SB") return SMALL_BLIND;
  if (position === "BB") return BIG_BLIND;
  return 0;
}

/** Every seat, which the postflop order has to be a rearrangement of. */
export const ALL_POSITIONS: readonly Position[] = POSITIONS;
