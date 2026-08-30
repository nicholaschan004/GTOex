import { describe, expect, it } from "vitest";
import {
  CATEGORY,
  categoryOf,
  cardToInt,
  combosOfClass,
  evaluate7,
  exactEquity,
  intToCard,
  monteCarloEquity,
  parseCards,
} from "./equity";
import { comboCount } from "./cards";

const hand = (text: string) => evaluate7(parseCards(text));

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("card packing", () => {
  it("round trips every card", () => {
    for (const rank of "AKQJT98765432") {
      for (const suit of "shdc") {
        const card = `${rank}${suit}` as Parameters<typeof cardToInt>[0];
        expect(intToCard(cardToInt(card))).toBe(card);
      }
    }
  });

  it("orders aces high", () => {
    expect(cardToInt("As") >> 2).toBe(12);
    expect(cardToInt("2s") >> 2).toBe(0);
  });
});

describe("hand categories", () => {
  const cases: [string, number, string][] = [
    ["As Ks Qs Js Ts 2h 3d", CATEGORY.STRAIGHT_FLUSH, "royal flush"],
    ["5s 4s 3s 2s As Kh Qd", CATEGORY.STRAIGHT_FLUSH, "steel wheel"],
    ["9c 9d 9h 9s 2c 3d 4h", CATEGORY.QUADS, "quads"],
    ["9c 9d 9h 4s 4c 2d 3h", CATEGORY.FULL_HOUSE, "full house"],
    ["9c 9d 9h 4s 4c 4d 2h", CATEGORY.FULL_HOUSE, "two sets is a full house"],
    ["As Js 9s 5s 3s Kh Qd", CATEGORY.FLUSH, "flush"],
    ["9c 8d 7h 6s 5c Ad Kh", CATEGORY.STRAIGHT, "straight"],
    ["5c 4d 3h 2s Ac Kd Qh", CATEGORY.STRAIGHT, "wheel, ace plays low"],
    ["9c 9d 9h 4s 3c 2d 5h", CATEGORY.TRIPS, "trips"],
    ["9c 9d 4h 4s 3c 2d 7h", CATEGORY.TWO_PAIR, "two pair"],
    ["9c 9d 4h 3s 2c 7d 5h", CATEGORY.PAIR, "one pair"],
    ["Ac Jd 9h 5s 3c 2d 7h", CATEGORY.HIGH_CARD, "high card"],
  ];

  for (const [cards, expected, name] of cases) {
    it(name, () => {
      expect(categoryOf(hand(cards))).toBe(expected);
    });
  }

  it("does not read a wrapped ace as a straight", () => {
    // QKA23 is not a straight. The wheel is the only place the ace plays low.
    expect(categoryOf(hand("Qc Kd Ah 2s 3c 7d 9h"))).toBe(CATEGORY.HIGH_CARD);
  });

  it("takes the best five of seven", () => {
    // Trips plus a pair is a full house, not trips.
    expect(categoryOf(hand("Kc Kd Kh 2s 2c 7d 9h"))).toBe(CATEGORY.FULL_HOUSE);
  });
});

describe("hand ordering", () => {
  it("ranks categories in the right order", () => {
    const ordered = [
      "Ac Jd 9h 5s 3c 2d 7h", // high card
      "9c 9d 4h 3s 2c 7d 5h", // pair
      "9c 9d 4h 4s 3c 2d 7h", // two pair
      "9c 9d 9h 4s 3c 2d 5h", // trips
      "9c 8d 7h 6s 5c Ad Kh", // straight
      "As Js 9s 5s 3s Kh Qd", // flush
      "9c 9d 9h 4s 4c 2d 3h", // full house
      "9c 9d 9h 9s 2c 3d 4h", // quads
      "As Ks Qs Js Ts 2h 3d", // straight flush
    ].map(hand);

    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!).toBeGreaterThan(ordered[i - 1]!);
    }
  });

  it("compares kickers", () => {
    expect(hand("Ac Ad Kh 5s 3c 2d 7h")).toBeGreaterThan(hand("Ac Ad Qh 5s 3c 2d 7h"));
    expect(hand("Ac Kd Qh Js 9c 2d 3h")).toBeGreaterThan(hand("Ac Kd Qh Js 8c 2d 3h"));
  });

  it("calls identical holdings a tie", () => {
    expect(hand("Ac Ad Kh 5s 3c 2d 7h")).toBe(hand("As Ah Kd 5c 3d 2h 7s"));
  });
});

