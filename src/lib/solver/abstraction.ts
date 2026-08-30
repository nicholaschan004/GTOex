/**
 * Card abstraction: deciding which hands are allowed to share a strategy.
 *
 * A turn solve costs forty eight river subgames per iteration. The classical
 * answer is to stop treating every hand as its own decision and group the ones
 * that play alike, which is what this file builds.
 *
 * The interesting question is what "play alike" means, and the literature is a
 * story of that answer getting less naive:
 *
 *   E[HS], a hand's average equity, is the obvious metric and the wrong one. It
 *   collapses hands that could not play more differently. A middling made hand
 *   and a big draw can average the same equity, and averaging the same is not
 *   remotely the same as deciding the same: one of them wants the hand to end
 *   and the other wants to see a card.
 *
 *   E[HS^2] squares before averaging, which weights the top of the distribution
 *   and pulls the draw away from the made hand. Better, still one number.
 *
 *   Potential-aware abstraction (Ganzfried and Sandholm, AAAI 2014) drops
 *   scalars: bucket a hand by the whole DISTRIBUTION of what it will become,
 *   and cluster those distributions under earth mover's distance. That is the
 *   state of the art and what the strong agents of the era used.
 *
 * Both the naive metric and the good one are implemented here, because the
 * point of this module is to measure the difference rather than assert it.
 *
 * One thing is much easier here than in those papers. They abstract a whole
 * game ahead of time, for boards that have not come and against ranges nobody
 * has seen. Here the board is on the table and both ranges are arguments, so
 * the distribution can be computed exactly instead of sampled: for each hand,
 * its equity against the opponent's ACTUAL range on each of the rivers it could
 * see. Two hands with the same distribution are the same hand for this decision
 * against this opponent, which is a far stronger claim than "similar strength".
 */

import type { HandSet, RiverView } from "./hands";
import { foldValues, showdownValues, terminalScratch } from "./terminal";
import { mulberry32 } from "../rng";

/**
 * Every hand blocks exactly two of the forty eight rivers, being the two cards
 * it is holding, so every hand has the same number of futures and the feature
 * vectors are all the same length.
 */
export const RIVERS_PER_HAND = 46;

/** Marks a river a hand cannot see, before it is filled in with the hand's mean. */
const SENTINEL = -1;

export interface EquityDistributions {
  /** `hands x RIVERS_PER_HAND`, each row sorted ascending. */
  sorted: Float64Array;
  /**
   * `hands x riverCount`, indexed BY RIVER rather than sorted: entry [h][r] is
   * what hand h is worth if card r comes. The two rivers a hand blocks are
   * filled with its own mean, so every row is the same length and comparable.
   *
   * This is the same information `sorted` holds minus the sorting, and the
   * sorting is not free: it throws away WHICH river was good for the hand. Two
   * hands can have identical distributions and want opposite things, if one of
   * them improves on the cards the other one dreads.
   */
  profile: Float64Array;
  /** How many rivers `profile` is indexed over. */
  riverCount: number;
  /** Mean equity per hand, which is E[HS] and the naive baseline. */
  mean: Float64Array;
  /** Hands with weight in the player's range; the rest are never reached. */
  live: Int32Array;
  handCount: number;
}

/**
 * For each hand, its equity against the opponent's range on every river it can
 * still see.
 *
 * Computed with the solver's own linear time showdown sweep rather than a
 * separate equity routine, which is both faster and one less thing that can
 * disagree with the solver. The identity that makes it work:
 *
 *     showdownValues with amount 1 returns (beaten - beating) weight
 *     equity = (beaten + ties/2) / live = 1/2 + (beaten - beating) / (2 live)
 *
 * so one sweep and one fold evaluation give the answer for all 1128 hands at
 * once.
 */
