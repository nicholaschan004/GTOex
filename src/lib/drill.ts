/** Generating a spot, and judging the answer. */

import { type Card, type HandClass, dealHoleCards, handClassOf } from "./cards";
import {
  POSITIONS,
  RFI_POSITIONS,
  STACK_DEPTHS,
  type Position,
  type RfiPosition,
  type StackDepth,
} from "./positions";
import { RFI_BY_DEPTH } from "./charts/rfi";
import { VS_OPEN_100BB, defendersAgainst } from "./charts/vs-open";
import { PUSHFOLD, PUSHFOLD_STACKS, type PushFoldStack } from "./charts/pushfold.generated";
import { parseRange } from "./range";

/**
 * Which actions a spot offers is derived from the spot, never assumed.
 *
 * Raise-first-in is fold or raise: nobody has bet, so there is nothing to call.
 * Facing an open adds the call. Push/fold offers whichever single decision that
 * seat actually has. Hard-coding three buttons everywhere would put a call
 * button on a screen where calling is not a legal action.
 */
export type Action = "fold" | "call" | "raise";

export type DrillMode = "rfi" | "vs-open" | "pushfold";

export const DRILL_MODES: { id: DrillMode; label: string; blurb: string }[] = [
  { id: "rfi", label: "Opening", blurb: "Everyone folds to you. Open or fold." },
  { id: "vs-open", label: "Facing a raise", blurb: "Someone raised. Fold, call or 3-bet." },
  { id: "pushfold", label: "Push / fold", blurb: "Short stacks, heads up. All in or fold." },
];

interface BaseSpot {
  cards: [Card, Card];
  hand: HandClass;
}

export interface RfiSpot extends BaseSpot {
  kind: "rfi";
  position: RfiPosition;
  depth: StackDepth;
}

export interface VsOpenSpot extends BaseSpot {
  kind: "vs-open";
  opener: RfiPosition;
  position: Position;
  depth: 100;
}

export interface PushFoldSpot extends BaseSpot {
  kind: "pushfold";
  /** The small blind decides whether to shove; the big blind whether to call one. */
  seat: "SB" | "BB";
  stack: PushFoldStack;
}

export type Spot = RfiSpot | VsOpenSpot | PushFoldSpot;

/** Parsing the same handful of strings on every deal is wasteful. */
const rangeCache = new Map<string, Set<HandClass>>();
function cachedRange(key: string, notation: string): Set<HandClass> {
  const hit = rangeCache.get(key);
  if (hit) return hit;
  const parsed = parseRange(notation);
  rangeCache.set(key, parsed);
  return parsed;
}

export function rfiRange(position: RfiPosition, depth: StackDepth = 100): Set<HandClass> {
  return cachedRange(`rfi:${depth}:${position}`, RFI_BY_DEPTH[depth][position]);
}

function vsOpenEntry(spot: VsOpenSpot) {
  const entry = VS_OPEN_100BB[spot.opener][spot.position];
  if (!entry) throw new Error(`No chart for ${spot.position} against ${spot.opener}`);
  return entry;
}

/**
 * The layers to draw on the grid: the actions available, each with the hands
 * that take it. Ordered strongest action first.
 */
export interface RangeLayer {
  action: Action;
  label: string;
  hands: Set<HandClass>;
}

export function layersFor(spot: Spot): RangeLayer[] {
  switch (spot.kind) {
    case "rfi":
      return [{ action: "raise", label: "Open", hands: rfiRange(spot.position, spot.depth) }];
    case "vs-open": {
      const entry = vsOpenEntry(spot);
      const key = `vs:${spot.opener}:${spot.position}`;
      return [
        { action: "raise", label: "3-bet", hands: cachedRange(`${key}:3b`, entry.threeBet) },
        { action: "call", label: "Call", hands: cachedRange(`${key}:c`, entry.call) },
      ];
    }
    case "pushfold": {
      const chart = PUSHFOLD[spot.stack];
      return spot.seat === "SB"
        ? [
            {
              action: "raise",
              label: "Shove",
              hands: cachedRange(`pf:${spot.stack}:s`, chart.shove),
            },
          ]
        : [
            {
              action: "call",
              label: "Call",
              hands: cachedRange(`pf:${spot.stack}:c`, chart.call),
            },
          ];
    }
  }
}