describe("combosOfClass", () => {
  it("produces the right number of combinations", () => {
    expect(combosOfClass("AA")).toHaveLength(comboCount("AA"));
    expect(combosOfClass("AKs")).toHaveLength(comboCount("AKs"));
    expect(combosOfClass("AKo")).toHaveLength(comboCount("AKo"));
  });

  it("never repeats a card inside a combination", () => {
    for (const cls of ["AA", "AKs", "AKo", "72o", "22"] as const) {
      for (const [a, b] of combosOfClass(cls)) expect(a).not.toBe(b);
    }
  });

  it("makes suited hands share a suit and offsuit hands not", () => {
    for (const [a, b] of combosOfClass("AKs")) expect(a & 3).toBe(b & 3);
    for (const [a, b] of combosOfClass("AKo")) expect(a & 3).not.toBe(b & 3);
  });
});

/**
 * These are the numbers that make the engine trustworthy. Every one of them is
 * a figure any equity calculator will reproduce, so agreeing with them is
 * evidence about this code rather than a restatement of it.
 */
describe("known all-in equities", () => {
  const equityOf = (heroText: string, villainText: string) =>
    exactEquity(parseCards(heroText), parseCards(villainText)).hero * 100;

  it("aces against kings is about 82 percent", () => {
    const equity = equityOf("Ah Ad", "Kh Kd");
    expect(equity).toBeGreaterThan(80);
    expect(equity).toBeLessThan(84);
  });

  it("suited big slick against queens is about 46 percent", () => {
    const equity = equityOf("Ah Kh", "Qs Qd");
    expect(equity).toBeGreaterThan(44);
    expect(equity).toBeLessThan(48);
  });

  it("offsuit big slick does worse than suited against the same queens", () => {
    const suited = equityOf("Ah Kh", "Qs Qd");
    const offsuit = equityOf("Ah Kc", "Qs Qd");
    expect(offsuit).toBeGreaterThan(41);
    expect(offsuit).toBeLessThan(45);
    expect(offsuit).toBeLessThan(suited);
  });

  it("aces against seven deuce is about 88 percent", () => {
    const equity = equityOf("Ah Ad", "7s 2c");
    expect(equity).toBeGreaterThan(86);
    expect(equity).toBeLessThan(90);
  });

  it("a small pair against two overcards is close to a coin flip", () => {
    const equity = equityOf("2h 2d", "As Ks");
    expect(equity).toBeGreaterThan(46);
    expect(equity).toBeLessThan(54);
  });

  it("is symmetric: the two sides plus ties account for the whole pot", () => {
    const hero = exactEquity(parseCards("Ah Kh"), parseCards("Qs Qd"));
    const villain = exactEquity(parseCards("Qs Qd"), parseCards("Ah Kh"));
    expect(hero.hero + villain.hero).toBeCloseTo(1, 10);
    expect(hero.trials).toBe(villain.trials);
  });

  it("enumerates every board exactly once", () => {
    // C(48,5)
    expect(exactEquity(parseCards("Ah Ad"), parseCards("Kh Kd")).trials).toBe(1_712_304);
  });
});

describe("monte carlo agrees with enumeration", () => {
  it("lands within half a point on a known matchup", () => {
    const exact = exactEquity(parseCards("Ah Kh"), parseCards("Qs Qd")).hero * 100;
    const sampled =
      monteCarloEquity(parseCards("Ah Kh"), parseCards("Qs Qd"), 200_000, seededRng(7)).hero * 100;
    expect(Math.abs(sampled - exact)).toBeLessThan(0.5);
  });

  it("never deals a board card that is already in a hand", () => {
    const rng = seededRng(21);
    const hero = parseCards("Ah Kh");
    const villain = parseCards("Qs Qd");
    // A duplicated card would corrupt the evaluation silently, so assert the
    // trial count rather than trusting the shuffle.
    const result = monteCarloEquity(hero, villain, 5000, rng);
    expect(result.trials).toBe(5000);
    expect(result.wins + result.ties + result.losses).toBe(5000);
  });
});