export function equityDistributions(
  hands: HandSet,
  views: readonly RiverView[],
  ownRange: Float64Array,
  opponentRange: Float64Array,
): EquityDistributions {
  const n = hands.count;
  const scratch = terminalScratch();
  const masked = new Float64Array(n);
  const margin = new Float64Array(n);
  const live = new Float64Array(n);

  // Collected per hand, then sorted. Rivers a hand blocks are simply not added,
  // which is why every row ends up the same length.
  const rows = Array.from({ length: n }, () => [] as number[]);
  const profile = new Float64Array(n * views.length).fill(SENTINEL);

  for (let r = 0; r < views.length; r++) {
    const view = views[r]!;
    masked.set(opponentRange);
    for (const blocked of view.blocked) masked[blocked] = 0;

    showdownValues(hands, view, masked, 1, margin, scratch);
    foldValues(hands, masked, 1, live, scratch);

    const dead = new Uint8Array(n);
    for (const blocked of view.blocked) dead[blocked] = 1;

    for (let h = 0; h < n; h++) {
      if (dead[h]) continue;
      const total = live[h]!;
      // A hand facing no live opponent range has no equity to speak of; a half
      // keeps it from being a NaN that poisons a cluster centroid.
      const equity = total > 1e-12 ? 0.5 + margin[h]! / (2 * total) : 0.5;
      rows[h]!.push(equity);
      profile[h * views.length + r] = equity;
    }
  }

  const sorted = new Float64Array(n * RIVERS_PER_HAND);
  const mean = new Float64Array(n);
  const liveHands: number[] = [];

  for (let h = 0; h < n; h++) {
    const row = rows[h]!;
    if (row.length !== RIVERS_PER_HAND) {
      throw new Error(`Hand ${h} saw ${row.length} rivers, expected ${RIVERS_PER_HAND}`);
    }
    row.sort((a, b) => a - b);

    let total = 0;
    for (let i = 0; i < RIVERS_PER_HAND; i++) {
      sorted[h * RIVERS_PER_HAND + i] = row[i]!;
      total += row[i]!;
    }
    mean[h] = total / RIVERS_PER_HAND;
    if (ownRange[h]! > 0) liveHands.push(h);
  }

  // The rivers a hand blocks get its own mean, so the vector stays the same
  // length as everyone else's and the imputed entries pull no hand toward or
  // away from any other.
  for (let h = 0; h < n; h++) {
    for (let r = 0; r < views.length; r++) {
      if (profile[h * views.length + r] === SENTINEL) profile[h * views.length + r] = mean[h]!;
    }
  }

  return {
    sorted,
    profile,
    riverCount: views.length,
    mean,
    live: Int32Array.from(liveHands),
    handCount: n,
  };
}

/**
 * Earth mover's distance between two hands' equity distributions.
 *
 * For two sets of equally weighted samples of the same size, the earth mover's
 * distance is the L1 distance between the SORTED samples, divided by how many
 * there are. That identity is why the rows are sorted once when they are built
 * and never again: the expensive-sounding metric is a subtraction loop.
 */
function l1(
  a: Float64Array,
  aOffset: number,
  b: Float64Array,
  bOffset: number,
  width: number,
): number {
  let total = 0;
  for (let i = 0; i < width; i++) total += Math.abs(a[aOffset + i]! - b[bOffset + i]!);
  return total / width;
}

export interface Clustering {
  /** Hand index to bucket index. Hands outside the range all land in bucket 0. */
  map: Int32Array;
  count: number;
  /** Mean distance from a hand to its own centroid. Lower is a tighter fit. */
  distortion: number;
  /**
   * Hands in the largest bucket.
   *
   * Worth reporting next to distortion because the two disagree. k-means
   * minimises distortion and does not care how lopsided the result is, so it
   * will happily leave one enormous cluster of near-identical hands and spend
   * the rest of its budget splitting hairs at the top. For an abstraction that
   * is a bad trade: the biggest bucket is where the most hands are being forced
   * to play alike, and that is where the exploitability comes from.
   */
  largest: number;
}

/**
 * The naive baseline: sort by average equity and cut into equal groups.
 *
 * This is E[HS] bucketing, kept because a measurement of the good method needs
 * something to be better than. Equal-sized groups rather than equal-width bands
 * so that no bucket ends up empty and the comparison is on the metric rather
 * than on how the cut was made.
 */