export function actionsFor(spot: Spot): Action[] {
  switch (spot.kind) {
    case "rfi":
      return ["fold", "raise"];
    case "vs-open":
      return ["fold", "call", "raise"];
    case "pushfold":
      return spot.seat === "SB" ? ["fold", "raise"] : ["fold", "call"];
  }
}

/** What the buttons say. "Raise" means something different in each mode. */
export function actionLabel(spot: Spot, action: Action): string {
  if (action === "fold") return "Fold";
  if (action === "call") return "Call";
  switch (spot.kind) {
    case "rfi":
      return "Open";
    case "vs-open":
      return "3-bet";
    case "pushfold":
      return "All in";
  }
}

export function correctAction(spot: Spot): Action {
  for (const layer of layersFor(spot)) {
    if (layer.hands.has(spot.hand)) return layer.action;
  }
  return "fold";
}

export interface Verdict {
  correct: boolean;
  answered: Action;
  best: Action;
}

export function judge(spot: Spot, answered: Action): Verdict {
  const best = correctAction(spot);
  return { correct: answered === best, answered, best };
}

/** The seats that folded to you, which is everyone acting before your own. */
export function foldedBefore(position: Position): Position[] {
  const seat = POSITIONS.indexOf(position);
  return POSITIONS.slice(0, seat === -1 ? 0 : seat);
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

function pick<T>(items: readonly T[], rng: () => number): T {
  const chosen = items[Math.floor(rng() * items.length)];
  if (chosen === undefined) throw new Error("Cannot pick from an empty list");
  return chosen;
}

export interface DealOptions {
  /** Restrict opening spots to one depth. Undefined means deal all of them. */
  depth?: StackDepth;
}

export function dealSpot(
  mode: DrillMode,
  options: DealOptions = {},
  rng: () => number = Math.random,
): Spot {
  const cards = dealHoleCards(rng);
  const hand = handClassOf(cards[0], cards[1]);

  if (mode === "rfi") {
    return {
      kind: "rfi",
      position: pick(RFI_POSITIONS, rng),
      depth: options.depth ?? pick(STACK_DEPTHS, rng),
      cards,
      hand,
    };
  }

  if (mode === "vs-open") {
    const opener = pick(RFI_POSITIONS, rng);
    return {
      kind: "vs-open",
      opener,
      position: pick(defendersAgainst(opener), rng),
      depth: 100,
      cards,
      hand,
    };
  }

  return {
    kind: "pushfold",
    seat: pick(["SB", "BB"] as const, rng),
    stack: pick(PUSHFOLD_STACKS, rng),
    cards,
    hand,
  };
}

// ---------------------------------------------------------------------------
// Identity, for progress tracking
// ---------------------------------------------------------------------------

/** Stable key for the exact spot, so accuracy is tracked per situation. */
export function spotKey(spot: Spot): string {
  switch (spot.kind) {
    case "rfi":
      return `rfi:${spot.depth}:${spot.position}`;
    case "vs-open":
      return `vs:${spot.opener}>${spot.position}`;
    case "pushfold":
      return `pf:${spot.seat}`;
  }
}

/** How that key reads on screen. */
export function spotLabel(spot: Spot): string {
  switch (spot.kind) {
    case "rfi":
      return `${spot.position} open, ${spot.depth}bb`;
    case "vs-open":
      return `${spot.position} vs ${spot.opener}`;
    case "pushfold":
      return spot.seat === "SB" ? "SB shove" : "BB call";
  }
}

/** One line describing what has happened before the decision. */
export function spotStory(spot: Spot): string {
  switch (spot.kind) {
    case "rfi": {
      const folded = foldedBefore(spot.position);
      return folded.length === 0
        ? "You are first to act."
        : `${folded.join(", ")} ${folded.length === 1 ? "folds" : "fold"}. Action on you.`;
    }
    case "vs-open":
      return `${spot.opener} raises. Action on you.`;
    case "pushfold":
      return spot.seat === "SB"
        ? "Heads up, folded to you in the small blind."
        : "The small blind moves all in.";
  }
}

export function spotHeading(spot: Spot): string {
  switch (spot.kind) {
    case "rfi":
      return `${spot.position} · ${spot.depth}bb · 6 handed`;
    case "vs-open":
      return `${spot.position} · ${spot.depth}bb · 6 handed`;
    case "pushfold":
      return `${spot.seat} · ${spot.stack}bb · heads up`;
  }
}
