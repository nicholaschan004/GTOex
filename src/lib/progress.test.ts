import { beforeEach, describe, expect, it } from "vitest";
import {
  accuracy,
  clearProgress,
  emptyProgress,
  readProgress,
  recordAnswer,
  totals,
  weakestSpots,
  writeProgress,
} from "./progress";

/** Tests run in the node environment, which has no localStorage of its own. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  return store;
}

const KEY = "gtoex:progress:v2";

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});

describe("round trip", () => {
  it("survives a write and read", () => {
    let progress = emptyProgress();
    progress = recordAnswer(progress, "rfi:100:BTN", "BTN open, 100bb", true);
    progress = recordAnswer(progress, "rfi:100:BTN", "BTN open, 100bb", false);
    writeProgress(progress);

    const restored = readProgress();
    expect(restored.spots["rfi:100:BTN"]).toEqual({
      attempts: 2,
      correct: 1,
      label: "BTN open, 100bb",
    });
  });

  it("keeps different spots apart", () => {
    let progress = emptyProgress();
    progress = recordAnswer(progress, "rfi:20:BTN", "BTN open, 20bb", true);
    progress = recordAnswer(progress, "rfi:200:BTN", "BTN open, 200bb", false);
    expect(totals(progress)).toEqual({ attempts: 2, correct: 1 });
    expect(progress.spots["rfi:20:BTN"]!.correct).toBe(1);
    expect(progress.spots["rfi:200:BTN"]!.correct).toBe(0);
  });

  it("starts empty when nothing is stored", () => {
    expect(readProgress()).toEqual(emptyProgress());
  });
});

describe("streaks", () => {
  it("counts up on correct and resets on wrong", () => {
    let progress = emptyProgress();
    for (let i = 0; i < 3; i++) {
      progress = recordAnswer(progress, "pf:SB", "SB shove", true);
    }
    expect(progress.streak).toBe(3);
    expect(progress.bestStreak).toBe(3);

    progress = recordAnswer(progress, "pf:SB", "SB shove", false);
    expect(progress.streak).toBe(0);
    expect(progress.bestStreak).toBe(3);
  });
});

describe("corrupt storage", () => {
  it("shrugs off unparseable json", () => {
    store.set(KEY, "{not json");
    expect(readProgress()).toEqual(emptyProgress());
  });

  it("discards an older schema version", () => {
    // v1 was keyed by position, so its shape cannot be read into v2.
    store.set(KEY, JSON.stringify({ version: 1, byPosition: {}, streak: 9 }));
    expect(readProgress()).toEqual(emptyProgress());
  });

  it("clamps a correct count above attempts, so accuracy cannot exceed 100", () => {
    store.set(
      KEY,
      JSON.stringify({
        version: 2,
        spots: { "rfi:100:UTG": { attempts: 3, correct: 99, label: "UTG" } },
        streak: 0,
        bestStreak: 0,
      }),
    );
    const restored = readProgress();
    expect(restored.spots["rfi:100:UTG"]!.correct).toBe(3);
    expect(accuracy(restored.spots["rfi:100:UTG"]!)).toBe(100);
  });

  it("rejects negative numbers", () => {
    store.set(
      KEY,
      JSON.stringify({ version: 2, spots: {}, streak: -4, bestStreak: -1 }),
    );
    const restored = readProgress();
    expect(restored.streak).toBe(0);
    expect(restored.bestStreak).toBe(0);
  });

  it("falls back to the key when a label is missing", () => {
    store.set(
      KEY,
      JSON.stringify({
        version: 2,
        spots: { "pf:BB": { attempts: 5, correct: 2 } },
        streak: 0,
        bestStreak: 0,
      }),
    );
    expect(readProgress().spots["pf:BB"]!.label).toBe("pf:BB");
  });
});

describe("summaries", () => {
  it("has no accuracy before the first answer", () => {
    expect(accuracy({ attempts: 0, correct: 0 })).toBeNull();
  });

  it("withholds a weakest spot until the sample is big enough", () => {
    let progress = emptyProgress();
    progress = recordAnswer(progress, "rfi:100:UTG", "UTG open, 100bb", false);
    expect(weakestSpots(progress)).toEqual([]);

    for (let i = 0; i < 5; i++) {
      progress = recordAnswer(progress, "rfi:100:UTG", "UTG open, 100bb", false);
    }
    expect(weakestSpots(progress)[0]?.label).toBe("UTG open, 100bb");
  });

  it("orders the weakest first", () => {
    let progress = emptyProgress();
    for (let i = 0; i < 10; i++) {
      progress = recordAnswer(progress, "a", "spot A", i < 9);
      progress = recordAnswer(progress, "b", "spot B", i < 3);
      progress = recordAnswer(progress, "c", "spot C", i < 6);
    }
    expect(weakestSpots(progress).map((s) => s.label)).toEqual([
      "spot B",
      "spot C",
      "spot A",
    ]);
  });
});

describe("clearProgress", () => {
  it("empties both storage and the returned value", () => {
    writeProgress(recordAnswer(emptyProgress(), "pf:SB", "SB shove", true));
    expect(clearProgress()).toEqual(emptyProgress());
    expect(readProgress()).toEqual(emptyProgress());
  });
});
