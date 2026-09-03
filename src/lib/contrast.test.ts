import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The theme's contrast floors, checked against the theme itself.
 *
 * This exists because low contrast is the same kind of failure the class
 * checker was written for: nothing reports it. A button whose fill sits
 * 1.18:1 off the page renders perfectly, passes every test, and is simply
 * hard to see, which is what the buttons on this trainer were until the
 * numbers below were measured. Taste is not a check; a ratio is.
 *
 * WCAG 2.1 asks for 3:1 between a control and what surrounds it (1.4.11
 * Non-text Contrast) and 4.5:1 for text under 18pt on top of it (1.4.3
 * Contrast Minimum). Those two pull against each other on a dark page: the
 * lighter a fill gets the easier the button is to find and the harder its
 * label is to read. The band where both hold is narrow, so the fills are read
 * out of tailwind.config.js rather than duplicated here -- a test that checked
 * its own copy of the palette would keep passing after someone changed the
 * real one.
 */

const CONFIG = readFileSync(new URL("../../tailwind.config.js", import.meta.url), "utf8");

/** Every `"name": "#rrggbb"` in the theme, which is how all of them are written. */
function themeColours(): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of CONFIG.matchAll(/"?([a-z-]+)"?:\s*"(#[0-9a-fA-F]{6})"/g)) {
    out.set(match[1]!, match[2]!);
  }
  return out;
}

const COLOURS = themeColours();

function colour(name: string): string {
  const found = COLOURS.get(name);
  if (!found) throw new Error(`${name} is not a colour in tailwind.config.js`);
  return found;
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const packed = Number.parseInt(hex.slice(1), 16);
  const channels = [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255].map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const ratio = (a: string, b: string) => contrast(colour(a), colour(b));

/** The three button families, each a fill, its hover, and its edge. */
const FAMILIES = [
  { name: "fold", fill: "act-fold", hover: "act-fold-hi", edge: "act-fold-edge" },
  { name: "call", fill: "act-call", hover: "act-call-hi", edge: "act-call-edge" },
  { name: "bet", fill: "act-bet", hover: "act-bet-hi", edge: "act-bet-edge" },
];

describe("the theme's colour maths", () => {
  it("agrees with the published worked example", () => {
    // WCAG's own figure for black on white, which pins the whole formula.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrast("#256f50", "#0a0d0c")).toBeCloseTo(contrast("#0a0d0c", "#256f50"), 10);
  });
});

describe("buttons stand off the page", () => {
  // The edge is what carries 1.4.11 for a button whose fill is deliberately
  // recessive, which is the fold button: it should not shout, but it does have
  // to be findable.
  for (const family of FAMILIES) {
    it(`${family.name}: its edge clears 3:1 against the page`, () => {
      expect(ratio(family.edge, "page")).toBeGreaterThanOrEqual(3);
    });
  }

  // Fold is the exception on purpose. It is an outlined button, so its fill is
  // allowed to sit near the page and its edge does the work above.
  for (const family of FAMILIES.filter((f) => f.name !== "fold")) {
    it(`${family.name}: its fill clears 3:1 against the page, hovered or not`, () => {
      expect(ratio(family.fill, "page")).toBeGreaterThanOrEqual(3);
      expect(ratio(family.hover, "page")).toBeGreaterThanOrEqual(3);
    });

    it(`${family.name}: hovering makes it lighter, not darker`, () => {
      expect(ratio(family.hover, "page")).toBeGreaterThan(ratio(family.fill, "page"));
    });
  }
});

describe("labels are readable on the button they sit on", () => {
  for (const family of FAMILIES) {
    it(`${family.name}: ink clears 4.5:1 on the fill and on the hover`, () => {
      expect(ratio("ink", family.fill)).toBeGreaterThanOrEqual(4.5);
      expect(ratio("ink", family.hover)).toBeGreaterThanOrEqual(4.5);
    });

    // Both runs of text on an action button, not just the big one. The size
    // under the label used to be `muted`, a colour meant for text on the page,
    // and on the green fill it measured 2:1: the least readable thing on the
    // screen sat on the button you press most. Ink is now the only colour
    // either of them is allowed to be, so one ratio covers both.
    it(`${family.name}: the price under the label clears 4.5:1 too`, () => {
      expect(ratio("ink", family.fill)).toBeGreaterThanOrEqual(4.5);
    });

    // Muted stays legible where it does belong: on the page, and on the
    // keycap, which is page-coloured precisely so this holds on every tone.
    it(`${family.name}: its keycap is legible, being page-coloured`, () => {
      expect(ratio("muted", "page")).toBeGreaterThanOrEqual(4.5);
      expect(ratio(family.fill, "page")).toBeGreaterThanOrEqual(1.2);
    });
  }
});

describe("the rest of the palette", () => {
  it("keeps body text readable on the page", () => {
    expect(ratio("ink", "page")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("muted", "page")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the two verdict colours readable, since they are the fast read", () => {
    expect(ratio("correct", "page")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("wrong", "page")).toBeGreaterThanOrEqual(4.5);
  });

  it("makes the accent visible as a border and as a focus ring", () => {
    expect(ratio("accent", "page")).toBeGreaterThanOrEqual(3);
    expect(ratio("accent", "felt")).toBeGreaterThanOrEqual(3);
  });

  it("keeps the keycap legible wherever it lands", () => {
    // The shortcut hint sits on its own page-coloured cap rather than on the
    // button, precisely so this one ratio holds on all three families instead
    // of three different ones that each have to be checked.
    expect(ratio("muted", "page")).toBeGreaterThanOrEqual(4.5);
  });

  it("tells call and bet apart by hue, so it does not lean on lightness", () => {
    // They are within a hair of each other in luminance by design. A
    // colour-blind read has to come from the label, which is why every button
    // carries one.
    expect(ratio("act-call", "act-bet")).toBeLessThan(1.5);
  });
});
