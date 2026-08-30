import { beforeEach, describe, expect, it } from "vitest";
import {
  accuracy,
  clearProgress,
  emptyProgress,
  readProgress,
  recordAnswer,
  totals,
  weakestPosition,
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

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});

describe("round trip", () => {
  it("survives a write and read", () => {
    let progress = emptyProgress();
    progress = recordAnswer(progress, "BTN", true);
    progress = recordAnswer(progress, "BTN", false);
    writeProgress(progress);

    const restored = readProgress();
    expect(restored.byPosition.BTN).toEqual({ attempts: 2, correct: 1 });
  });

  it("starts empty when nothing is stored", () => {
    expect(readProgress()).toEqual(emptyProgress());
  });
});

describe("streaks", () => {
  it("counts up on correct and resets on wrong", () => {
    let progress = emptyProgress();
    progress = recordAnswer(progress, "CO", true);
    progress = recordAnswer(progress, "CO", true);
    progress = recordAnswer(progress, "CO", true);
    expect(progress.streak).toBe(3);
    expect(progress.bestStreak).toBe(3);

    progress = recordAnswer(progress, "CO", false);
    expect(progress.streak).toBe(0);
    expect(progress.bestStreak).toBe(3);
  });
});

describe("corrupt storage", () => {
  it("shrugs off unparseable json", () => {
    store.set("gtoex:progress:v1", "{not json");
    expect(readProgress()).toEqual(emptyProgress());
  });

  it("discards an unknown schema version", () => {
    store.set("gtoex:progress:v1", JSON.stringify({ version: 99, streak: 5 }));
    expect(readProgress()).toEqual(emptyProgress());
  });

  it("clamps a correct count above attempts, so accuracy cannot exceed 100", () => {
    store.set(
      "gtoex:progress:v1",
      JSON.stringify({
        version: 1,
        byPosition: { UTG: { attempts: 3, correct: 99 } },
        streak: 0,
        bestStreak: 0,
      }),
    );
    const restored = readProgress();
    expect(restored.byPosition.UTG).toEqual({ attempts: 3, correct: 3 });
    expect(accuracy(restored.byPosition.UTG)).toBe(100);
  });

  it("rejects negative numbers", () => {
    store.set(
      "gtoex:progress:v1",
      JSON.stringify({ version: 1, byPosition: {}, streak: -4, bestStreak: -1 }),
    );
    const restored = readProgress();
    expect(restored.streak).toBe(0);
    expect(restored.bestStreak).toBe(0);
  });
});

describe("summaries", () => {
  it("totals across every seat", () => {
    let progress = emptyProgress();
    progress = recordAnswer(progress, "UTG", true);
    progress = recordAnswer(progress, "BTN", false);
    expect(totals(progress)).toEqual({ attempts: 2, correct: 1 });
  });

  it("has no accuracy before the first answer", () => {
    expect(accuracy({ attempts: 0, correct: 0 })).toBeNull();
  });

  it("withholds a weakest seat until the sample is big enough", () => {
    let progress = emptyProgress();
    progress = recordAnswer(progress, "UTG", false);
    expect(weakestPosition(progress)).toBeNull();

    for (let i = 0; i < 5; i++) progress = recordAnswer(progress, "UTG", false);
    expect(weakestPosition(progress)).toBe("UTG");
  });

  it("picks the lowest rate among seats that qualify", () => {
    let progress = emptyProgress();
    for (let i = 0; i < 10; i++) progress = recordAnswer(progress, "UTG", i < 9);
    for (let i = 0; i < 10; i++) progress = recordAnswer(progress, "BTN", i < 3);
    expect(weakestPosition(progress)).toBe("BTN");
  });
});

describe("clearProgress", () => {
  it("empties both storage and the returned value", () => {
    writeProgress(recordAnswer(emptyProgress(), "SB", true));
    expect(clearProgress()).toEqual(emptyProgress());
    expect(readProgress()).toEqual(emptyProgress());
  });
});
