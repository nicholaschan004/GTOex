import { describe, expect, it } from "vitest";
import { RangeSyntaxError, formatRange, parseRange } from "./range";
import { allHandClasses, comboPercent } from "./cards";

const sorted = (notation: string) => [...parseRange(notation)].sort();

describe("single hands", () => {
  it("reads pairs, suited and offsuit", () => {
    expect(sorted("AA")).toEqual(["AA"]);
    expect(sorted("AKs")).toEqual(["AKs"]);
    expect(sorted("AKo")).toEqual(["AKo"]);
  });

  it("normalises rank order and case", () => {
    expect(sorted("kas")).toEqual(["AKs"]);
    expect(sorted("2Ao")).toEqual(["A2o"]);
  });

  it("treats a bare non-pair as both suited and offsuit", () => {
    expect(sorted("AK")).toEqual(["AKo", "AKs"]);
  });
});

describe("the + suffix", () => {
  it("climbs pairs to aces", () => {
    expect(sorted("QQ+")).toEqual(["AA", "KK", "QQ"]);
    expect(sorted("22+")).toHaveLength(13);
    expect(sorted("AA+")).toEqual(["AA"]);
  });

  it("holds the high card and climbs the kicker", () => {
    expect(sorted("A9s+")).toEqual(["A9s", "AJs", "AKs", "AQs", "ATs"].sort());
    expect(sorted("KTs+")).toEqual(["KJs", "KQs", "KTs"].sort());
    expect(sorted("ATo+")).toEqual(["AJo", "AKo", "AQo", "ATo"].sort());
  });

  it("does not read connectors as climbing, so T9s+ is only T9s", () => {
    // Guards the other convention some people assume, where T9s+ would mean
    // T9s, JTs, QJs, KQs, AKs. Charts here are written under the kicker rule.
    expect(sorted("T9s+")).toEqual(["T9s"]);
    expect(sorted("AKs+")).toEqual(["AKs"]);
  });
});

describe("dash ranges", () => {
  it("spans pairs in either direction", () => {
    expect(sorted("99-66")).toEqual(["66", "77", "88", "99"]);
    expect(sorted("66-99")).toEqual(["66", "77", "88", "99"]);
  });

  it("spans kickers under a shared high card", () => {
    expect(sorted("AJs-A9s")).toEqual(["A9s", "AJs", "ATs"].sort());
    expect(sorted("A9s-AJs")).toEqual(["A9s", "AJs", "ATs"].sort());
  });
});

describe("whole ranges", () => {
  it("accepts commas, spaces, or both", () => {
    const a = parseRange("22+, AKs, AQo");
    const b = parseRange("22+ AKs AQo");
    const c = parseRange("22+,AKs,AQo");
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("de-duplicates overlapping tokens", () => {
    expect(parseRange("AKs, AKs, AK").size).toBe(2);
    expect(parseRange("22+, 77+").size).toBe(13);
  });

  it("ignores empty input", () => {
    expect(parseRange("").size).toBe(0);
    expect(parseRange("   ").size).toBe(0);
  });

  it("can name the whole deck, and that is 100 percent", () => {
    const everything = parseRange("22+, 32s+, 42s+, 52s+, 62s+, 72s+, 82s+, 92s+, T2s+, J2s+, Q2s+, K2s+, A2s+, 32o+, 42o+, 52o+, 62o+, 72o+, 82o+, 92o+, T2o+, J2o+, Q2o+, K2o+, A2o+");
    expect(everything.size).toBe(169);
    expect(new Set(allHandClasses())).toEqual(everything);
    expect(comboPercent(everything)).toBeCloseTo(100, 10);
  });
});

describe("errors", () => {
  const bad = (notation: string) => () => parseRange(notation);

  it("rejects unknown ranks", () => {
    expect(bad("AXs")).toThrow(RangeSyntaxError);
    expect(bad("1 2")).toThrow(RangeSyntaxError);
  });

  it("rejects a suited pair", () => {
    expect(bad("AAs")).toThrow(/cannot be suited/);
  });

  it("rejects mismatched dash endpoints", () => {
    expect(bad("AJs-K9s")).toThrow(/share a high card/);
    expect(bad("AJs-A9o")).toThrow(/both offsuit/);
    expect(bad("99-A9s")).toThrow(/pair to a non-pair/);
    expect(bad("AJs-ATs-A9s")).toThrow(/exactly two endpoints/);
  });

  it("rejects a lone plus", () => {
    expect(bad("+")).toThrow(RangeSyntaxError);
  });

  it("names the offending token in the message", () => {
    expect(bad("22+, QXs, AKo")).toThrow(/"QXs"/);
  });
});

describe("formatRange", () => {
  const roundTrip = (notation: string) => formatRange(parseRange(notation));

  it("writes the notation it would have parsed", () => {
    expect(roundTrip("22+")).toBe("22+");
    expect(roundTrip("QQ+")).toBe("QQ+");
    expect(roundTrip("99-66")).toBe("99-66");
    expect(roundTrip("AKs")).toBe("AKs");
    expect(roundTrip("A9s+")).toBe("A9s+");
    expect(roundTrip("AJs-A9s")).toBe("AJs-A9s");
  });

  it("splits a gap into two tokens", () => {
    expect(roundTrip("AA, QQ")).toBe("AA, QQ");
    expect(roundTrip("A2s, A5s-A4s")).toBe("A5s-A4s, A2s");
  });

  it("round trips every chart in the project", () => {
    const charts = [
      "22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, AJo+, KQo",
      "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K7o+, Q9o+, J9o+, T9o",
      "TT+, AKs, AKo, AQs, AQo, A5s, A4s, A3s, A2s, K9s, K8s",
      "44+, A2s+, K9s+, Q9s+, JTs, T9s, ATo+, KQo",
    ];
    for (const chart of charts) {
      expect(parseRange(formatRange(parseRange(chart)))).toEqual(parseRange(chart));
    }
  });

  it("round trips every possible single hand", () => {
    for (const hand of allHandClasses()) {
      const set = new Set([hand]);
      expect(parseRange(formatRange(set))).toEqual(set);
    }
  });

  it("handles the empty range and the full deck", () => {
    expect(formatRange(new Set())).toBe("");
    const everything = new Set(allHandClasses());
    expect(parseRange(formatRange(everything))).toEqual(everything);
  });
});
