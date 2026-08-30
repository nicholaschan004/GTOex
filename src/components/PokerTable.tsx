import { formatChips } from "../lib/sizing";
import { describeTable, type Seat, type SeatRole, type TableView } from "../lib/table";
import { cn } from "../lib/cn";

/**
 * The seat map.
 *
 * Seats are placed on an ellipse starting at the bottom and running clockwise,
 * which is the direction the action moves. `tableFor` puts the hero first, so
 * the hero lands at the bottom and the players still to act fan up the left
 * hand side, which is where they sit relative to you at a real table. That is
 * the whole point of drawing it: "three players behind you" is a sentence you
 * have to decode, and a picture of three seats between you and the blinds is
 * not.
 *
 * Angles are measured clockwise from twelve o'clock rather than the usual
 * counter-clockwise from three, so x is sin and y is minus cos.
 *
 * Geometry is inline rather than in Tailwind classes for the same reason the
 * range grid's columns are: these are computed values, and a class built from a
 * template string is a class Tailwind never sees and never generates.
 */
function seatPosition(index: number, count: number): { left: string; top: string } {
  const radians = ((180 + (index * 360) / count) * Math.PI) / 180;
  return {
    left: `${50 + 43 * Math.sin(radians)}%`,
    top: `${50 - 39 * Math.cos(radians)}%`,
  };
}

const ROLE_STYLE: Record<SeatRole, string> = {
  hero: "border-accent bg-raised text-ink",
  raiser: "border-zone-raise bg-zone-raise text-ink",
  waiting: "border-line bg-surface text-muted",
  // Folded seats stay on the table rather than disappearing. Six seats that
  // sometimes number four would make the picture a different shape every hand,
  // and how many players are left is the fact being taught.
  folded: "border-line bg-base text-muted opacity-40",
};

/**
 * The chips in front of a seat. A folded seat keeps its blind on the table but
 * loses the chip styling, because that money is dead: it is in the pot you are
 * playing for, not in front of a player who can still take it back.
 *
 * A lookup rather than a conditional so that no role name is ever written as a
 * string literal inside a `cn()` call. `check-classes.mjs` reads every literal
 * in those calls as a class name, and "folded" is not one.
 */
const CHIP_STYLE: Record<SeatRole, string> = {
  hero: "bg-felt-rail text-ink",
  raiser: "bg-felt-rail text-ink",
  waiting: "bg-felt-rail text-ink",
  folded: "text-muted",
};

export function PokerTable({ view }: { view: TableView }) {
  return (
    <div
      className="relative mx-auto w-full"
      style={{ maxWidth: "26rem", aspectRatio: "9 / 5" }}
      role="img"
      aria-label={describeTable(view)}
    >
      <div
        className="absolute rounded-full border border-felt-rail bg-felt"
        style={{ inset: "20% 21%" }}
        aria-hidden
      />

      <div
        className="absolute flex flex-col items-center"
        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        aria-hidden
      >
        <span className="font-mono text-sm text-ink">{formatChips(view.pot)}</span>
        <span className="text-muted" style={{ fontSize: "0.5625rem", letterSpacing: "0.08em" }}>
          POT
        </span>
      </div>

      {view.seats.map((seat, index) => (
        <SeatMarker
          key={seat.position}
          seat={seat}
          at={seatPosition(index, view.seats.length)}
        />
      ))}
    </div>
  );
}

function SeatMarker({ seat, at }: { seat: Seat; at: { left: string; top: string } }) {
  return (
    <div
      className="absolute flex flex-col items-center gap-0.5"
      style={{ ...at, transform: "translate(-50%, -50%)" }}
      aria-hidden
    >
      <div
        className={cn(
          "relative rounded-md border px-2 py-1 text-center font-mono leading-none",
          ROLE_STYLE[seat.role],
        )}
        style={{ minWidth: "2.75rem" }}
      >
        <span className="block" style={{ fontSize: "0.6875rem" }}>
          {seat.position}
        </span>
        {seat.role === "hero" && (
          <span className="block text-accent" style={{ fontSize: "0.5625rem" }}>
            YOU
          </span>
        )}

        {/* text-surface rather than text-base: Tailwind already ships text-base
            as a font size, so the `base` colour cannot be reached that way, and
            the class checker would not catch it because the class does exist. */}
        {seat.dealer && (
          <span
            className="absolute flex items-center justify-center rounded-full bg-ink font-bold text-surface"
            style={{
              width: "0.875rem",
              height: "0.875rem",
              right: "-0.4375rem",
              top: "-0.4375rem",
              fontSize: "0.5rem",
            }}
          >
            D
          </span>
        )}
      </div>

      {seat.committed > 0 && (
        <span
          className={cn("rounded-full px-1.5 font-mono leading-tight", CHIP_STYLE[seat.role])}
          style={{ fontSize: "0.5625rem" }}
        >
          {formatChips(seat.committed)}
        </span>
      )}
    </div>
  );
}
