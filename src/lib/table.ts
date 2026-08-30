/**
 * The table you are sitting at, as a seat map rather than a sentence.
 *
 * "UTG, HJ fold. Action on you." is accurate, and it takes a beat to picture.
 * Position is a spatial fact -- how many players are still behind you, who put
 * money in, what it costs to continue -- so it is worth drawing spatially. The
 * sentence stays as well, because it is what a screen reader gets.
 *
 * The hero is always the first seat and the rest run CLOCKWISE from there,
 * which is the direction the action moves. `PokerTable` puts the first seat at
 * the bottom, so walking this array is walking the table to your left.
 *
 * `POSITIONS` is already in clockwise seating order (the small blind sits to
 * the button's left, the big blind to the small blind's), and that is the same
 * order those seats act in before the flop, so one array serves both.
 */

import { POSITIONS, type Position } from "./positions";
import type { PushFoldSpot, RfiSpot, Spot, VsOpenSpot } from "./drill";
import {
  BIG_BLIND,
  blindPostedBy,
  formatChips,
  openSize,
  roundChips,
  threeBetSize,
} from "./sizing";

export type SeatRole = "hero" | "raiser" | "folded" | "waiting";

export interface Seat {
  position: Position;
  role: SeatRole;
  /** Chips in front of the seat, in big blinds. Posted blinds count. */
  committed: number;
  /** Draws the dealer button. Heads up that is the small blind, not the button seat. */
  dealer: boolean;
}

export interface TableView {
  /** Clockwise from the hero, who is always index 0. */
  seats: Seat[];
  /** Everything wagered so far, in big blinds. */
  pot: number;
  /** What continuing costs the hero. Zero when nobody has raised. */
  toCall: number;
  /** What a raise makes it, or null where raising is not on offer. */
  raiseTo: number | null;
  /**
   * The share of the final pot a call has to win to break even, or null where
   * the number would mislead. See `potOddsOf` for when that is.
   */
  potOdds: number | null;
}

/** Heads up there are two seats, and the small blind is on the button. */
const HEADS_UP = ["SB", "BB"] as const;

function rotateToHero(seats: Seat[]): Seat[] {
  const hero = seats.findIndex((seat) => seat.role === "hero");
  if (hero === -1) throw new Error("A table needs a hero seat");
  return [...seats.slice(hero), ...seats.slice(0, hero)];
}

function potOf(seats: Seat[]): number {
  return roundChips(seats.reduce((sum, seat) => sum + seat.committed, 0));
}

export function tableFor(spot: Spot): TableView {
  switch (spot.kind) {
    case "rfi":
      return rfiTable(spot);
    case "vs-open":
      return vsOpenTable(spot);
    case "pushfold":
      return pushFoldTable(spot);
  }
}

function rfiTable(spot: RfiSpot): TableView {
  const heroSeat = POSITIONS.indexOf(spot.position);

  const seats = POSITIONS.map((position, index): Seat => {
    const role: SeatRole =
      position === spot.position ? "hero" : index < heroSeat ? "folded" : "waiting";
    return { position, role, committed: blindPostedBy(position), dealer: position === "BTN" };
  });

  return {
    seats: rotateToHero(seats),
    pot: potOf(seats),
    // Nobody has raised, so there is nothing to call. The big blind is sitting
    // there, but limping is not one of the actions this spot offers and
    // quoting a price for a move you cannot make is worse than quoting none.
    toCall: 0,
    raiseTo: openSize(spot.position, spot.depth),
    potOdds: null,
  };
}

function vsOpenTable(spot: VsOpenSpot): TableView {
  const heroSeat = POSITIONS.indexOf(spot.position);
  const open = openSize(spot.opener, spot.depth);

  const seats = POSITIONS.map((position, index): Seat => {
    const role: SeatRole =
      position === spot.position
        ? "hero"
        : position === spot.opener
          ? "raiser"
          : index < heroSeat
            ? "folded"
            : "waiting";

    // A raise swallows the blind that seat had already posted rather than
    // stacking on top of it, so the opener's chips are the open and nothing
    // more, even when the opener is the small blind.
    return {
      position,
      role,
      committed: role === "raiser" ? open : blindPostedBy(position),
      dealer: position === "BTN",
    };
  });

  return {
    seats: rotateToHero(seats),
    pot: potOf(seats),
    toCall: roundChips(open - blindPostedBy(spot.position)),
    raiseTo: threeBetSize(spot.opener, spot.position, spot.depth),
    // No pot odds here on purpose. The hand is not over, so the price of the
    // call is only part of what the call is worth, and a percentage printed
    // next to the button would read as the answer when it is not even the
    // question. The all-in spot below is the one place it is exact.
    potOdds: null,
  };
}

function pushFoldTable(spot: PushFoldSpot): TableView {
  const facingAShove = spot.seat === "BB";

  const seats = HEADS_UP.map((position): Seat => {
    const role: SeatRole =
      position === spot.seat ? "hero" : position === "SB" && facingAShove ? "raiser" : "waiting";
    return {
      position,
      role,
      committed: role === "raiser" ? spot.stack : blindPostedBy(position),
      dealer: position === "SB",
    };
  });

  const pot = potOf(seats);
  // The small blind is choosing between all in and folding, so like the
  // opening spots it is not facing a price. The big blind is facing the stack,
  // less the blind it already has out there.
  const toCall = facingAShove ? roundChips(spot.stack - BIG_BLIND) : 0;

  return {
    seats: rotateToHero(seats),
    pot,
    toCall,
    raiseTo: facingAShove ? null : spot.stack,
    // The one spot in the app where pot odds are the whole answer: the hand is
    // all in, so there are no later streets to change the price. The number
    // this produces is the same (S-1)/2S the solver uses as its calling
    // threshold, and `table.test.ts` pins the two against each other rather
    // than trusting that they agree.
    potOdds: facingAShove ? potOddsOf(pot, toCall) : null,
  };
}

/** Risking `toCall` to win the `pot` already in the middle. */
export function potOddsOf(pot: number, toCall: number): number {
  return toCall / (pot + toCall);
}

/**
 * The diagram in words, for the `role="img"` label.
 *
 * A seat map is a picture of something a screen reader user needs just as much,
 * so it gets a real description rather than being hidden.
 */
export function describeTable(view: TableView): string {
  const seats = view.seats.map((seat) => {
    const chips = seat.committed > 0 ? ` with ${formatChips(seat.committed)} in` : "";
    switch (seat.role) {
      case "hero":
        return `${seat.position}, you${chips}`;
      case "raiser":
        return `${seat.position} raises to ${formatChips(seat.committed)}`;
      case "folded":
        return `${seat.position} folded`;
      case "waiting":
        return `${seat.position} still to act${chips}`;
    }
  });

  const price = view.toCall > 0 ? `, ${formatChips(view.toCall)} to you` : "";
  return `Seats clockwise from you: ${seats.join("; ")}. Pot ${formatChips(view.pot)}${price}.`;
}
