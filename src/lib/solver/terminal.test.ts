import { describe, expect, it } from "vitest";
import { buildHandSet, type HandSet } from "./hands";
import { foldValues, jointMass, showdownValues, terminalScratch } from "./terminal";
import { CARD_COUNT, parseCards } from "../equity";
import { mulberry32 } from "../rng";

/**
 * The obvious quadratic version of each terminal evaluation.
 *
 * These exist to be slow and boring. The shipping versions are linear time and
 * clever, and clever is exactly the kind of code that can be wrong in a way
 * that still looks plausible: an off-by-one in the card removal would shift
 * every value slightly, the solver would converge happily, and the answer would
 * be to a game nobody is playing. So the clever one is checked against the one
 * that is too simple to be wrong.
 */
function bruteFold(hands: HandSet, reach: Float64Array, payoff: number): Float64Array {
  const out = new Float64Array(hands.count);
  for (let i = 0; i < hands.count; i++) {
    let sum = 0;
    for (let j = 0; j < hands.count; j++) {
      if (shareACard(hands, i, j)) continue;
      sum += reach[j]!;
    }
    out[i] = payoff * sum;
  }
  return out;
}

function bruteShowdown(hands: HandSet, reach: Float64Array, amount: number): Float64Array {
  const out = new Float64Array(hands.count);
  for (let i = 0; i < hands.count; i++) {
    let sum = 0;
    for (let j = 0; j < hands.count; j++) {
      if (shareACard(hands, i, j)) continue;
      if (hands.rank[i]! > hands.rank[j]!) sum += amount * reach[j]!;
      else if (hands.rank[i]! < hands.rank[j]!) sum -= amount * reach[j]!;
    }
    out[i] = sum;
  }
  return out;
}

function shareACard(hands: HandSet, i: number, j: number): boolean {
  const a = hands.cardA[i]!;
  const b = hands.cardB[i]!;
  const c = hands.cardA[j]!;
  const d = hands.cardB[j]!;
  return a === c || a === d || b === c || b === d;
}

function randomReach(count: number, seed: number, zeroRate = 0): Float64Array {
  const rng = mulberry32(seed);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = rng() < zeroRate ? 0 : rng();
  return out;
}

const BOARDS = [
  "Ks Jc 9h 7d 2c", // rainbow-ish, no flush, one straight
  "Ah Kh Qh Jh Th", // a royal flush on the board: every hand ties
  "7c 7d 7h 7s 2c", // quads on the board, so only the kicker separates hands
  "As Ks 4s 9d 2h", // three to a flush, so suits matter a lot
];

describe("terminal evaluation matches the quadratic reference", () => {
  for (const text of BOARDS) {
    const hands = buildHandSet(parseCards(text));

    it(`folds correctly on ${text}`, () => {
      const reach = randomReach(hands.count, 7, 0.3);
      const fast = new Float64Array(hands.count);
      foldValues(hands, reach, 3.5, fast, terminalScratch());
      const slow = bruteFold(hands, reach, 3.5);

      for (let i = 0; i < hands.count; i++) expect(fast[i]!).toBeCloseTo(slow[i]!, 9);
    });

    it(`shows down correctly on ${text}`, () => {
      const reach = randomReach(hands.count, 11, 0.3);
      const fast = new Float64Array(hands.count);
      showdownValues(hands, hands, reach, 12, fast, terminalScratch());
      const slow = bruteShowdown(hands, reach, 12);

      for (let i = 0; i < hands.count; i++) expect(fast[i]!).toBeCloseTo(slow[i]!, 9);
    });
  }

  it("handles a range that is entirely one hand", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    const reach = new Float64Array(hands.count);
    reach[500] = 1;

    const fast = new Float64Array(hands.count);
    showdownValues(hands, hands, reach, 1, fast, terminalScratch());
    const slow = bruteShowdown(hands, reach, 1);
    for (let i = 0; i < hands.count; i++) expect(fast[i]!).toBeCloseTo(slow[i]!, 9);
  });

  it("returns zero everywhere against an empty range", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    const empty = new Float64Array(hands.count);
    const out = new Float64Array(hands.count);

    foldValues(hands, empty, 10, out, terminalScratch());
    expect([...out].every((value) => value === 0)).toBe(true);

    showdownValues(hands, hands, empty, 10, out, terminalScratch());
    expect([...out].every((value) => value === 0)).toBe(true);
  });
});

