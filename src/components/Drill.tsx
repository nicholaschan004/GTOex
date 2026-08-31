import { useCallback, useEffect, useState } from "react";
import { DRILL_MODES, type DrillMode } from "../lib/drill";
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
import { PreflopDrill } from "./PreflopDrill";
import { PlayHand } from "./PlayHand";
import { Chip } from "./ui";

type Mode = DrillMode | "play";

const MODES: { id: Mode; label: string; blurb: string }[] = [
  ...DRILL_MODES,
  { id: "play", label: "Play a hand", blurb: "Turn and river, played out against the solver." },
];

/** What the footer says about where this mode's numbers came from. */
const PROVENANCE: Record<Mode, string> = {
  rfi: "Baseline charts and sizes, not solver output. Conventional ranges, to be replaced by computed ones.",
  "vs-open":
    "Baseline charts and sizes, not solver output. Conventional ranges, to be replaced by computed ones.",
  pushfold:
    "Solved: fictitious play over a computed equity matrix, verified unexploitable. Shoving is the only size, so there is nothing to choose.",
  play: "Solved: the turn at build time over 48 river subgames, the river live in your browser from the ranges your line implies. The flop is not solved and is not pretended to be.",
};

/**
 * The shell.
 *
 * It owns the things every mode shares -- the title, the score, the Next hand
 * button, the mode chips, the footer -- and nothing about poker. The two drills
 * underneath are peers rather than variants of each other, because preflop is
 * scored right or wrong against a chart and postflop is scored in chips against
 * a mixed strategy, and those are different games to be graded at.
 *
 * The contract between them is small on purpose: the shell bumps `round` when
 * the user wants another hand, the body deals one, and the body calls back once
 * when an answer is committed.
 */
export function Drill() {
  const [mode, setMode] = useState<Mode>("rfi");
  const [round, setRound] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [progress, setProgress] = useState<Progress>(() => readProgress());

  const nextHand = useCallback(() => {
    setRound((value) => value + 1);
    setAnswered(false);
  }, []);

  const onAnswer = useCallback(
    ({ key, label, correct }: { key: string; label: string; correct: boolean }) => {
      setProgress((current) => {
        const updated = recordAnswer(current, key, label, correct);
        writeProgress(updated);
        return updated;
      });
      setAnswered(true);
    },
    [],
  );

  const switchMode = (next: Mode) => {
    setMode(next);
    setAnswered(false);
  };

  // Enter advances, from anywhere. The bodies own their own action keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!answered) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        nextHand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answered, nextHand]);

  const overall = totals(progress);
  const overallAccuracy = accuracy(overall);
  const weakest = weakestSpots(progress);
  const postflop = mode === "play";

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
            {progress.streak > 0 && (
              <span className="hidden sm:inline">streak {progress.streak}</span>
            )}
          </div>
          {/*
            Disabled rather than hidden before you answer. It holds its slot so
            nothing shifts when it lights up, and skipping a hand you did not
            like the look of is not a thing a drill should let you do.
          */}
          <button
            onClick={nextHand}
            disabled={!answered}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors",
              answered
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
        {MODES.map((option) => (
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

      {/*
        Keyed on the mode so switching remounts rather than reconciles. The two
        bodies hold entirely different state and a half-reset drill showing one
        mode's spot with another mode's buttons is a worse bug than a remount is
        a cost.
      */}
      {postflop ? (
        <PlayHand key={mode} round={round} answered={answered} onAnswer={onAnswer} />
      ) : (
        <PreflopDrill
          key={mode}
          mode={mode}
          round={round}
          answered={answered}
          onAnswer={onAnswer}
        />
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
          {/* Stated on every screen, not buried in the README, because which of
              these modes was solved and which was typed is the difference that
              matters most in this project. */}
          <p>{PROVENANCE[mode]}</p>
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