export function bucketByMeanEquity(
  distributions: EquityDistributions,
  buckets: number,
): Clustering {
  const { mean, live, handCount } = distributions;
  return bucketByScalar(mean, live, buckets, handCount);
}

/**
 * Potential-aware clustering: k-means over the equity distributions, under
 * earth mover's distance.
 *
 * Lloyd's algorithm with k-means++ seeding. The centroid update takes the
 * component-wise mean rather than the L1 median that earth mover's distance
 * would strictly call for; that is the usual practical compromise and it is
 * what the abstraction literature does too. It costs a little tightness and
 * saves a great deal of arithmetic.
 *
 * Seeded, so the same spot produces the same abstraction every run. An
 * abstraction that shifted between runs would make every measurement against it
 * unreproducible.
 */
export function bucketByDistribution(
  distributions: EquityDistributions,
  buckets: number,
  seed = 20260831,
  rounds = 20,
): Clustering {
  return bestOf(distributions.sorted, RIVERS_PER_HAND, distributions, buckets, seed, rounds);
}

/**
 * k-means lands in a local optimum, and which one depends entirely on where it
 * started. Left at one attempt the results come out non-monotone in K, with
 * sixteen buckets beating thirty two, which is not a fact about abstraction but
 * a fact about the seeding. Restarting and keeping the tightest fit is the
 * standard fix and it is what makes a sweep across K mean anything.
 */
const RESTARTS = 5;

function bestOf(
  features: Float64Array,
  width: number,
  distributions: EquityDistributions,
  buckets: number,
  seed: number,
  rounds: number,
): Clustering {
  let best: Clustering | null = null;
  for (let attempt = 0; attempt < RESTARTS; attempt++) {
    const candidate = kMeans(features, width, distributions, buckets, seed + attempt * 7919, rounds);
    if (!best || candidate.distortion < best.distortion) best = candidate;
  }
  return best!;
}

/**
 * Clustering on the river-indexed profile: the same numbers, not sorted.
 *
 * The literature sorts, and for the problem the literature is solving that is
 * right. Abstracting a whole game ahead of time, you do not know which board
 * cards will matter, so the SHAPE of the distribution is the most that can be
 * said about a hand's future.
 *
 * Here the board is already on the table and both ranges are arguments, which
 * means WHICH river helped a hand is available, and it is real information.
 * Two hands can hold identical equity distributions and want opposite cards:
 * one improves on exactly the rivers the other dreads. Sorting cannot tell them
 * apart, and on the turn that difference is betting versus checking.
 *
 * So sorting is a lossy step this particular problem does not have to take.
 * Whether skipping it helps is a measurement, not an argument, and
 * `scripts/bench-turn.ts` takes it.
 */
export function bucketByRiverProfile(
  distributions: EquityDistributions,
  buckets: number,
  seed = 20260831,
  rounds = 20,
): Clustering {
  return bestOf(
    distributions.profile,
    distributions.riverCount,
    distributions,
    buckets,
    seed,
    rounds,
  );
}

/**
 * Lloyd's algorithm with k-means++ seeding, over whichever features it is
 * handed, under L1.
 *
 * On the sorted distributions, L1 IS earth mover's distance: for two equally
 * weighted samples of the same size, the cost of transporting one into the
 * other is the L1 distance between them once sorted. That identity is why the
 * rows are sorted when they are built and never again, and why the
 * expensive-sounding metric is a subtraction loop.
 *
 * On the river-indexed profile it is plain L1, which is the right thing there:
 * the coordinates already line up across hands, so there is nothing to
 * transport.
 *
 * The centroid update takes the component-wise mean rather than the L1 median
 * that would strictly match the metric. That is the usual practical compromise,
 * and what the abstraction literature does too; it costs a little tightness and
 * saves a great deal of arithmetic.
 *
 * Seeded, so the same spot produces the same abstraction every run. An
 * abstraction that shifted between runs would make every measurement against it
 * unreproducible.
 */
