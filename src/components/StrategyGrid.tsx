import { RANKS, type HandClass, gridCell } from "../lib/cards";
import { cn } from "../lib/cn";
import type { ActionOption } from "../lib/postflop/decision";

/**
 * The 13x13 grid again, but shaded by frequency rather than filled by
 * membership.
 *
 * Preflop a chart says open or fold and a cell is one colour. Postflop the same
 * hand correctly bets some of the time and checks the rest, and a grid that
 * picked the more common action and painted the cell with it would be throwing
 * away the most interesting thing on the screen. Each cell is therefore a bar:
 * the actions in the proportions the solver plays them.
 *
 * Colours are hex here rather than Tailwind classes because the fill is a
 * computed gradient. A class built from a template string is a class Tailwind
 * never sees and never generates, and `check:classes` cannot catch it because
 * the class never appears in the source as a literal.
 */
const ACTION_COLOUR: Record<string, string> = {
  fold: "#2a322e",
  check: "#39423d",
  call: "#27506b",
  bet: "#1f5c43",
  raise: "#2f8a5b",
};

/** Two bets in the same spot are the same colour family, told apart by weight. */
function colourFor(action: ActionOption, index: number, sameKind: number): string {
  const base = ACTION_COLOUR[action.kind] ?? "#39423d";
  if (action.kind !== "bet" && action.kind !== "raise") return base;
  // The bigger of two sizes gets the brighter green, so a grid reads as
  // "more aggression to the right" without needing a legend for every size.
  return sameKind > 1 && index > 0 ? "#2f8a5b" : base;
}

export interface ClassStrategy {
  /** `actions x 169`, each class's column summing to one where it is present. */
  frequency: Float64Array;
  /** Whether any combination of that class can be here at all. */
  present: boolean[];
}

interface StrategyGridProps {
  actions: ActionOption[];
  strategy: ClassStrategy;
  /** The class of the hand just played, ringed so you can find it. */
  highlight?: HandClass | null;
}

export function StrategyGrid({ actions, strategy, highlight = null }: StrategyGridProps) {
  const sameKind = actions.filter((a) => a.kind === "bet" || a.kind === "raise").length;
  const colours = actions.map((action, index) => {
    const rank = actions.slice(0, index).filter((a) => a.kind === action.kind).length;
    return colourFor(action, rank, sameKind);
  });

  const classIndex = new Map<HandClass, number>();
  let cursor = 0;
  for (let row = 0; row < RANKS.length; row++) {
    for (let col = 0; col < RANKS.length; col++) classIndex.set(gridCell(row, col), cursor++);
  }

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
          aria-label="Solved strategy"
        >
          {RANKS.map((_, row) =>
            RANKS.map((__, col) => {
              const hand = gridCell(row, col);
              const index = classIndex.get(hand)!;
              const present = strategy.present[index];

              return (
                <div
                  key={hand}
                  title={hand}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-[2px]",
                    present ? "text-ink" : "text-muted",
                    hand === highlight && "relative z-10 ring-2 ring-accent",
                  )}
                  style={{
                    fontSize: "0.5rem",
                    lineHeight: 1,
                    // A class the board or the range has removed is drawn as a
                    // hole rather than as a fold, because "never" and "not
                    // here" are different facts.
                    background: present
                      ? gradientFor(strategy, index, actions.length, colours)
                      : "#121614",
                    opacity: present ? 1 : 0.45,
                  }}
                >
                  {hand}
                </div>
              );
            }),
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {actions.map((action, index) => (
          <span key={action.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ background: colours[index] }}
              aria-hidden
            />
            {action.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Hard colour stops, so the cell reads as proportions rather than a blur. */
function gradientFor(
  strategy: ClassStrategy,
  index: number,
  actions: number,
  colours: string[],
): string {
  const stops: string[] = [];
  let at = 0;
  for (let a = 0; a < actions; a++) {
    const share = strategy.frequency[a * 169 + index]! * 100;
    if (share <= 0.5) continue;
    stops.push(`${colours[a]} ${at.toFixed(1)}%`, `${colours[a]} ${(at + share).toFixed(1)}%`);
    at += share;
  }
  if (stops.length === 0) return "#121614";
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
