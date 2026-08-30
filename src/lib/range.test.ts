import { describe, expect, it } from "vitest";
import { RangeSyntaxError, parseRange } from "./range";
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
