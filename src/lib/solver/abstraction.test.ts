import { describe, expect, it } from "vitest";
import {
  RIVERS_PER_HAND,
  blockerSpread,
  bucketByDistribution,
  bucketByMeanEquity,
  bucketByRiverProfile,
  bucketEveryRiver,
  bucketByScalar,
  equityDistributions,
  riverEquities,
  type Clustering,
} from "./abstraction";
import { buildHandSet, buildRiverViews, weightsFromClasses } from "./hands";
import { cardToInt, parseCards } from "../equity";
import { parseRange } from "../range";
import type { Card } from "../cards";

const BOARD = parseCards("Ks Jc 9h 7d");
const hands = buildHandSet(BOARD, false);
const views = buildRiverViews(hands);
const at = (a: Card, b: Card) => hands.indexOf(cardToInt(a), cardToInt(b));

const wide = new Float64Array(hands.count).fill(1);
const buttonRange = weightsFromClasses(hands, parseRange("22+, A2s+, K5s+, Q8s+, J9s+, ATo+, KJo+"));
const distributions = equityDistributions(hands, views, wide, buttonRange);

describe("equity distributions", () => {
  it("gives every hand the same number of futures", () => {
    // A hand blocks exactly the two rivers it is holding, so 48 - 2 = 46 for
    // everyone. That is what lets the feature vectors be compared at all.
    expect(RIVERS_PER_HAND).toBe(46);
    expect(distributions.sorted).toHaveLength(hands.count * 46);
    expect(distributions.riverCount).toBe(48);
  });

  it("produces equities, not something that merely looks like them", () => {
    for (let i = 0; i < distributions.sorted.length; i += 197) {
      expect(distributions.sorted[i]!).toBeGreaterThanOrEqual(0);
      expect(distributions.sorted[i]!).toBeLessThanOrEqual(1);
    }
  });

  it("sorts each row, which is what makes the L1 distance an earth mover's one", () => {
    for (let h = 0; h < hands.count; h += 37) {
      for (let i = 1; i < RIVERS_PER_HAND; i++) {
        const previous = distributions.sorted[h * RIVERS_PER_HAND + i - 1]!;
        expect(distributions.sorted[h * RIVERS_PER_HAND + i]!).toBeGreaterThanOrEqual(previous);
      }
    }
  });

  it("holds the same numbers unsorted in the river profile", () => {
    for (const h of [0, 300, 700, 1100]) {
      const sorted = [...distributions.sorted.subarray(h * 46, h * 46 + 46)];
      const profile = [...distributions.profile.subarray(h * 48, h * 48 + 48)];
      // Two of the 48 are the hand's own mean, standing in for the rivers it
      // blocks; drop the two closest to the mean and the rest must match.
      const mean = distributions.mean[h]!;
      profile.sort((a, b) => Math.abs(a - mean) - Math.abs(b - mean));
      const rest = profile.slice(2).sort((a, b) => a - b);
      expect(rest.length).toBe(46);
      for (let i = 0; i < 46; i++) expect(rest[i]!).toBeCloseTo(sorted[i]!, 9);
    }
  });

  it("says the nut straight is worth more than air, and by a lot", () => {
    // On Ks Jc 9h 7d, QT already has a straight and 5-4 has nothing.
    expect(distributions.mean[at("Qs", "Ts")]!).toBeGreaterThan(0.9);
    expect(distributions.mean[at("5s", "4h")]!).toBeLessThan(0.2);
  });

  it("ranks a draw above the made hand it is currently losing to", () => {
    // Ah Qh is ace high with an open ended straight draw; 6-5 offsuit is
    // nothing at all. A scalar cannot tell a draw from a weak made hand, which
    // is the whole reason the distribution exists, but the mean should still
    // put the live hand first.
    expect(distributions.mean[at("Ah", "Qh")]!).toBeGreaterThan(
      distributions.mean[at("6s", "5h")]!,
    );
  });

  it("only counts hands the player actually holds as live", () => {
    const narrow = equityDistributions(hands, views, buttonRange, wide);
    expect(narrow.live.length).toBeLessThan(hands.count);
    for (const hand of narrow.live) expect(buttonRange[hand]!).toBeGreaterThan(0);
  });
});

