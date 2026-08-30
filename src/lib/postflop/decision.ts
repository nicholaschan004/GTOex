/**
 * One solved decision, in the shape the drill screen consumes.
 *
 * Both postflop modes end up here, by different routes. A river spot is small
 * enough to solve in the browser while you are still reading your cards, so it
 * is solved on demand. A turn spot takes eight seconds and twenty megabytes, so
 * it is solved once at build time and shipped as data, exactly the way the
 * push/fold charts already are. The drill cannot tell which it is holding, and
 * that is the point of this file.
 */

import { solve, type Solution } from "../solver/cfr";
import { evaluateDecision } from "../solver/evaluate";
import type { BuiltSpot } from "./spots";
import type { HandSet } from "../solver/hands";
import type { ActionKind } from "../solver/tree";
import { handClassOf } from "../cards";
import { intToCard } from "../equity";
import { CLASS_COUNT, classIndexOf } from "../combos";

export interface ActionOption {
  kind: ActionKind;
  /** How it reads on a button: "Check", "Bet 20", "Raise to 60". */
  label: string;
  /** Chips the hero has in once the action is taken. */
  to: number;
}

export interface SolvedDecision {
  spotId: string;
  actions: ActionOption[];
  /** Hand indices, into the spot's hand set, that can actually be here. */
  hands: Int32Array;
  /** How often each hand arrives here, for dealing in the right proportions. */
  weight: Float64Array;
  /** `actions x hands`, the solved frequencies. Each hand's column sums to one. */
  frequency: Float64Array;
  /** `actions x hands`, expected value in chips. */
  ev: Float64Array;
  /** How far from equilibrium the solve got, as a percentage of the pot. */
  exploitabilityPercent: number;
}

/**
 * A hand has to be reachable by more than rounding to be worth drilling.
 *
 * "You check, and he bets" is not a question about a hand you would never have
 * checked. Dealing one anyway would ask about a decision that does not exist.
 */
const REACHABLE = 1e-4;

export function describeActions(spot: BuiltSpot): ActionOption[] {
  const { actions } = spot.node;
  // Whatever it costs to stay in without raising is the hero's current stake,
  // which is what turns a total into a bet size.
  const passive = actions.find((action) => action.kind === "check" || action.kind === "fold");
  const mine = passive?.to ?? 0;

  return actions.map((action) => {
    const added = Math.round(action.to - mine);
    switch (action.kind) {
      case "check":
        return { kind: action.kind, label: "Check", to: action.to };
      case "fold":
        return { kind: action.kind, label: "Fold", to: action.to };
      case "call":
        return { kind: action.kind, label: `Call ${added}`, to: action.to };
      case "bet":
        return { kind: action.kind, label: `Bet ${added}`, to: action.to };
      case "raise":
        return { kind: action.kind, label: `Raise to ${Math.round(action.to)}`, to: action.to };
    }
  });
}

export interface SolveDecisionOptions {
  iterations?: number;
  onProgress?: (iteration: number) => void;
}

/** Solve a spot and pull out the one decision the drill asks about. */
export function solveDecision(spot: BuiltSpot, options: SolveDecisionOptions = {}): SolvedDecision {
  const solution: Solution = solve(spot.tree, spot.hands, spot.ranges, {
    iterations: options.iterations ?? 300,
    views: spot.views,
    onProgress: options.onProgress,
  });

  const average = spot.tree.playerNodes.map((node) => solution.strategyAt(node));
  const decision = evaluateDecision(
    spot.tree,
    spot.hands,
    spot.ranges,
    average,
    spot.node,
    spot.views,
  );

  const n = spot.hands.count;
  const actions = spot.node.actions.length;
  const strategy = solution.strategyAt(spot.node);

  const kept: number[] = [];
  for (let h = 0; h < n; h++) if (decision.reachable[h]! > REACHABLE) kept.push(h);

  const hands = Int32Array.from(kept);
  const weight = new Float64Array(kept.length);
  const frequency = new Float64Array(actions * kept.length);
  const ev = new Float64Array(actions * kept.length);

  for (let i = 0; i < kept.length; i++) {
    const hand = kept[i]!;
    weight[i] = decision.reachable[hand]!;
    for (let a = 0; a < actions; a++) {
      frequency[a * kept.length + i] = strategy[a * n + hand]!;
      ev[a * kept.length + i] = decision.values[a * n + hand]!;
    }
  }

  return {
    spotId: spot.definition.id,
    actions: describeActions(spot),
    hands,
    weight,
    frequency,
    ev,
    exploitabilityPercent: solution.exploitabilityPercent,
  };
}

