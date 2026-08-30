/**
 * Raise-first-in ranges: what to open when everyone before you has folded.
 *
 * BASELINE DATA, NOT SOLVER OUTPUT. These are conventional six handed opening
 * ranges, written to be close to consensus and internally consistent rather
 * than copied from any one published chart set. They are here so the trainer
 * works end to end; the intent is to replace them with computed output and to
 * be able to diff the two. Nothing in the app should describe them as solved,
 * and the UI says where they come from.
 *
 * Depth changes what a hand is worth, which is why there are four sets:
 *   - at 20bb there is no room to win a big pot after the flop, so small pairs
 *     and suited connectors lose the implied odds that justify them, and the
 *     ranges shift toward raw high card strength
 *   - at 200bb the reverse holds. Suited and connected hands gain, weak offsuit
 *     hands lose, and everyone opens wider
 *
 * Three properties the tests enforce, because each catches typos that would
 * otherwise be invisible while playing:
 *   - each range sits in the percentage band its seat is known to open
 *   - within a depth the ranges nest, UTG inside HJ inside CO inside BTN, since
 *     a hand worth opening from the hardest seat is worth opening from an
 *     easier one
 *   - within a seat, opening frequency rises with depth
 *
 * The small blind deliberately does NOT nest inside the button. It acts with
 * only one player left behind and out of position for the rest of the hand,
 * which is a different problem, not a wider version of the same one.
 */

import type { RfiPosition, StackDepth } from "../positions";

export const RFI_BY_DEPTH: Record<StackDepth, Record<RfiPosition, string>> = {
  20: {
    UTG: "44+, A2s+, K9s+, Q9s+, JTs, T9s, ATo+, KQo",
    HJ: "33+, A2s+, K8s+, Q9s+, JTs, T9s, 98s, ATo+, KJo+",
    CO: "22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, A8o+, KTo+, QJo",
    BTN:
      "22+, A2s+, K2s+, Q6s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, " +
      "A2o+, K8o+, Q9o+, JTo, T9o",
    SB:
      "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, " +
      "A2o+, K9o+, QTo+, JTo",
  },

  40: {
    UTG: "33+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, AJo+, KQo",
    HJ: "22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, ATo+, KJo+",
    CO: "22+, A2s+, K3s+, Q8s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, A9o+, KTo+, QJo",
    BTN:
      "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, " +
      "A2o+, K7o+, Q9o+, J9o+, T9o",
    SB:
      "22+, A2s+, K2s+, Q4s+, J5s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, " +
      "A2o+, K8o+, Q9o+, JTo",
  },

  100: {
    UTG: "22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, AJo+, KQo",
    HJ: "22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, ATo+, KJo+",
    CO: "22+, A2s+, K2s+, Q8s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A9o+, KTo+, QJo",
    BTN:
      "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, 43s, " +
      "A2o+, K7o+, Q9o+, J9o+, T9o",
    SB:
      "22+, A2s+, K2s+, Q2s+, J5s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, " +
      "A2o+, K8o+, Q9o+, JTo",
  },

  200: {
    UTG: "22+, A2s+, K8s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, AJo+, KQo",
    HJ: "22+, A2s+, K7s+, Q8s+, J8s+, T7s+, 97s+, 86s+, 76s, 65s, 54s, ATo+, KJo+",
    CO:
      "22+, A2s+, K2s+, Q6s+, J6s+, T6s+, 95s+, 85s+, 75s+, 64s+, 54s, " +
      "A9o+, KTo+, QJo, JTo",
    BTN:
      "22+, A2s+, K2s+, Q2s+, J4s+, T5s+, 94s+, 84s+, 74s+, 63s+, 53s+, 43s, " +
      "A2o+, K7o+, Q9o+, J8o+, T8o+, 98o",
    SB:
      "22+, A2s+, K2s+, Q2s+, J3s+, T5s+, 95s+, 84s+, 74s+, 64s+, 53s+, " +
      "A2o+, K7o+, Q9o+, J9o+, T9o",
  },
};

/** Kept for the many call sites that only care about the reference depth. */
export const RFI_100BB = RFI_BY_DEPTH[100];

/**
 * The band each seat's opening frequency should land in, as a percent of all
 * starting hands. Wide enough to allow reasonable disagreement, tight enough
 * that a dropped or doubled token fails the suite.
 */
export const RFI_EXPECTED_BANDS: Record<RfiPosition, [number, number]> = {
  UTG: [14, 21],
  HJ: [16, 24],
  CO: [22, 33],
  BTN: [37, 53],
  SB: [35, 50],
};
