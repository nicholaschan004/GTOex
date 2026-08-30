/**
 * Raise-first-in ranges: what to open when everyone before you has folded.
 *
 * BASELINE DATA, NOT SOLVER OUTPUT. These are conventional six handed 100bb
 * opening ranges, written to be close to consensus and internally consistent
 * rather than copied from any one published chart set. They are here so the
 * trainer works end to end; the intent is to replace them with computed output
 * and to be able to diff the two. Nothing in the app should describe them as
 * solved, and the UI says where they come from.
 *
 * Two properties the tests enforce, because both catch typos that would
 * otherwise be invisible while playing:
 *   - each range sits in the percentage band its seat is known to open
 *   - the ranges nest, UTG within HJ within CO within BTN, since a hand worth
 *     opening from the hardest seat is worth opening from an easier one
 *
 * The small blind deliberately does NOT nest inside the button. It acts with
 * only one player left behind and out of position for the rest of the hand,
 * which is a different problem, not a wider version of the same one.
 */

import type { RfiPosition } from "../positions";

export const RFI_100BB: Record<RfiPosition, string> = {
  UTG: "22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, AJo+, KQo",

  HJ: "22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, ATo+, KJo+",

  CO: "22+, A2s+, K2s+, Q8s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A9o+, KTo+, QJo",

  BTN:
    "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, 43s, " +
    "A2o+, K7o+, Q9o+, J9o+, T9o",

  SB:
    "22+, A2s+, K2s+, Q2s+, J5s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, " +
    "A2o+, K8o+, Q9o+, JTo",
};

/**
 * The band each seat's opening frequency should land in, as a percent of all
 * starting hands. Wide enough to allow reasonable disagreement, tight enough
 * that a dropped or doubled token fails the suite.
 */
export const RFI_EXPECTED_BANDS: Record<RfiPosition, [number, number]> = {
  UTG: [14, 19],
  HJ: [18, 23],
  CO: [24, 30],
  BTN: [40, 50],
  SB: [38, 48],
};
