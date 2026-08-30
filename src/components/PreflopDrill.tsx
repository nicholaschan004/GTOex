import { useCallback, useEffect, useRef, useState } from "react";
import { comboPercent } from "../lib/cards";
import {
  type Action,
  type DrillMode,
  type Spot,
  type Verdict,
  actionLabel,
  actionsFor,
  dealSpot,
  judge,
  layersFor,
  spotHeading,
  spotKey,
  spotLabel,
  spotStory,
} from "../lib/drill";
import { STACK_DEPTHS, type StackDepth } from "../lib/positions";
import { formatChips } from "../lib/sizing";
import { tableFor, type TableView } from "../lib/table";
import { cn } from "../lib/cn";
import { PlayingCard } from "./PlayingCard";
import { PokerTable } from "./PokerTable";
import { RangeGrid } from "./RangeGrid";
import { ActionButton, Chip, type DrillBodyProps } from "./ui";

const SHORTCUT: Record<Action, string> = { fold: "F", call: "C", raise: "R" };

/**
 * The price under an action, or nothing when the action does not have one.
 *
 * Folding is free, and a raise the spot does not offer has no size, so both
 * come back null rather than as an empty string the button would still lay out
 * space for.
 */
function priceOf(spot: Spot, action: Action, view: TableView): string | null {
  if (action === "fold") return null;
  if (action === "call") return view.toCall > 0 ? formatChips(view.toCall) : null;
  if (view.raiseTo === null) return null;
  // "All in 10bb" reads as a size; "All in to 10bb" reads as a typo.
  return spot.kind === "pushfold" ? formatChips(view.raiseTo) : `to ${formatChips(view.raiseTo)}`;
}

/**
 * The preflop drill: three modes over hand classes, scored right or wrong.
 *
 * That last part is what makes it a different component from the postflop one
 * rather than a mode of it. A preflop chart has an answer; a solved postflop
 * strategy has frequencies, and forcing both through one scoring model would
 * mean either pretending preflop is mixed or pretending postflop is not.
 */
export function PreflopDrill({ mode, round, onAnswer }: DrillBodyProps & { mode: DrillMode }) {
  const [depth, setDepth] = useState<StackDepth | "any">(100);
  const [spot, setSpot] = useState<Spot>(() =>
    dealSpot(mode, mode === "rfi" ? { depth: 100 } : {}),
  );
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  /** Set synchronously, so two answers in one React batch cannot both land. */
  const committed = useRef(false);

  const deal = useCallback(
    (nextDepth: StackDepth | "any") => {
      setSpot(dealSpot(mode, nextDepth === "any" ? {} : { depth: nextDepth }));
      setVerdict(null);
      committed.current = false;
    },
    [mode],
  );

  // The shell owns the Next hand button and bumps `round`; this is where that
  // becomes a new hand.
  useEffect(() => {
    if (round === 0) return;
    setSpot(dealSpot(mode, depth === "any" ? {} : { depth }));
    setVerdict(null);
    committed.current = false;
    // Deliberately not depending on depth or mode: changing either deals its
    // own hand, and listing them here would deal a second one on top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const answer = useCallback(
    (action: Action) => {
      if (verdict || committed.current) return;
      if (!actionsFor(spot).includes(action)) return;
      committed.current = true;

      const result = judge(spot, action);
      setVerdict(result);
      onAnswer({ key: spotKey(spot), label: spotLabel(spot), correct: result.correct });
    },
    [onAnswer, spot, verdict],
  );

  // A drill lives or dies on how fast you can answer, so the whole loop is
  // reachable without the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (verdict) return;
      const key = event.key.toLowerCase();
      if (key === "f") answer("fold");
      if (key === "c") answer("call");
      if (key === "r") answer("raise");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, verdict]);

  const layers = layersFor(spot);
  const view = tableFor(spot);
  const bestLayer = layers.find((layer) => layer.action === verdict?.best);

  return (
    <>
      {mode === "rfi" && (
        <nav className="flex flex-wrap items-center gap-2" aria-label="Stack depth">
          <span className="text-xs text-muted">Stack</span>
          {STACK_DEPTHS.map((option) => (
            <Chip
              key={option}
              active={depth === option}
              onClick={() => {
                setDepth(option);
                deal(option);
              }}
            >
              {option}bb
            </Chip>
          ))}
          <Chip
            active={depth === "any"}
            onClick={() => {
              setDepth("any");
              deal("any");
            }}
          >
            Mixed
          </Chip>
        </nav>
      )}

      <section className="space-y-1 text-center">
        <p className="text-sm text-muted">{spotHeading(spot)}</p>
        <p className="text-sm text-muted">{spotStory(spot)}</p>
      </section>

      <PokerTable view={view} />

      {/* Pot odds only appear where they are the whole answer, which is the
          all-in spot. See the note in table.ts for why the other modes get
          none. */}
      {view.potOdds !== null && (
        <p className="-mt-2 text-center text-xs text-muted">
          Calling {formatChips(view.toCall)} to win {formatChips(view.pot)}, so the call needs{" "}
          <span className="text-ink">{(view.potOdds * 100).toFixed(1)}%</span> equity.
        </p>
      )}

      <div className="flex justify-center gap-3" aria-label="Your hand">
        <PlayingCard card={spot.cards[0]} />
        <PlayingCard card={spot.cards[1]} />
      </div>

      {!verdict ? (
        <div className="flex flex-wrap justify-center gap-3">
          {actionsFor(spot).map((action) => (
            <ActionButton
              key={action}
              onClick={() => answer(action)}
              shortcut={SHORTCUT[action]}
              emphasis={action !== "fold"}
              price={priceOf(spot, action, view)}
            >
              {actionLabel(spot, action)}
            </ActionButton>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="text-center">
            <p
              className={cn("text-lg font-semibold", verdict.correct ? "text-correct" : "text-wrong")}
              role="status"
            >
              {verdict.correct ? "Correct" : "Not quite"}
            </p>
            <p className="text-sm text-muted">
              {spot.hand} is{" "}
              {bestLayer ? (
                <>
                  in the <span className="text-ink">{bestLayer.label.toLowerCase()}</span> range
                </>
              ) : (
                "outside every continuing range"
              )}
              , so the play is{" "}
              <span className="text-ink">{actionLabel(spot, verdict.best).toLowerCase()}</span>
              {priceOf(spot, verdict.best, view) && (
                <span className="text-ink"> {priceOf(spot, verdict.best, view)}</span>
              )}
              .
            </p>
          </div>

          <div className="space-y-2">
            <RangeGrid layers={layers} highlight={spot.hand} />
            <p className="text-center text-xs text-muted">
              {layers
                .map((layer) => `${layer.label} ${comboPercent(layer.hands).toFixed(1)}%`)
                .join(" · ")}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