describe("clustering", () => {
  const metrics = [
    ["mean equity", bucketByMeanEquity],
    ["sorted distribution", bucketByDistribution],
    ["river profile", bucketByRiverProfile],
  ] as const;

  for (const [name, cluster] of metrics) {
    describe(name, () => {
      it("puts every live hand in a bucket that exists", () => {
        const result = cluster(distributions, 16);
        expect(result.count).toBeLessThanOrEqual(16);
        for (const hand of distributions.live) {
          expect(result.map[hand]!).toBeGreaterThanOrEqual(0);
          expect(result.map[hand]!).toBeLessThan(result.count);
        }
      });

      it("fits tighter as it is given more buckets", () => {
        const coarse = cluster(distributions, 4);
        const fine = cluster(distributions, 64);
        expect(fine.distortion).toBeLessThan(coarse.distortion);
        expect(fine.largest).toBeLessThan(coarse.largest);
      });

      it("is deterministic, so a measurement against it can be repeated", () => {
        const first = cluster(distributions, 12);
        const second = cluster(distributions, 12);
        expect([...second.map]).toEqual([...first.map]);
        expect(second.distortion).toBe(first.distortion);
      });

      it("never asks for more buckets than there are hands", () => {
        // On a handful of hands rather than all 1128: clustering a thousand
        // hands into a thousand buckets is a slow way to test one comparison.
        const few = { ...distributions, live: distributions.live.slice(0, 20) };
        const silly = cluster(few, 500);
        expect(silly.count).toBe(20);
      });
    });
  }

  /**
   * The one that is worth the trouble.
   *
   * k-means minimises distortion and does not care how lopsided the answer is,
   * so it will leave one enormous cluster of near-identical hands and spend the
   * rest of its budget splitting hairs at the top. An equal frequency split
   * cannot do that. Both are defensible; they are different trades, and the
   * bench measures which one the solver prefers.
   */
  it("splits evenly when it sorts, and unevenly when it clusters", () => {
    const even = bucketByMeanEquity(distributions, 16);
    const clustered = bucketByDistribution(distributions, 16);
    const ideal = distributions.live.length / 16;

    expect(even.largest).toBeLessThan(ideal * 1.5);
    expect(clustered.largest).toBeGreaterThan(even.largest);
  });

  /**
   * Distortion is reported in each metric's own units, so the numbers the two
   * clusterings print are not comparable. This scores both of them the same
   * way: how far each hand sits from its own bucket's average distribution,
   * under earth mover's distance. That is the question the abstraction is
   * actually answering, and the clustering that optimises it should win it.
   */
  function scoreUnderEmd(clustering: Clustering): number {
    const centroids = new Float64Array(clustering.count * RIVERS_PER_HAND);
    const sizes = new Int32Array(clustering.count);

    for (const hand of distributions.live) {
      const bucket = clustering.map[hand]!;
      sizes[bucket] = sizes[bucket]! + 1;
      for (let i = 0; i < RIVERS_PER_HAND; i++) {
        const at = bucket * RIVERS_PER_HAND + i;
        centroids[at] = centroids[at]! + distributions.sorted[hand * RIVERS_PER_HAND + i]!;
      }
    }
    for (let b = 0; b < clustering.count; b++) {
      if (sizes[b] === 0) continue;
      for (let i = 0; i < RIVERS_PER_HAND; i++) {
        centroids[b * RIVERS_PER_HAND + i] = centroids[b * RIVERS_PER_HAND + i]! / sizes[b]!;
      }
    }

    let total = 0;
    for (const hand of distributions.live) {
      const bucket = clustering.map[hand]!;
      let distance = 0;
      for (let i = 0; i < RIVERS_PER_HAND; i++) {
        distance += Math.abs(
          distributions.sorted[hand * RIVERS_PER_HAND + i]! -
            centroids[bucket * RIVERS_PER_HAND + i]!,
        );
      }
      total += distance / RIVERS_PER_HAND;
    }
    return total / distributions.live.length;
  }

  it("beats the scalar at the job the scalar is standing in for", () => {
    for (const size of [16, 64]) {
      const clustered = scoreUnderEmd(bucketByDistribution(distributions, size));
      const scalar = scoreUnderEmd(bucketByMeanEquity(distributions, size));
      expect(clustered).toBeLessThan(scalar);
    }
  });
});