/** Deal one of the hero's hands, in the proportion it actually arrives here. */
export function dealFrom(decision: SolvedDecision, rng: () => number = Math.random): number {
  let total = 0;
  for (const w of decision.weight) total += w;
  if (total <= 0) throw new Error(`${decision.spotId} has no hands that reach the decision`);

  let target = rng() * total;
  for (let i = 0; i < decision.weight.length; i++) {
    target -= decision.weight[i]!;
    if (target <= 0) return i;
  }
  return decision.weight.length - 1;
}

/**
 * What an action costs against the best one for that hand, in chips.
 *
 * Zero for anything tied for best, and never negative. This is the whole reason
 * the drill stores expected values and not just frequencies: postflop the same
 * hand correctly bets some of the time and checks the rest, so "wrong" is the
 * wrong verdict and "that costs you 0.3 chips" is the right one.
 */
export function costOf(decision: SolvedDecision, action: number, index: number): number {
  const count = decision.hands.length;
  let best = -Infinity;
  for (let a = 0; a < decision.actions.length; a++) {
    const value = decision.ev[a * count + index]!;
    if (value > best) best = value;
  }
  return Math.max(0, best - decision.ev[action * count + index]!);
}

// ---------------------------------------------------------------------------
// Packing, for the spots that are solved at build time
// ---------------------------------------------------------------------------

export interface PackedDecision {
  spotId: string;
  actions: ActionOption[];
  hands: number[];
  /** Base64 of one byte per hand. */
  weight: string;
  /** Base64 of one byte per action per hand. */
  frequency: string;
  /** Base64 of two little-endian bytes per action per hand. */
  ev: string;
  evMin: number;
  evMax: number;
  exploitabilityPercent: number;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Frequencies quantise to a byte and expected values to two.
 *
 * A frequency is a probability and a 255th of one is far finer than anyone
 * drilling can tell. Expected values are chips and the number that matters is
 * the difference between two of them, which can be small, so they get sixteen
 * bits scaled to the range this spot actually spans. One byte there would put
 * the quantisation step at about a percent of the pot, which is the same size
 * as the thing being measured.
 */
export function packDecision(decision: SolvedDecision): PackedDecision {
  const count = decision.hands.length;
  const total = decision.actions.length;

  let maxWeight = 0;
  for (const w of decision.weight) maxWeight = Math.max(maxWeight, w);
  const weight = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    weight[i] = Math.round((decision.weight[i]! / (maxWeight || 1)) * 255);
  }

  const frequency = new Uint8Array(total * count);
  for (let i = 0; i < frequency.length; i++) {
    frequency[i] = Math.round(Math.min(1, Math.max(0, decision.frequency[i]!)) * 255);
  }

  let evMin = Infinity;
  let evMax = -Infinity;
  for (const value of decision.ev) {
    evMin = Math.min(evMin, value);
    evMax = Math.max(evMax, value);
  }
  const span = evMax - evMin || 1;

  const ev = new Uint8Array(total * count * 2);
  const view = new DataView(ev.buffer);
  for (let i = 0; i < total * count; i++) {
    view.setUint16(i * 2, Math.round(((decision.ev[i]! - evMin) / span) * 65535), true);
  }

