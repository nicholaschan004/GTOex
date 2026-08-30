import { useCallback, useEffect, useState } from "react";
import { comboPercent } from "../lib/cards";
import {
  DRILL_MODES,
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
import {
  type Progress,
  accuracy,
  clearProgress,
  readProgress,
  recordAnswer,
  totals,
  weakestSpots,
  writeProgress,
} from "../lib/progress";
import { formatChips } from "../lib/sizing";
import { tableFor, type TableView } from "../lib/table";
import { cn } from "../lib/cn";
import { PlayingCard } from "./PlayingCard";
import { PokerTable } from "./PokerTable";
import { RangeGrid } from "./RangeGrid";

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

export function Drill() {
  const [mode, setMode] = useState<DrillMode>("rfi");
  const [depth, setDepth] = useState<StackDepth | "any">(100);
  const [spot, setSpot] = useState<Spot>(() => dealSpot("rfi", { depth: 100 }));
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [progress, setProgress] = useState<Progress>(() => readProgress());

  const nextHand = useCallback(
    (nextMode = mode, nextDepth = depth) => {
      setSpot(dealSpot(nextMode, nextDepth === "any" ? {} : { depth: nextDepth }));
      setVerdict(null);
    },
    [depth, mode],
  );

  const answer = useCallback(
    (action: Action) => {
      if (verdict) return;
      if (!actionsFor(spot).includes(action)) return;

      const result = judge(spot, action);
      const updated = recordAnswer(progress, spotKey(spot), spotLabel(spot), result.correct);
      writeProgress(updated);
      setVerdict(result);
      setProgress(updated);
    },
    [progress, spot, verdict],
  );

  // A drill lives or dies on how fast you can answer, so the whole loop is
  // reachable without the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();

      if (!verdict) {
        if (key === "f") answer("fold");
        if (key === "c") answer("call");
        if (key === "r") answer("raise");
        return;
      }
      if (key === "enter" || key === " ") {
        event.preventDefault();
        nextHand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, nextHand, verdict]);

  const switchMode = (next: DrillMode) => {
    setMode(next);
    nextHand(next, depth);
  };

  const switchDepth = (next: StackDepth | "any") => {
    setDepth(next);
    nextHand(mode, next);
  };

  const layers = layersFor(spot);
  const view = tableFor(spot);
  const overall = totals(progress);
  const overallAccuracy = accuracy(overall);
  const weakest = weakestSpots(progress);
  const bestLayer = layers.find((layer) => layer.action === verdict?.best);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-4 px-4 pb-6">
      {/*
        Sticky, and Next hand lives in it.

        Answering a hand unfolds the range grid underneath, which pushed the old
        Next button down the page by the height of a 13x13 chart, so the control
        you press most often was the one that moved most. Up here it is in the
        same place on every hand and still on screen after the grid appears,
        which matters on a phone where Enter is not an option.
      */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-base/95 py-3 backdrop-blur">
        <h1 className="text-xl font-semibold tracking-tight text-ink">GTO Trainer</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 font-mono text-sm text-muted">
            {/* An unattempted session shows nothing here rather than 0%, which
                would read as a score you had earned. */}
            {overallAccuracy !== null && (
              <span>
                <span className="text-ink">{overall.correct}</span>/{overall.attempts}{" "}
                {overallAccuracy.toFixed(0)}%
              </span>
            )}
            {progress.streak > 0 && <span className="hidden sm:inline">streak {progress.streak}</span>}
          </div>
          {/*
            Disabled rather than hidden before you answer. It holds its slot so
            nothing shifts when it lights up, and skipping a hand you did not
            like the look of is not a thing a drill should let you do.
          */}
          <button
            onClick={() => nextHand()}
            disabled={!verdict}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors",
              verdict
                ? "bg-felt text-ink hover:bg-felt/80"
                : "border border-line text-muted opacity-40",
            )}
          >
            Next hand
            <span className="ml-2 font-mono text-xs text-muted">⏎</span>
          </button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Drill mode">
        {DRILL_MODES.map((option) => (
          <Chip
            key={option.id}
            active={mode === option.id}
            onClick={() => switchMode(option.id)}
            title={option.blurb}
          >
            {option.label}
          </Chip>
        ))}
      </nav>

      {mode === "rfi" && (
        <nav className="flex flex-wrap items-center gap-2" aria-label="Stack depth">
          <span className="text-xs text-muted">Stack</span>
          {STACK_DEPTHS.map((option) => (
            <Chip key={option} active={depth === option} onClick={() => switchDepth(option)}>
              {option}bb
            </Chip>
          ))}
          <Chip active={depth === "any"} onClick={() => switchDepth("any")}>
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
              className={cn(
                "text-lg font-semibold",
                verdict.correct ? "text-correct" : "text-wrong",
              )}
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

      <footer className="mt-auto space-y-3 border-t border-line pt-4">
        {weakest.length > 0 && (
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>Weakest:</span>
            {weakest.map((entry) => (
              <span key={entry.label}>
                <span className="text-ink">{entry.label}</span> {entry.rate.toFixed(0)}%
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-4 text-xs text-muted">
          {/* Stated on every screen, not buried in the README, and it changes
              per mode because only one of these modes was solved. */}
          <p>
            {mode === "pushfold"
              ? "Solved: fictitious play over a computed equity matrix, verified unexploitable. Shoving is the only size, so there is nothing to choose."
              : "Baseline charts and sizes, not solver output. Conventional ranges, to be replaced by computed ones."}
          </p>
          {overall.attempts > 0 && (
            <button
              onClick={() => setProgress(clearProgress())}
              className="shrink-0 rounded border border-line px-2 py-1 hover:text-ink"
            >
              Reset stats
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-felt bg-felt text-ink"
          : "border-line text-muted hover:border-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function ActionButton({
  children,
  onClick,
  shortcut,
  emphasis = false,
  price = null,
}: {
  children: React.ReactNode;
  onClick: () => void;
  shortcut: string;
  emphasis?: boolean;
  /** The size, on its own line. Null for actions that do not have one. */
  price?: string | null;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        // Flex column so a button with a size under it and a button without
        // one still centre their labels against each other; the row stretches
        // them to a common height on its own.
        "flex flex-col justify-center rounded-lg px-6 py-2.5 transition-colors",
        emphasis
          ? "bg-felt text-ink hover:bg-felt/80"
          : "border border-line bg-raised text-ink hover:bg-line",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-base">{children}</span>
        <span className="font-mono text-xs text-muted">{shortcut}</span>
      </span>
      {/* The size sits under the action rather than inside the label, so the
          button still reads as one word at a glance and the price is there
          when you look for it. */}
      {price && <span className="mt-0.5 block font-mono text-xs text-muted">{price}</span>}
    </button>
  );
}
