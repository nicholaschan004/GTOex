import { describe, expect, it } from "vitest";
import { RFI_BY_DEPTH, RFI_EXPECTED_BANDS } from "./rfi";
import { RFI_POSITIONS, STACK_DEPTHS, type RfiPosition, type StackDepth } from "../positions";
import { parseRange } from "../range";
import { comboPercent, type HandClass } from "../cards";

const ranges = new Map<string, Set<HandClass>>();
for (const depth of STACK_DEPTHS) {
  for (const position of RFI_POSITIONS) {
    ranges.set(`${depth}:${position}`, parseRange(RFI_BY_DEPTH[depth][position]));
  }
}

function rangeFor(depth: StackDepth, position: RfiPosition): Set<HandClass> {
  const range = ranges.get(`${depth}:${position}`);
  if (!range) throw new Error(`No range for ${position} at ${depth}bb`);
  return range;
}

const percentFor = (depth: StackDepth, position: RfiPosition) =>
  comboPercent(rangeFor(depth, position));

describe("every depth has a chart for every opening seat", () => {
  for (const depth of STACK_DEPTHS) {
    it(`${depth}bb covers all five seats`, () => {
      expect(Object.keys(RFI_BY_DEPTH[depth]).sort()).toEqual([...RFI_POSITIONS].sort());
      for (const position of RFI_POSITIONS) {
        expect(rangeFor(depth, position).size).toBeGreaterThan(0);
      }
    });
  }
});

describe("opening frequencies", () => {
  for (const depth of STACK_DEPTHS) {
    for (const position of RFI_POSITIONS) {
      it(`${position} at ${depth}bb is within its band`, () => {
        const [low, high] = RFI_EXPECTED_BANDS[position];
        const percent = percentFor(depth, position);
        expect(percent).toBeGreaterThanOrEqual(low);
        expect(percent).toBeLessThanOrEqual(high);
      });
    }
  }

  for (const depth of STACK_DEPTHS) {
    it(`widens as position improves at ${depth}bb`, () => {
      const chain: RfiPosition[] = ["UTG", "HJ", "CO", "BTN"];
      for (let i = 1; i < chain.length; i++) {
        expect(percentFor(depth, chain[i]!)).toBeGreaterThan(percentFor(depth, chain[i - 1]!));
      }
    });
  }
});

describe("the ranges nest within each depth", () => {
  const chain: RfiPosition[] = ["UTG", "HJ", "CO", "BTN"];

  for (const depth of STACK_DEPTHS) {
    for (let i = 0; i < chain.length - 1; i++) {
      const tighter = chain[i]!;
      const wider = chain[i + 1]!;
      it(`every ${tighter} open is also a ${wider} open at ${depth}bb`, () => {
        const missing = [...rangeFor(depth, tighter)].filter(
          (hand) => !rangeFor(depth, wider).has(hand),
        );
        expect(missing).toEqual([]);
      });
    }
  }
});

describe("depth changes what is worth opening", () => {
  for (const position of RFI_POSITIONS) {
    it(`${position} opens wider the deeper the stacks get`, () => {
      for (let i = 1; i < STACK_DEPTHS.length; i++) {
        const shallow = percentFor(STACK_DEPTHS[i - 1]!, position);
        const deep = percentFor(STACK_DEPTHS[i]!, position);
        expect(deep).toBeGreaterThan(shallow);
      }
    });
  }

  it("drops the smallest pairs from under the gun at 20bb", () => {
    // No implied odds to justify set mining when the stacks are this short.
    expect(rangeFor(20, "UTG").has("22")).toBe(false);
    expect(rangeFor(100, "UTG").has("22")).toBe(true);
  });

  it("carries more offsuit broadways at 20bb than the deep chart does", () => {
    // Raw high card strength is worth more when hands get to showdown sooner.
    expect(rangeFor(20, "UTG").has("ATo")).toBe(true);
    expect(rangeFor(200, "UTG").has("ATo")).toBe(false);
  });

  it("carries more suited connectors at 200bb", () => {
    expect(rangeFor(200, "UTG").has("65s")).toBe(true);
    expect(rangeFor(20, "UTG").has("65s")).toBe(false);
  });
});

describe("sanity", () => {
  for (const depth of STACK_DEPTHS) {
    for (const position of RFI_POSITIONS) {
      it(`${position} at ${depth}bb raises aces and folds 72o`, () => {
        const range = rangeFor(depth, position);
        expect(range.has("AA")).toBe(true);
        expect(range.has("AKs")).toBe(true);
        expect(range.has("72o")).toBe(false);
      });
    }
  }
});
