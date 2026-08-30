/** Seats at a six handed table, in the order they act preflop. */

export const POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_NAMES: Record<Position, string> = {
  UTG: "Under the gun",
  HJ: "Hijack",
  CO: "Cutoff",
  BTN: "Button",
  SB: "Small blind",
  BB: "Big blind",
};

/**
 * Seats that can be first into the pot.
 *
 * The big blind is absent on purpose: if everyone folds to the big blind there
 * is no decision to make, the hand is already won. Opening ranges therefore
 * only exist for five of the six seats.
 */
export const RFI_POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB"] as const;
export type RfiPosition = (typeof RFI_POSITIONS)[number];

/** Stack depths, in big blinds, that charts are written for. */
export const STACK_DEPTHS = [20, 40, 100, 200] as const;
export type StackDepth = (typeof STACK_DEPTHS)[number];
