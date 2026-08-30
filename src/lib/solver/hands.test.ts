import { describe, expect, it } from "vitest";
import { buildHandSet, weightsFromCombos } from "./hands";
import { CATEGORY, cardToInt, categoryOf, combosOfClass, parseCards } from "../equity";

describe("buildHandSet", () => {
  it("finds every hand the board leaves live", () => {
    // 52 cards, 5 on the board, so C(47,2).
    expect(buildHandSet(parseCards("Ks Jc 9h 7d 2c")).count).toBe(1081);
    // A turn board leaves one more card in the deck: C(48,2).
    expect(buildHandSet(parseCards("Ks Jc 9h 7d"), false).count).toBe(1128);
  });

  it("never deals a card that is already on the board", () => {
    const board = parseCards("Ks Jc 9h 7d 2c");
    const hands = buildHandSet(board);
    for (let i = 0; i < hands.count; i++) {
      expect(board).not.toContain(hands.cardA[i]);
      expect(board).not.toContain(hands.cardB[i]);
    }
  });

  it("finds a hand from either order of its cards, and nothing from a blocked one", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    const queen = cardToInt("Qs");
    const ten = cardToInt("Ts");
    expect(hands.indexOf(queen, ten)).toBe(hands.indexOf(ten, queen));
    expect(hands.indexOf(queen, ten)).toBeGreaterThanOrEqual(0);
    // The king of spades is on the board, so no hand can hold it.
    expect(hands.indexOf(cardToInt("Ks"), queen)).toBe(-1);
  });

  it("rejects a board that deals the same card twice", () => {
    expect(() => buildHandSet([0, 0, 1, 2, 3])).toThrow(/duplicate/i);
  });

  it("rejects an incomplete board when asked for showdown ranks", () => {
    expect(() => buildHandSet(parseCards("Ks Jc 9h 7d"), true)).toThrow(/five card board/i);
  });
});

describe("showdown ranks", () => {
  const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
  const rankOf = (a: string, b: string) =>
    hands.rank[hands.indexOf(cardToInt(a as never), cardToInt(b as never))]!;

  it("puts the straight above the set, and the set above the pair", () => {
    const straight = rankOf("Qs", "Ts");
    const set = rankOf("9s", "9c");
    const pair = rankOf("Kh", "8d");
    const nothing = rankOf("5s", "4h");

    expect(straight).toBeGreaterThan(set);
    expect(set).toBeGreaterThan(pair);
    expect(pair).toBeGreaterThan(nothing);
  });

  it("agrees with the evaluator's own categories", () => {
    expect(categoryOf(rankOf("Qs", "Ts"))).toBe(CATEGORY.STRAIGHT);
    expect(categoryOf(rankOf("9s", "9c"))).toBe(CATEGORY.TRIPS);
    expect(categoryOf(rankOf("5s", "4h"))).toBe(CATEGORY.HIGH_CARD);
  });

  it("sorts weakest first, and keeps the order stable", () => {
    for (let i = 1; i < hands.count; i++) {
      const previous = hands.rank[hands.byRank[i - 1]!]!;
      const current = hands.rank[hands.byRank[i]!]!;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
    // Ranks are equal often enough that a stable order matters; rebuilding the
    // same board must give the identical sequence or solver output would drift
    // between runs for no reason.
    const again = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    expect([...again.byRank]).toEqual([...hands.byRank]);
  });

  it("leaves ranks alone on an incomplete board rather than inventing them", () => {
    const turn = buildHandSet(parseCards("Ks Jc 9h 7d"), false);
    expect([...turn.rank].every((value) => value === 0)).toBe(true);
  });
});

describe("handsWithCard", () => {
  const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));

  it("lists every live hand holding a card, and nothing for a board card", () => {
    // 47 cards are live, so a given one pairs with the other 46.
    expect(hands.handsWithCard[cardToInt("Qs")]!.length).toBe(46);
    expect(hands.handsWithCard[cardToInt("Ks")]!.length).toBe(0);
  });

  it("accounts for every hand exactly twice, once per card it holds", () => {
    const total = hands.handsWithCard.reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(hands.count * 2);
  });
});

describe("weightsFromCombos", () => {
  it("turns a preflop hand class into the combos the board leaves", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));

    // Six combos of pocket nines exist preflop, but the nine of hearts is on
    // the board, so only the three that avoid it survive.
    const nines = weightsFromCombos(hands, combosOfClass("99"));
    expect([...nines].reduce((sum, weight) => sum + weight, 0)).toBe(3);

    // Queen-ten offsuit is untouched by this board: all twelve remain.
    const queenTen = weightsFromCombos(hands, combosOfClass("QTo"));
    expect([...queenTen].reduce((sum, weight) => sum + weight, 0)).toBe(12);
  });

  it("carries a weight through, for ranges that are not all or nothing", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    const half = weightsFromCombos(hands, combosOfClass("QTo"), 0.5);
    expect([...half].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(6, 9);
  });
});
