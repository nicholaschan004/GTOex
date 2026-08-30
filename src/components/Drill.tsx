import { useCallback, useEffect, useState } from "react";
import { comboPercent } from "../lib/cards";
import {
  type Action,
  type Spot,
  type Verdict,
  dealSpot,
  foldedBefore,
  judge,
  rangeForSpot,
} from "../lib/drill";
import { POSITION_NAMES } from "../lib/positions";
import {
  type Progress,
  accuracy,
  clearProgress,
  readProgress,
  recordAnswer,
  totals,
  weakestPosition,
  writeProgress,
} from "../lib/progress";
import { cn } from "../lib/cn";
import { PlayingCard } from "./PlayingCard";
import { RangeGrid } from "./RangeGrid";

export function Drill() {
  const [spot, setSpot] = useState<Spot>(() => dealSpot());
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [progress, setProgress] = useState<Progress>(() => readProgress());

  const answer = useCallback(
    (action: Action) => {
      if (verdict) return;
      const result = judge(spot, action);
      const updated = recordAnswer(progress, spot.position, result.correct);
      writeProgress(updated);
      setVerdict(result);
      setProgress(updated);
    },
    [progress, spot, verdict],
  );

  const nextHand = useCallback(() => {
    setSpot(dealSpot());
    setVerdict(null);
  }, []);

  // A drill lives or dies on how fast you can answer, so the whole loop is
  // reachable without the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();

      if (!verdict) {
        if (key === "f") answer("fold");
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

  const range = rangeForSpot(spot);
  const overall = totals(progress);
  const overallAccuracy = accuracy(overall);
  const weakest = weakestPosition(progress);
  const folded = foldedBefore(spot.position);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-ink">GTOex</h1>

        <div className="flex items-center gap-4 font-mono text-sm text-muted">
          {/* An unattempted session shows nothing here rather than 0%, which
              would read as a score you had earned. */}
          {overallAccuracy !== null && (
            <span>
              <span className="text-ink">{overall.correct}</span>/{overall.attempts}
              {"  "}
              {overallAccuracy.toFixed(0)}%
            </span>
          )}
          {progress.streak > 0 && <span>streak {progress.streak}</span>}
        </div>
      </header>

      <section className="space-y-1 text-center">
        <p className="text-sm text-muted">
          {POSITION_NAMES[spot.position]} &middot; {spot.depth}bb &middot; 6 handed
        </p>
        <p className="text-sm text-muted">
          {folded.length === 0
            ? "You are first to act."
            : `${folded.join(", ")} ${folded.length === 1 ? "folds" : "fold"}. Action on you.`}
        </p>
      </section>

      <div className="flex justify-center gap-3" aria-label="Your hand">
        <PlayingCard card={spot.cards[0]} />
        <PlayingCard card={spot.cards[1]} />
      </div>

      {!verdict ? (
        <div className="flex justify-center gap-3">
          <ActionButton onClick={() => answer("fold")} shortcut="F">
            Fold
          </ActionButton>
          <ActionButton onClick={() => answer("raise")} shortcut="R" emphasis>
            Raise
          </ActionButton>
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
              {verdict.best === "raise" ? "in" : "outside"} the {spot.position}{" "}
              opening range, so the play is{" "}
              <span className="text-ink">{verdict.best}</span>.
            </p>
          </div>

          <div className="space-y-2">
            <RangeGrid range={range} highlight={spot.hand} />
            <p className="text-center text-xs text-muted">
              {spot.position} opens {comboPercent(range).toFixed(1)}% of hands.
              Highlighted cells are opens.
            </p>
          </div>

          <div className="flex justify-center">
            <ActionButton onClick={nextHand} shortcut="Enter" emphasis>
              Next hand
            </ActionButton>
          </div>
        </div>
      )}

      <footer className="mt-auto space-y-3 border-t border-line pt-4">
        {weakest && (
          <p className="text-center text-xs text-muted">
            Weakest seat so far: <span className="text-ink">{weakest}</span>
          </p>
        )}

        <div className="flex items-center justify-between gap-4 text-xs text-muted">
          {/* Stated on every screen, not buried in the README. Presenting
              hand-authored ranges as solved output would be the one thing
              that makes the whole tool untrustworthy. */}
          <p>
            Baseline charts, not solver output. Conventional 100bb opening
            ranges, to be replaced by computed ones.
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
