import { describe, expect, it } from "vitest";
import { RFI_100BB, RFI_EXPECTED_BANDS } from "./rfi";
import { RFI_POSITIONS } from "../positions";
import { parseRange } from "../range";
import { comboPercent, type HandClass } from "../cards";

const ranges = new Map(
  RFI_POSITIONS.map((position) => [position, parseRange(RFI_100BB[position])]),
);

function rangeFor(position: (typeof RFI_POSITIONS)[number]): Set<HandClass> {
  const range = ranges.get(position);
  if (!range) throw new Error(`No range for ${position}`);
  return range;
}

describe("every seat has a parseable chart", () => {
  it("covers all five opening seats", () => {
    expect(Object.keys(RFI_100BB).sort()).toEqual([...RFI_POSITIONS].sort());
  });

  for (const position of RFI_POSITIONS) {
    it(`${position} parses to a non-empty range`, () => {
      expect(rangeFor(position).size).toBeGreaterThan(0);
    });
  }
});

describe("opening frequencies", () => {
  for (const position of RFI_POSITIONS) {
    it(`${position} opens within its expected band`, () => {
      const band = RFI_EXPECTED_BANDS[position];
      const percent = comboPercent(rangeFor(position));
      expect(percent).toBeGreaterThanOrEqual(band[0]);
      expect(percent).toBeLessThanOrEqual(band[1]);
    });
  }

  it("widens as position improves", () => {
    const utg = comboPercent(rangeFor("UTG"));
    const hj = comboPercent(rangeFor("HJ"));
    const co = comboPercent(rangeFor("CO"));
    const btn = comboPercent(rangeFor("BTN"));
    expect(utg).toBeLessThan(hj);
    expect(hj).toBeLessThan(co);
    expect(co).toBeLessThan(btn);
  });
});

describe("the ranges nest", () => {
  const chain = ["UTG", "HJ", "CO", "BTN"] as const;

  for (let i = 0; i < chain.length - 1; i++) {
    const tighter = chain[i]!;
    const wider = chain[i + 1]!;

    it(`every ${tighter} open is also a ${wider} open`, () => {
      const missing = [...rangeFor(tighter)].filter((h) => !rangeFor(wider).has(h));
      expect(missing).toEqual([]);
    });
  }
});

describe("sanity", () => {
  for (const position of RFI_POSITIONS) {
    it(`${position} raises aces and folds 72o`, () => {
      const range = rangeFor(position);
      expect(range.has("AA")).toBe(true);
      expect(range.has("AKs")).toBe(true);
      expect(range.has("72o")).toBe(false);
    });
  }
});