describe("bucketByScalar", () => {
  it("makes groups of near-equal size", () => {
    const values = Float64Array.from({ length: 100 }, (_, i) => i / 100);
    const live = Int32Array.from({ length: 100 }, (_, i) => i);
    const result = bucketByScalar(values, live, 10, 100);

    const sizes = new Array(10).fill(0);
    for (const hand of live) sizes[result.map[hand]!]++;
    for (const size of sizes) expect(size).toBe(10);
  });

  it("keeps the ordering: a stronger hand never lands in a weaker bucket", () => {
    const result = bucketByScalar(distributions.mean, distributions.live, 20, hands.count);

    // Checked by walking the sorted order once rather than comparing every
    // pair, which on 1128 hands would be 1.2 million assertions.
    const order = Array.from(distributions.live).sort(
      (x, y) => distributions.mean[x]! - distributions.mean[y]!,
    );
    for (let i = 1; i < order.length; i++) {
      expect(result.map[order[i]!]!).toBeGreaterThanOrEqual(result.map[order[i - 1]!]!);
    }
  });

  it("survives a range with nothing in it", () => {
    const empty = bucketByScalar(distributions.mean, new Int32Array(0), 8, hands.count);
    expect(empty.count).toBe(1);
    expect(empty.distortion).toBe(0);
  });
});

describe("river abstraction", () => {
  it("scores every hand on a finished board", () => {
    const equities = riverEquities(hands, views[0]!, buttonRange);
    expect(equities).toHaveLength(hands.count);
    for (const hand of views[0]!.blocked) expect(equities[hand]).toBe(0.5);
  });

  it("makes one clustering per river, because each river is a different game", () => {
    const perRiver = bucketEveryRiver(hands, views, wide, buttonRange, 8);
    expect(perRiver).toHaveLength(48);
    for (const clustering of perRiver) expect(clustering.count).toBeLessThanOrEqual(8);

    // The same hand does not have to land in the same bucket on two different
    // rivers. If it always did, the abstraction would be ignoring the board.
    const hand = at("Ah", "Qh");
    const buckets = new Set(perRiver.map((c: Clustering) => c.map[hand]!));
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe("blockerSpread", () => {
  /**
   * The argument against bucketing, as a number. Hands sharing a bucket share
   * their card removal, and this says by how much they disagree about it.
   */
  it("is zero when every hand blocks the same amount", () => {
    // Against a uniform range every hand blocks exactly the same weight, so
    // there is genuinely nothing for an abstraction to lose here. Which is also
    // why measuring abstraction against uniform ranges flatters it.
    const uniform = equityDistributions(hands, views, wide, wide);
    const clustering = bucketByMeanEquity(uniform, 8);
    expect(blockerSpread(hands, wide, clustering)).toBeCloseTo(0, 9);
  });

  it("is positive against a real range, and falls as buckets get finer", () => {
    const coarse = blockerSpread(hands, buttonRange, bucketByMeanEquity(distributions, 4));
    const fine = blockerSpread(hands, buttonRange, bucketByMeanEquity(distributions, 128));
    expect(coarse).toBeGreaterThan(0);
    expect(fine).toBeLessThan(coarse);
  });
});