describe("showdown ties", () => {
  /**
   * A board that plays itself. Every hand makes the same royal flush, so no
   * hand beats another and a showdown is worth nothing to anybody. If the tie
   * handling were off by a group the value would be a large number instead.
   */
  it("are worth nothing when the board is the best hand", () => {
    const hands = buildHandSet(parseCards("Ah Kh Qh Jh Th"));
    const reach = randomReach(hands.count, 3);
    const out = new Float64Array(hands.count);

    showdownValues(hands, hands, reach, 100, out, terminalScratch());
    for (let i = 0; i < hands.count; i++) expect(out[i]!).toBeCloseTo(0, 9);
  });

  it("split the pot rather than awarding it, on quads with a shared kicker", () => {
    // Board is four sevens and a deuce, so a hand only matters if it holds a
    // card above the deuce. Two hands whose best kicker is equal must tie.
    const hands = buildHandSet(parseCards("7c 7d 7h 7s 2c"));
    const kingHigh = hands.indexOf(...(parseCards("Ks Kd") as [number, number]));
    const otherKings = hands.indexOf(...(parseCards("Kh Kc") as [number, number]));
    expect(hands.rank[kingHigh]).toBe(hands.rank[otherKings]);
  });
});

describe("jointMass", () => {
  it("is the pairs of hands the two ranges can actually hold at once", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    const hero = new Float64Array(hands.count);
    const villain = new Float64Array(hands.count);

    // One hand each, sharing no cards: exactly one live pairing.
    hero[hands.indexOf(...(parseCards("Qs Ts") as [number, number]))] = 1;
    villain[hands.indexOf(...(parseCards("8h 8d") as [number, number]))] = 1;
    expect(jointMass(hands, hero, villain)).toBeCloseTo(1, 9);

    // The same hand on both sides: they cannot both hold it, so no pairing.
    const same = new Float64Array(hands.count);
    same[hands.indexOf(...(parseCards("Qs Ts") as [number, number]))] = 1;
    expect(jointMass(hands, same, same)).toBeCloseTo(0, 9);
  });

  it("counts every live pairing for two full ranges", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    const all = new Float64Array(hands.count).fill(1);

    // Each of the 1081 hands can face any hand made from the 45 cards it does
    // not use, which is C(45,2) = 990 of them.
    expect(jointMass(hands, all, all)).toBeCloseTo(1081 * 990, 6);
  });
});

describe("card removal", () => {
  it("removes exactly the hands the hero blocks, and no more", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    const all = new Float64Array(hands.count).fill(1);
    const out = new Float64Array(hands.count);
    foldValues(hands, all, 1, out, terminalScratch());

    // 1081 hands exist; holding two of the 47 live cards kills every hand using
    // either of them. 46 + 46 - 1 = 91 hands, counting the hero's own once.
    for (let i = 0; i < hands.count; i++) expect(out[i]!).toBeCloseTo(1081 - 91, 9);
  });

  it("keeps the per-card sums inside the scratch buffer it was given", () => {
    const hands = buildHandSet(parseCards("Ks Jc 9h 7d 2c"));
    const scratch = terminalScratch();
    expect(scratch.length).toBe(CARD_COUNT);

    const reach = randomReach(hands.count, 5);
    const out = new Float64Array(hands.count);
    foldValues(hands, reach, 1, out, scratch);
    // Reusing the same scratch for a second call must give the same answer, so
    // nothing may depend on what was left in it.
    const again = new Float64Array(hands.count);
    foldValues(hands, reach, 1, again, scratch);
    expect([...again]).toEqual([...out]);
  });
});
