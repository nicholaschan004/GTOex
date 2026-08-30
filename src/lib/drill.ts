/** Generating a spot, and judging the answer. */

import {
  type Card,
  type HandClass,
  dealHoleCards,
  handClassOf,
} from "./cards";
import { POSITIONS, type Position, type RfiPosition, RFI_POSITIONS } from "./positions";
import { RFI_100BB } from "./charts/rfi";
import { parseRange } from "./range";

/**
 * Raise-first-in is a two way decision.
 *
 * There is no call button here, and that is not a simplification: nobody has
 * put in a raise, so there is nothing to call. Calling only becomes a legal
 * third option once we add spots facing an open, and the button set is derived
 * from the spot for exactly that reason.
 */
export type Action = "fold" | "raise";

export interface Spot {
  kind: "rfi";
  position: RfiPosition;
  /** Big blinds. Only 100 has chart data so far. */
  depth: 100;
  cards: [Card, Card];
  hand: HandClass;
}

/** Parsing the same handful of strings on every deal is wasteful. */
const RFI_RANGE_CACHE = new Map<RfiPosition, Set<HandClass>>();

export function rfiRange(position: RfiPosition): Set<HandClass> {
  const cached = RFI_RANGE_CACHE.get(position);
  if (cached) return cached;
  const parsed = parseRange(RFI_100BB[position]);
  RFI_RANGE_CACHE.set(position, parsed);
  return parsed;
}

export function rangeForSpot(spot: Spot): Set<HandClass> {
  return rfiRange(spot.position);
}

export function dealSpot(rng: () => number = Math.random): Spot {
  const index = Math.floor(rng() * RFI_POSITIONS.length);
  const position = RFI_POSITIONS[index];
  if (!position) throw new Error("Failed to choose a position");

  const cards = dealHoleCards(rng);
  return {
    kind: "rfi",
    position,
    depth: 100,
    cards,
    hand: handClassOf(cards[0], cards[1]),
  };
}

export function correctAction(spot: Spot): Action {
  return rangeForSpot(spot).has(spot.hand) ? "raise" : "fold";
}

export interface Verdict {
  correct: boolean;
  answered: Action;
  best: Action;
}

export function judge(spot: Spot, answered: Action): Verdict {
  const best = correctAction(spot);
  return { correct: answered === best, answered, best };
}

/** The seats that folded to you, which is everyone acting before your own. */
export function foldedBefore(position: Position): Position[] {
  const seat = POSITIONS.indexOf(position);
  return POSITIONS.slice(0, seat === -1 ? 0 : seat);
}
