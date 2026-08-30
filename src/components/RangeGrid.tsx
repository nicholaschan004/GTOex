import { RANKS, type HandClass, gridCell } from "../lib/cards";
import type { Action, RangeLayer } from "../lib/drill";
import { cn } from "../lib/cn";

interface RangeGridProps {
  /** Ordered strongest action first; the first layer containing a hand wins. */
  layers: RangeLayer[];
  /** The hand just played, ringed so you can find it among the 169. */
  highlight?: HandClass | null;
}

const ZONE: Record<Action, string> = {
  raise: "bg-zone-raise text-ink",
  call: "bg-zone-call text-ink",
  fold: "bg-raised text-muted",
};

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
export function RangeGrid({ layers, highlight = null }: RangeGridProps) {
  const actionOf = (hand: HandClass): Action =>
    layers.find((layer) => layer.hands.has(hand))?.action ?? "fold";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div
          className="mx-auto grid gap-px"
          style={{
            gridTemplateColumns: "repeat(13, minmax(0, 1fr))",
            minWidth: "20rem",
            maxWidth: "28rem",
          }}
          role="table"
          aria-label="Range chart"
        >
          {RANKS.map((_, row) =>
            RANKS.map((__, col) => {
              const hand = gridCell(row, col);
              return (
                <div
                  key={hand}
                  title={hand}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-[2px]",
                    ZONE[actionOf(hand)],
                    hand === highlight && "relative z-10 ring-2 ring-accent",
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

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {layers.map((layer) => (
          <span key={layer.action} className="flex items-center gap-1.5">
            <span
              className={cn("inline-block h-2.5 w-2.5 rounded-[2px]", ZONE[layer.action])}
              aria-hidden
            />
            {layer.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-[2px]", ZONE.fold)} aria-hidden />
          Fold
        </span>
      </div>
    </div>
  );
}
