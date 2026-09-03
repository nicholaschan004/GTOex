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
import { Chip, ChipRail } from "./ui";

type Mode = DrillMode | "play";

const MODES: { id: Mode; label: string; blurb: string }[] = [
  ...DRILL_MODES,
  { id: "play", label: "Play a hand", blurb: "Preflop to river, played out against the solver." },
];

/** What the footer says about where this mode's numbers came from. */
const PROVENANCE: Record<Mode, string> = {
  rfi: "Baseline charts and sizes, not solver output. Conventional ranges, to be replaced by computed ones.",
  "vs-open":
    "Baseline charts and sizes, not solver output. Conventional ranges, to be replaced by computed ones.",
  pushfold:
    "Solved: fictitious play over a computed equity matrix, verified unexploitable. Shoving is the only size, so there is nothing to choose.",
  play: "Preflop is the same baseline charts as the drills above. The flop is solved at build time over three streets; the turn and the river are solved in your browser from the ranges your own line implies.",
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
    // Wider than the reading column above xl, because that is where a finished
    // hand puts its review beside the table instead of under it. Everything
    // that is still one column caps itself, so the extra width is only ever
    // used by something that asked for it.
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-4 px-3 pb-6 sm:px-4 xl:max-w-6xl">
      {/*
        Sticky, and Next hand lives in it.

        Answering a hand unfolds the range grid underneath, which pushed the old
        Next button down the page by the height of a 13x13 chart, so the control
        you press most often was the one that moved most. Up here it is in the
        same place on every hand and still on screen after the grid appears,
        which matters on a phone where Enter is not an option.
      */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-page/95 py-2.5 backdrop-blur sm:gap-3 sm:py-3">
        <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">GTO Trainer</h1>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-3 font-mono text-xs text-muted sm:text-sm">
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

            Gold once it is armed, which is the same thing gold means
            everywhere else here: this one is yours. It was felt green, which
            measured 1.47:1 against the page, so the control the whole loop
            runs through was the hardest thing on screen to find.
          */}
          <button
            onClick={nextHand}
            disabled={!answered}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page",
              answered
                ? "bg-accent font-medium text-surface hover:bg-accent/90"
                : "border border-act-fold-edge text-muted opacity-50",
            )}
          >
            Next hand
            <span
              className={cn("hidden font-mono text-xs sm:inline", answered && "text-surface/70")}
            >
              ⏎
            </span>
          </button>
        </div>
      </header>

      <ChipRail label="Drill mode">
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
      </ChipRail>

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

        <div className="flex flex-col gap-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          {/* Stated on every screen, not buried in the README, because which of
              these modes was solved and which was typed is the difference that
              matters most in this project. */}
          <p className="max-w-3xl">{PROVENANCE[mode]}</p>
          {overall.attempts > 0 && (
            <button
              onClick={() => setProgress(clearProgress())}
              className="min-h-11 shrink-0 self-start rounded border border-act-fold-edge px-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page sm:self-auto"
            >
              Reset stats
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
