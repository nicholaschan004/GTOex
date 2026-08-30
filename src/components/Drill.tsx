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
import { cn } from "../lib/cn";
import { PlayingCard } from "./PlayingCard";
import { RangeGrid } from "./RangeGrid";

const SHORTCUT: Record<Action, string> = { fold: "F", call: "C", raise: "R" };

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
  const overall = totals(progress);
  const overallAccuracy = accuracy(overall);
  const weakest = weakestSpots(progress);
  const bestLayer = layers.find((layer) => layer.action === verdict?.best);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-5 px-4 py-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-ink">GTOex</h1>
        <div className="flex items-center gap-4 font-mono text-sm text-muted">
          {/* An unattempted session shows nothing here rather than 0%, which
              would read as a score you had earned. */}
          {overallAccuracy !== null && (
            <span>
              <span className="text-ink">{overall.correct}</span>/{overall.attempts}{" "}
              {overallAccuracy.toFixed(0)}%
            </span>
          )}
          {progress.streak > 0 && <span>streak {progress.streak}</span>}
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

      <section className="space-y-1 pt-2 text-center">
        <p className="text-sm text-muted">{spotHeading(spot)}</p>
        <p className="text-sm text-muted">{spotStory(spot)}</p>
      </section>

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
              <span className="text-ink">{actionLabel(spot, verdict.best).toLowerCase()}</span>.
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

          <div className="flex justify-center">
            <ActionButton onClick={() => nextHand()} shortcut="Enter" emphasis>
              Next hand
            </ActionButton>
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
              ? "Solved: fictitious play over a computed equity matrix, verified unexploitable."
              : "Baseline charts, not solver output. Conventional ranges, to be replaced by computed ones."}
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
}: {
  children: React.ReactNode;
  onClick: () => void;
  shortcut: string;
  emphasis?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg px-6 py-3 text-base transition-colors",
        emphasis
          ? "bg-felt text-ink hover:bg-felt/80"
          : "border border-line bg-raised text-ink hover:bg-line",
      )}
    >
      {children}
      <span className="ml-2 font-mono text-xs text-muted">{shortcut}</span>
    </button>
  );
}