  return {
    spotId: decision.spotId,
    actions: decision.actions,
    hands: [...decision.hands],
    weight: toBase64(weight),
    frequency: toBase64(frequency),
    ev: toBase64(ev),
    evMin,
    evMax,
    exploitabilityPercent: decision.exploitabilityPercent,
  };
}

export function unpackDecision(packed: PackedDecision): SolvedDecision {
  const count = packed.hands.length;
  const total = packed.actions.length;

  const weightBytes = fromBase64(packed.weight);
  const weight = new Float64Array(count);
  for (let i = 0; i < count; i++) weight[i] = weightBytes[i]! / 255;

  const frequencyBytes = fromBase64(packed.frequency);
  const frequency = new Float64Array(total * count);
  for (let i = 0; i < frequency.length; i++) frequency[i] = frequencyBytes[i]! / 255;

  const evBytes = fromBase64(packed.ev);
  const view = new DataView(evBytes.buffer, evBytes.byteOffset, evBytes.byteLength);
  const span = packed.evMax - packed.evMin || 1;
  const ev = new Float64Array(total * count);
  for (let i = 0; i < ev.length; i++) {
    ev[i] = packed.evMin + (view.getUint16(i * 2, true) / 65535) * span;
  }

  return {
    spotId: packed.spotId,
    actions: packed.actions,
    hands: Int32Array.from(packed.hands),
    weight,
    frequency,
    ev,
    exploitabilityPercent: packed.exploitabilityPercent,
  };
}

// ---------------------------------------------------------------------------
// Displaying it
// ---------------------------------------------------------------------------

/**
 * Collapse a per-combination strategy onto the 169 class grid.
 *
 * The grid is how anyone reads a poker range, and it has 169 cells while a
 * postflop strategy has up to 1128 entries. So the combinations of a class are
 * averaged, weighted by how often each one is actually here.
 *
 * This is lossy and worth being honest about: on a two-tone board the two
 * combinations of AKs play very differently, one having a flush draw and the
 * other not, and the cell shows their average. It is the standard way solvers
 * summarise a strategy and it is a summary, not the strategy.
 */
export function aggregateToClasses(
  decision: SolvedDecision,
  hands: HandSet,
): { frequency: Float64Array; present: boolean[] } {
  const actions = decision.actions.length;
  const count = decision.hands.length;
  const frequency = new Float64Array(actions * CLASS_COUNT);
  const mass = new Float64Array(CLASS_COUNT);

  for (let i = 0; i < count; i++) {
    const hand = decision.hands[i]!;
    const klass = classIndexOf(
      handClassOf(intToCard(hands.cardA[hand]!), intToCard(hands.cardB[hand]!)),
    );
    const weight = decision.weight[i]!;
    if (weight <= 0) continue;

    mass[klass] = mass[klass]! + weight;
    for (let a = 0; a < actions; a++) {
      frequency[a * CLASS_COUNT + klass] =
        frequency[a * CLASS_COUNT + klass]! + weight * decision.frequency[a * count + i]!;
    }
  }

  const present: boolean[] = [];
  for (let k = 0; k < CLASS_COUNT; k++) {
    present.push(mass[k]! > 0);
    if (mass[k]! <= 0) continue;
    for (let a = 0; a < actions; a++) {
      frequency[a * CLASS_COUNT + k] = frequency[a * CLASS_COUNT + k]! / mass[k]!;
    }
  }

  return { frequency, present };
}

/**
 * Whether an answer counts as right.
 *
 * Postflop there is no such thing as the correct action, only actions that cost
 * more or less, so a threshold has to be picked and stated rather than pretended
 * away. One percent of the pot is roughly where solver output stops being
 * meaningful anyway: below it the difference between two actions is inside the
 * error of the solve itself, and calling one of them wrong would be reporting
 * noise as a mistake.
 */
export const FREE_ENOUGH = 0.01;

export function isCloseEnough(cost: number, pot: number): boolean {
  return cost <= pot * FREE_ENOUGH;
}
