/**
 * Accuracy tracking, in localStorage.
 *
 * No accounts and no backend: opening the deployed link puts you straight into
 * the product with your history intact, and there is nothing stored anywhere
 * to leak. The cost is that progress does not follow you between devices,
 * which for a drill tool is the right trade.
 *
 * Keyed by an opaque spot key rather than by position, because a spot is now a
 * seat, a stack depth and who raised. `drill.ts` owns what those keys mean.
 */

/**
 * Deliberately still says "gtoex" after the rename to GTO Trainer.
 *
 * The key is invisible to users, and changing it would silently discard the
 * accuracy history of anyone who had already used the site. A tidier string is
 * not worth throwing away someone's drill record, so this stays as it is.
 */
const STORAGE_KEY = "gtoex:progress:v2";

export interface Tally {
  attempts: number;
  correct: number;
  /** Human-readable name for the key, so old entries still display. */
  label: string;
}

export interface Progress {
  version: 2;
  spots: Record<string, Tally>;
  streak: number;
  bestStreak: number;
}

export function emptyProgress(): Progress {
  return { version: 2, spots: {}, streak: 0, bestStreak: 0 };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
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
    if (candidate.version !== 2) return emptyProgress();

    const restored = emptyProgress();
    restored.streak = numberOr(candidate.streak, 0);
    restored.bestStreak = numberOr(candidate.bestStreak, 0);

    for (const [key, tally] of Object.entries(candidate.spots ?? {})) {
      if (!tally || typeof tally !== "object") continue;
      const attempts = numberOr(tally.attempts, 0);
      if (attempts === 0) continue;
      restored.spots[key] = {
        attempts,
        // Clamp rather than trust: a corrupted file must not be able to render
        // an accuracy above 100 percent.
        correct: Math.min(numberOr(tally.correct, 0), attempts),
        label: typeof tally.label === "string" ? tally.label : key,
      };
    }
    return restored;
  } catch {
    return emptyProgress();
  }
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
  key: string,
  label: string,
  correct: boolean,
): Progress {
  const previous = progress.spots[key] ?? { attempts: 0, correct: 0, label };
  const streak = correct ? progress.streak + 1 : 0;

  return {
    version: 2,
    spots: {
      ...progress.spots,
      [key]: {
        attempts: previous.attempts + 1,
        correct: previous.correct + (correct ? 1 : 0),
        label,
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

export function totals(progress: Progress): { attempts: number; correct: number } {
  return Object.values(progress.spots).reduce(
    (sum, tally) => ({
      attempts: sum.attempts + tally.attempts,
      correct: sum.correct + tally.correct,
    }),
    { attempts: 0, correct: 0 },
  );
}

export function accuracy(tally: { attempts: number; correct: number }): number | null {
  if (tally.attempts === 0) return null;
  return (tally.correct / tally.attempts) * 100;
}

/**
 * The spots you are worst at, or an empty list while the evidence is too thin.
 *
 * The minimum sample matters. Calling a spot your weakest after one wrong
 * answer is noise dressed up as a finding, and a trainer that reports noise
 * teaches you to distrust it.
 */
export function weakestSpots(
  progress: Progress,
  count = 3,
  minimumAttempts = 5,
): { label: string; rate: number; attempts: number }[] {
  return Object.values(progress.spots)
    .filter((tally) => tally.attempts >= minimumAttempts)
    .map((tally) => ({
      label: tally.label,
      rate: (tally.correct / tally.attempts) * 100,
      attempts: tally.attempts,
    }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, count);
}
