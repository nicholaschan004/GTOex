/**
 * Accuracy tracking, in localStorage.
 *
 * No accounts and no backend: opening the deployed link puts you straight into
 * the product with your history intact, and there is nothing stored anywhere
 * to leak. The cost is that progress does not follow you between devices,
 * which for a drill tool is the right trade.
 */

import { RFI_POSITIONS, type RfiPosition } from "./positions";

const STORAGE_KEY = "gtoex:progress:v1";

export interface Tally {
  attempts: number;
  correct: number;
}

export interface Progress {
  version: 1;
  byPosition: Record<RfiPosition, Tally>;
  streak: number;
  bestStreak: number;
}

function emptyTallies(): Record<RfiPosition, Tally> {
  return Object.fromEntries(
    RFI_POSITIONS.map((p) => [p, { attempts: 0, correct: 0 }]),
  ) as Record<RfiPosition, Tally>;
}

export function emptyProgress(): Progress {
  return { version: 1, byPosition: emptyTallies(), streak: 0, bestStreak: 0 };
}

/**
 * Reads whatever is in storage and repairs it into a valid shape.
 *
 * Anything unreadable is discarded rather than thrown, because a browser in
 * private mode, a cleared key, or a stored blob from an older build would
 * otherwise take down the whole app on load. A lost drill history is a much
 * smaller problem than a white screen.
 */
export function readProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyProgress();

    const candidate = parsed as Partial<Progress>;
    if (candidate.version !== 1) return emptyProgress();

    const restored = emptyProgress();
    restored.streak = numberOr(candidate.streak, 0);
    restored.bestStreak = numberOr(candidate.bestStreak, 0);

    for (const position of RFI_POSITIONS) {
      const tally = candidate.byPosition?.[position];
      if (!tally) continue;
      const attempts = numberOr(tally.attempts, 0);
      const correct = numberOr(tally.correct, 0);
      // Clamp rather than trust: a corrupted file must not be able to render
      // an accuracy above 100 percent.
      restored.byPosition[position] = {
        attempts,
        correct: Math.min(correct, attempts),
      };
    }
    return restored;
  } catch {
    return emptyProgress();
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

export function writeProgress(progress: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage full or blocked. The in-memory session still works.
  }
}

export function recordAnswer(
  progress: Progress,
  position: RfiPosition,
  correct: boolean,
): Progress {
  const previous = progress.byPosition[position];
  const streak = correct ? progress.streak + 1 : 0;

  return {
    version: 1,
    byPosition: {
      ...progress.byPosition,
      [position]: {
        attempts: previous.attempts + 1,
        correct: previous.correct + (correct ? 1 : 0),
      },
    },
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
  };
}

export function clearProgress(): Progress {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; the caller still gets a cleared object.
  }
  return emptyProgress();
}

export function totals(progress: Progress): Tally {
  return RFI_POSITIONS.reduce<Tally>(
    (sum, position) => {
      const tally = progress.byPosition[position];
      return {
        attempts: sum.attempts + tally.attempts,
        correct: sum.correct + tally.correct,
      };
    },
    { attempts: 0, correct: 0 },
  );
}

export function accuracy(tally: Tally): number | null {
  if (tally.attempts === 0) return null;
  return (tally.correct / tally.attempts) * 100;
}

/**
 * The seat you are worst at, or null while the evidence is too thin.
 *
 * The minimum sample matters. Calling a seat your weakest after one wrong
 * answer is noise dressed up as a finding, and a trainer that reports noise
 * teaches you to distrust it.
 */
export function weakestPosition(
  progress: Progress,
  minimumAttempts = 5,
): RfiPosition | null {
  let worst: RfiPosition | null = null;
  let worstRate = Infinity;

  for (const position of RFI_POSITIONS) {
    const tally = progress.byPosition[position];
    if (tally.attempts < minimumAttempts) continue;
    const rate = tally.correct / tally.attempts;
    if (rate < worstRate) {
      worstRate = rate;
      worst = position;
    }
  }
  return worst;
}
