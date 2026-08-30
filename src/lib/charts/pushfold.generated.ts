/**
 * GENERATED FILE. Do not edit by hand.
 *
 *   npx vite-node scripts/build-equity-matrix.ts
 *   npx vite-node scripts/solve-pushfold.ts
 *
 * Heads-up push/fold equilibrium, solved by fictitious play over a sampled
 * 169x169 all-in equity matrix (12000 trials per pair, seed 20260830).
 *
 * Unlike every other chart in this project, nothing here was chosen by a
 * person. See src/lib/pushfold.ts for the model, and pushfold.test.ts, which
 * re-derives the exploitability of these exact ranges rather than trusting
 * that whatever produced them was working.
 */

export interface PushFoldChart {
  /** Small blind: move all in with these, fold everything else. */
  shove: string;
  /** Big blind: call the all in with these. */
  call: string;
  shovePercent: number;
  callPercent: number;
}

export const PUSHFOLD_STACKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
export type PushFoldStack = (typeof PUSHFOLD_STACKS)[number];

export const PUSHFOLD: Record<PushFoldStack, PushFoldChart> = {
  2: {
    shove: "22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 43s, A2o+, K2o+, Q2o+, J2o+, T2o+, 92o+, 83o+, 74o+, 64o+, 54o",
    call: "22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q2o+, J2o+, T2o+, 92o+, 82o+, 72o+, 62o+, 52o+, 42o+, 32o",
    shovePercent: 90.35,
    callPercent: 100.00,
  },
  3: {
    shove: "22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 84s+, 74s+, 64s+, 54s, A2o+, K2o+, Q2o+, J2o+, T2o+, 95o+, 85o+, 76o",
    call: "22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q2o+, J2o+, T2o+, 92o+, 84o+, 74o+, 64o+, 53o+, 43o",
    shovePercent: 78.58,
    callPercent: 91.86,
  },
  4: {
    shove: "22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 93s+, 84s+, 74s+, 64s+, 54s, A2o+, K2o+, Q2o+, J2o+, T5o+, 96o+, 86o+, 76o",
    call: "22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 93s+, 84s+, 74s+, 64s+, 53s+, A2o+, K2o+, Q2o+, J2o+, T5o+, 96o+, 86o+, 76o",
    shovePercent: 73.76,
    callPercent: 74.06,
  },
  5: {
    shove: "22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 94s+, 84s+, 74s+, 64s+, 53s+, 43s, A2o+, K2o+, Q2o+, J3o+, T6o+, 97o+, 86o+, 76o",
    call: "22+, A2s+, K2s+, Q2s+, J2s+, T4s+, 95s+, 86s+, 76s, A2o+, K2o+, Q2o+, J5o+, T7o+, 97o+",
    shovePercent: 71.34,
    callPercent: 62.29,
  },
  6: {
    shove: "22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 95s+, 84s+, 74s+, 63s+, 53s+, 43s, A2o+, K2o+, Q2o+, J5o+, T7o+, 97o+, 86o+, 76o",
    call: "22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 97s+, 87s, A2o+, K2o+, Q4o+, J7o+, T8o+, 98o",
    shovePercent: 68.63,
    callPercent: 54.45,
  },
  7: {
    shove: "22+, A2s+, K2s+, Q2s+, J2s+, T3s+, 95s+, 84s+, 74s+, 63s+, 53s+, 43s, A2o+, K2o+, Q2o+, J7o+, T7o+, 97o+, 86o+, 76o",
    call: "22+, A2s+, K2s+, Q2s+, J6s+, T7s+, 97s+, A2o+, K2o+, Q6o+, J8o+, T9o",
    shovePercent: 66.52,
    callPercent: 48.72,
  },
  8: {
    shove: "22+, A2s+, K2s+, Q2s+, J2s+, T4s+, 95s+, 85s+, 74s+, 64s+, 53s+, A2o+, K2o+, Q5o+, J7o+, T7o+, 97o+, 87o, 76o",
    call: "22+, A2s+, K2s+, Q4s+, J7s+, T8s+, 98s, A2o+, K2o+, Q7o+, J9o+, T9o",
    shovePercent: 61.69,
    callPercent: 45.40,
  },
  9: {
    shove: "22+, A2s+, K2s+, Q2s+, J3s+, T4s+, 95s+, 85s+, 74s+, 64s+, 53s+, A2o+, K2o+, Q5o+, J8o+, T7o+, 97o+, 87o, 76o",
    call: "22+, A2s+, K2s+, Q6s+, J8s+, T8s+, A2o+, K4o+, Q8o+, J9o+",
    shovePercent: 60.48,
    callPercent: 40.57,
  },
  10: {
    shove: "22+, A2s+, K2s+, Q2s+, J3s+, T4s+, 95s+, 85s+, 74s+, 64s+, 53s+, A2o+, K2o+, Q7o+, J8o+, T7o+, 97o+, 87o, 76o",
    call: "22+, A2s+, K2s+, Q6s+, J8s+, T9s, A2o+, K5o+, Q9o+, JTo",
    shovePercent: 58.67,
    callPercent: 37.56,
  },
  11: {
    shove: "22+, A2s+, K2s+, Q2s+, J4s+, T5s+, 95s+, 85s+, 74s+, 64s+, 53s+, A2o+, K2o+, Q8o+, J8o+, T8o+, 98o, 87o",
    call: "22+, A2s+, K3s+, Q8s+, J9s+, T9s, A2o+, K6o+, Q9o+, JTo",
    shovePercent: 54.45,
    callPercent: 35.44,
  },
  12: {
    shove: "22+, A2s+, K2s+, Q2s+, J4s+, T5s+, 95s+, 85s+, 74s+, 64s+, 53s+, A2o+, K3o+, Q8o+, J8o+, T8o+, 98o, 87o",
    call: "22+, A2s+, K4s+, Q8s+, J9s+, A2o+, K7o+, QTo+, JTo",
    shovePercent: 53.54,
    callPercent: 33.03,
  },
  13: {
    shove: "22+, A2s+, K2s+, Q3s+, J4s+, T6s+, 95s+, 85s+, 75s+, 64s+, 54s, A2o+, K4o+, Q8o+, J8o+, T8o+, 98o, 87o",
    call: "22+, A2s+, K5s+, Q9s+, J9s+, A2o+, K8o+, QTo+",
    shovePercent: 51.43,
    callPercent: 30.62,
  },
  14: {
    shove: "22+, A2s+, K2s+, Q4s+, J5s+, T6s+, 95s+, 85s+, 75s+, 64s+, 54s, A2o+, K5o+, Q9o+, J9o+, T8o+, 98o, 87o",
    call: "22+, A2s+, K6s+, Q9s+, JTs, A2o+, K9o+, QTo+",
    shovePercent: 48.11,
    callPercent: 29.11,
  },
  15: {
    shove: "22+, A2s+, K2s+, Q4s+, J5s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K6o+, Q9o+, J9o+, T8o+, 98o, 87o",
    call: "22+, A2s+, K7s+, Q9s+, JTs, A2o+, K9o+, QTo+",
    shovePercent: 46.91,
    callPercent: 28.81,
  },
  16: {
    shove: "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T8o+, 98o, 87o",
    call: "33+, A2s+, K8s+, Q9s+, JTs, A3o+, K9o+, QJo",
    shovePercent: 44.80,
    callPercent: 26.24,
  },
  17: {
    shove: "22+, A2s+, K2s+, Q5s+, J6s+, T6s+, 96s+, 85s+, 75s+, 65s, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o",
    call: "33+, A2s+, K8s+, QTs+, JTs, A4o+, K9o+, QJo",
    shovePercent: 42.38,
    callPercent: 25.04,
  },
  18: {
    shove: "22+, A2s+, K2s+, Q5s+, J6s+, T6s+, 96s+, 85s+, 75s+, 65s, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o",
    call: "33+, A2s+, K9s+, QTs+, JTs, A4o+, KTo+, QJo",
    shovePercent: 42.38,
    callPercent: 23.83,
  },
  19: {
    shove: "22+, A2s+, K2s+, Q5s+, J6s+, T6s+, 96s+, 85s+, 75s+, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o, 98o",
    call: "33+, A2s+, K9s+, QTs+, A5o+, KTo+, QJo",
    shovePercent: 41.48,
    callPercent: 22.62,
  },
  20: {
    shove: "22+, A2s+, K3s+, Q5s+, J7s+, T6s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o, 98o",
    call: "33+, A2s+, K9s+, QTs+, A5o+, KTo+",
    shovePercent: 40.57,
    callPercent: 21.72,
  },
};