function kMeans(
  features: Float64Array,
  width: number,
  distributions: EquityDistributions,
  buckets: number,
  seed: number,
  rounds: number,
): Clustering {
  const { live, handCount } = distributions;
  const map = new Int32Array(handCount);
  if (live.length === 0) return { map, count: 1, distortion: 0, largest: 0 };

  const count = Math.min(buckets, live.length);
  const rng = mulberry32(seed);
  const centroids = new Float64Array(count * width);

  // k-means++: first centre at random, then each next chosen with probability
  // proportional to its distance from the centres so far. Plain random seeding
  // on this data reliably wastes several clusters on the flat middle.
  const nearest = new Float64Array(live.length).fill(Infinity);
  let chosen = live[Math.floor(rng() * live.length)]!;
  centroids.set(features.subarray(chosen * width, (chosen + 1) * width), 0);

  for (let c = 1; c < count; c++) {
    let total = 0;
    for (let i = 0; i < live.length; i++) {
      const distance = l1(features, live[i]! * width, centroids, (c - 1) * width, width);
      if (distance < nearest[i]!) nearest[i] = distance;
      total += nearest[i]!;
    }

    let target = rng() * total;
    let pick = live.length - 1;
    for (let i = 0; i < live.length; i++) {
      target -= nearest[i]!;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    chosen = live[pick]!;
    centroids.set(features.subarray(chosen * width, (chosen + 1) * width), c * width);
  }

  const sums = new Float64Array(count * width);
  const sizes = new Int32Array(count);
  let distortion = 0;

  for (let round = 0; round < rounds; round++) {
    sums.fill(0);
    sizes.fill(0);
    distortion = 0;
    let moved = 0;

    for (const hand of live) {
      const offset = hand * width;
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < count; c++) {
        const distance = l1(features, offset, centroids, c * width, width);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
      if (map[hand] !== best) moved++;
      map[hand] = best;
      distortion += bestDistance;

      const into = best * width;
      for (let i = 0; i < width; i++) sums[into + i] = sums[into + i]! + features[offset + i]!;
      sizes[best] = sizes[best]! + 1;
    }

    for (let c = 0; c < count; c++) {
      if (sizes[c] === 0) continue;
      const at = c * width;
      for (let i = 0; i < width; i++) centroids[at + i] = sums[at + i]! / sizes[c]!;
    }

    // Assignments settled, so further rounds would only move centroids to where
    // they already are.
    if (moved === 0) break;
  }

  let largest = 0;
  for (let c = 0; c < count; c++) largest = Math.max(largest, sizes[c]!);
  return { map, count, distortion: distortion / live.length, largest };
}

/**
 * How much hands forced to share a strategy disagree about what they block.
 *
 * This is the argument against bucketing, made into a number. Card removal is
 * the one thing an abstraction cannot represent: two hands in the same bucket
 * play identically by construction, so if one of them blocks a third of the
 * opponent's range and the other blocks a tenth, the solver has no way to say
 * so. Measured as the spread in live opponent weight inside a bucket, relative
 * to the average across all hands, so 0.05 reads as "hands in the same bucket
 * differ by about five percent in how much range they block".
 *
 * A diagnostic, not a target. A good abstraction can score badly here, which is
 * exactly the tension worth being able to see.
 */
export function blockerSpread(
  hands: HandSet,
  opponentRange: Float64Array,
  clustering: Clustering,
): number {
  const scratch = terminalScratch();
  const live = new Float64Array(hands.count);
  foldValues(hands, opponentRange, 1, live, scratch);

  const members = new Map<number, number[]>();
  let overall = 0;
  let counted = 0;
  for (let h = 0; h < hands.count; h++) {
    if (opponentRange[h] === 0 && live[h] === 0) continue;
    const bucket = clustering.map[h]!;
    const list = members.get(bucket);
    if (list) list.push(h);
    else members.set(bucket, [h]);
    overall += live[h]!;
    counted++;
  }
  if (counted === 0 || overall === 0) return 0;
  const average = overall / counted;

  let weighted = 0;
  let total = 0;
  for (const group of members.values()) {
    if (group.length < 2) continue;
    let mean = 0;
    for (const hand of group) mean += live[hand]!;
    mean /= group.length;

    let variance = 0;
    for (const hand of group) variance += (live[hand]! - mean) ** 2;
    weighted += group.length * Math.sqrt(variance / group.length);
    total += group.length;
  }

  return total === 0 ? 0 : weighted / total / average;
}

// ---------------------------------------------------------------------------
// River abstraction
//
// Separate from the turn's, because on the river a hand has no future left. Its
// whole story against a given range is one number, so the distribution the turn
// needed collapses to a scalar and clustering collapses to sorting.
//
// This exists to test a claim rather than to be used. The argument against
// bucketing the river is that hands sharing a bucket share their card removal,
// and blockers are most of what decides a river bluff. That is an argument, and
// `scripts/bench-turn.ts` turns it into a measurement.
// ---------------------------------------------------------------------------

/** Equity of every hand against a range, on a completed board. */
export function riverEquities(
  hands: HandSet,
  view: RiverView,
  opponentRange: Float64Array,
): Float64Array {
  const scratch = terminalScratch();
  const masked = new Float64Array(hands.count);
  const margin = new Float64Array(hands.count);
  const live = new Float64Array(hands.count);

  masked.set(opponentRange);
  for (const blocked of view.blocked) masked[blocked] = 0;

  showdownValues(hands, view, masked, 1, margin, scratch);
  foldValues(hands, masked, 1, live, scratch);

  const dead = new Uint8Array(hands.count);
  for (const blocked of view.blocked) dead[blocked] = 1;

  const out = new Float64Array(hands.count);
  for (let h = 0; h < hands.count; h++) {
    // A hand holding the river cannot be held, and its sentinel rank of -1
    // would otherwise come out as an equity of zero and drag it into the
    // bottom bucket. Nothing reads these, but a meaningless number that looks
    // like a meaningful one is worth not writing.
    if (dead[h]) {
      out[h] = 0.5;
      continue;
    }
    const total = live[h]!;
    out[h] = total > 1e-12 ? 0.5 + margin[h]! / (2 * total) : 0.5;
  }
  return out;
}

/**
 * Equal-frequency buckets over one number per hand.
 *
 * Equal sized groups rather than equal width bands, so that no bucket comes out
 * empty and the comparison is about the metric rather than about how the cut
 * was made.
 */
export function bucketByScalar(
  values: Float64Array,
  live: Int32Array,
  buckets: number,
  handCount: number,
): Clustering {
  const map = new Int32Array(handCount);
  if (live.length === 0) return { map, count: 1, distortion: 0, largest: 0 };

  const order = Array.from(live).sort((x, y) => values[x]! - values[y]!);
  const count = Math.min(buckets, order.length);
  const centres = new Float64Array(count);
  const sizes = new Int32Array(count);

  for (let i = 0; i < order.length; i++) {
    const bucket = Math.min(count - 1, Math.floor((i * count) / order.length));
    map[order[i]!] = bucket;
    centres[bucket] = centres[bucket]! + values[order[i]!]!;
    sizes[bucket] = sizes[bucket]! + 1;
  }

  for (let b = 0; b < count; b++) if (sizes[b]! > 0) centres[b] = centres[b]! / sizes[b]!;

  let distortion = 0;
  for (const hand of live) distortion += Math.abs(values[hand]! - centres[map[hand]!]!);
  let largest = 0;
  for (let b = 0; b < count; b++) largest = Math.max(largest, sizes[b]!);
  return { map, count, distortion: distortion / live.length, largest };
}

/** One clustering per river card, for a player facing a given range. */
export function bucketEveryRiver(
  hands: HandSet,
  views: readonly RiverView[],
  ownRange: Float64Array,
  opponentRange: Float64Array,
  buckets: number,
): Clustering[] {
  const liveHands: number[] = [];
  for (let h = 0; h < hands.count; h++) if (ownRange[h]! > 0) liveHands.push(h);
  const live = Int32Array.from(liveHands);

  return views.map((view) =>
    bucketByScalar(riverEquities(hands, view, opponentRange), live, buckets, hands.count),
  );
}
