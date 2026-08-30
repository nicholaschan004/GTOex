import { RANKS, type HandClass, gridCell } from "../lib/cards";
import { cn } from "../lib/cn";

interface RangeGridProps {
  range: Set<HandClass>;
  /** The hand just played, ringed so you can find it among the 169. */
  highlight?: HandClass | null;
}

/**
 * The 13x13 grid every poker range is drawn on.
 *
 * This exists because showing the whole range is the part that teaches. Being
 * told "fold KJo under the gun" is a fact to memorise; seeing KJo sit just
 * outside a shape you already recognise is a rule you can apply to the next
 * hand. It is also the honest way to present a chart, since it shows you the
 * borders rather than only the verdict on one hand.
 *
 * Note the inline gridTemplateColumns. Tailwind ships grid-cols-1 through 12,
 * so grid-cols-13 does not exist and would silently do nothing.
 */
export function RangeGrid({ range, highlight = null }: RangeGridProps) {
  return (
    <div className="overflow-x-auto">
      <div
        className="mx-auto grid gap-px"
        style={{
          gridTemplateColumns: "repeat(13, minmax(0, 1fr))",
          minWidth: "20rem",
          maxWidth: "28rem",
        }}
        role="table"
        aria-label="Opening range"
      >
        {RANKS.map((_, row) =>
          RANKS.map((__, col) => {
            const hand = gridCell(row, col);
            const inRange = range.has(hand);
            const isHighlight = hand === highlight;

            return (
              <div
                key={hand}
                title={hand}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-[2px]",
                  inRange ? "bg-felt text-ink" : "bg-raised text-muted",
                  isHighlight && "relative z-10 ring-2 ring-accent",
                )}
                style={{ fontSize: "0.5rem", lineHeight: 1 }}
              >
                {hand}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
