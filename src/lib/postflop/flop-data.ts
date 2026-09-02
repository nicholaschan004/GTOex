/**
 * The precomputed flop strategy, and how it gets back off the wire.
 *
 * Only the FLOP nodes are shipped, which is four of the 85,264 a three street
 * tree has. The other 85,260 are the turn and river rounds under all 49 turns
 * and all 48 rivers, and shipping them would be megabytes so that two of them
 * could be read.
 *
 * They are not thrown away for nothing, though. `playthrough.ts` re-solves the
 * turn that actually comes, and then the river that actually comes, from the
 * ranges the earlier streets left behind. That is not a downgrade: those solves
 * see the real narrowed ranges rather than the flop's starting ones, and they
 * run without the bucketing the flop solve needed to fit in memory. The streets
 * that are cheap to solve exactly get solved exactly, at the moment there is
 * only one of them left.
 *
 * Nodes are keyed by the path of action indices that reaches them rather than
 * by node id. Ids are assigned in tree-build order, and the tree the browser
 * rebuilds is the flop betting round alone -- four nodes -- while the tree the
 * solver used had 85,264, so the ids do not line up and were never going to.
 * A path is the same in both.
 */

import { buildStreets, type PlayerNode, type Tree, type TreeNode } from "../solver/tree";
import type { HandSet } from "../solver/hands";
import { compactToLive, buildHandSet, weightsFromClasses } from "../solver/hands";
import { parseCards } from "../equity";
import { parseRange } from "../range";
import { describeActions, type StreetStrategy } from "./decision";
import {
  FULL_HAND_BETTING,
  SCENARIOS_BY_ID,
  seatsOf,
  type Scenario,
  type Seats,
} from "./scenario";

export interface PackedFlopNode {
  /** Action indices from the root. The empty string is the root itself. */
  path: string;
  /** Base64, one byte per action per hand. */
  frequency: string;
  /** Base64, two little-endian bytes per action per hand. Null at opponent nodes. */
  ev: string | null;
  evMin: number;
  evMax: number;
}

export interface PackedFlop {
  scenarioId: string;
  handCount: number;
  nodes: PackedFlopNode[];
  exploitabilityPercent: number;
  iterations: number;
  /** How coarsely the river was grouped inside the solve. */
  riverBuckets: number;
}

/** A scenario rebuilt far enough to play, without the 2,352 runout views. */
export interface FlopShell {
  scenario: Scenario;
  seats: Seats;
  hands: HandSet;
  ranges: [Float64Array, Float64Array];
  /** The flop betting round on its own. The streets after it are solved live. */
  tree: Tree;
}

export interface SolvedFlopHand extends FlopShell {
  strategies: Map<number, StreetStrategy>;
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
 * Every flop decision node, keyed by how you get to it.
 *
 * Walking stops as soon as the street changes, which is what makes this work on
 * both trees: on the shipped one the children of a street ending are showdowns,
 * and on the solver's they are a chance node dealing forty nine turns. Neither
 * is a player node on the flop, so neither is walked into.
 */
export function flopNodesByPath(tree: Tree): Map<string, PlayerNode> {
  const out = new Map<string, PlayerNode>();

  function visit(node: TreeNode, path: number[]): void {
    if (node.kind !== "player" || node.street !== 0) return;
    out.set(path.join(","), node);
    node.children.forEach((child, action) => visit(child, [...path, action]));
  }

  visit(tree.root, []);
  return out;
}

/**
 * Rebuild a scenario far enough to play it.
 *
 * Deliberately not `buildFlopGame`: that one builds a runout view for every
 * (turn, river) pair, which is 2,352 sorts of 520 hands. The solver needs them.
 * A browser about to play one hand does not, and would wait a second and a half
 * for them.
 */
export function buildFlopShell(scenario: Scenario): FlopShell {
  const board = parseCards(scenario.flop);
  const seats = seatsOf(scenario);
  const all = buildHandSet(board, false);
  const compact = compactToLive(all, [
    weightsFromClasses(all, parseRange(seats.ranges[0])),
    weightsFromClasses(all, parseRange(seats.ranges[1])),
  ]);

  return {
    scenario,
    seats,
    hands: compact.hands,
    ranges: compact.ranges,
    tree: buildStreets(
      { ...FULL_HAND_BETTING.flop, startingPot: seats.pot, effectiveStack: seats.stack },
      [],
    ),
  };
}

export function packFlopNode(
  path: string,
  frequency: Float64Array,
  ev: Float64Array | null,
): PackedFlopNode {
  const frequencyBytes = new Uint8Array(frequency.length);
  for (let i = 0; i < frequency.length; i++) {
    frequencyBytes[i] = Math.round(Math.min(1, Math.max(0, frequency[i]!)) * 255);
  }

  if (!ev) {
    return { path, frequency: toBase64(frequencyBytes), ev: null, evMin: 0, evMax: 0 };
  }

  let evMin = Infinity;
  let evMax = -Infinity;
  for (const value of ev) {
    evMin = Math.min(evMin, value);
    evMax = Math.max(evMax, value);
  }
  const span = evMax - evMin || 1;

  const evBytes = new Uint8Array(ev.length * 2);
  const view = new DataView(evBytes.buffer);
  for (let i = 0; i < ev.length; i++) {
    view.setUint16(i * 2, Math.round(((ev[i]! - evMin) / span) * 65535), true);
  }

  return { path, frequency: toBase64(frequencyBytes), ev: toBase64(evBytes), evMin, evMax };
}

/**
 * Rebuild a playable flop from the shipped bytes.
 *
 * The hand set is rebuilt from the scenario rather than serialised, so it has
 * to come out the same size it did at build time. It will, because the ranges
 * and the board are the same inputs to the same function -- and if a scenario
 * is edited without regenerating, it will not, so the count is checked rather
 * than assumed. Silently lining a strategy up against the wrong hands is the
 * one failure here that would look like a working trainer.
 */
export function loadFlop(packed: PackedFlop): SolvedFlopHand {
  const scenario = SCENARIOS_BY_ID.get(packed.scenarioId);
  if (!scenario) throw new Error(`No scenario called ${packed.scenarioId}`);

  const shell = buildFlopShell(scenario);
  if (shell.hands.count !== packed.handCount) {
    throw new Error(
      `${packed.scenarioId} was solved for ${packed.handCount} hands but the flop now allows ${shell.hands.count}. Regenerate it.`,
    );
  }

  const byPath = flopNodesByPath(shell.tree);
  if (byPath.size !== packed.nodes.length) {
    throw new Error(
      `${packed.scenarioId} was solved with ${packed.nodes.length} flop nodes and now has ${byPath.size}. Regenerate it.`,
    );
  }

  const strategies = new Map<number, StreetStrategy>();
  for (const stored of packed.nodes) {
    const node = byPath.get(stored.path);
    if (!node) {
      throw new Error(`${packed.scenarioId} has no flop node at "${stored.path}". Regenerate it.`);
    }

    const count = node.actions.length * packed.handCount;
    const frequencyBytes = fromBase64(stored.frequency);
    if (frequencyBytes.length !== count) {
      throw new Error(
        `${packed.scenarioId} node "${stored.path}" has ${frequencyBytes.length} frequencies, not ${count}. Regenerate it.`,
      );
    }

    const frequency = new Float64Array(count);
    for (let i = 0; i < count; i++) frequency[i] = frequencyBytes[i]! / 255;

    const ev = new Float64Array(count);
    if (stored.ev) {
      const bytes = fromBase64(stored.ev);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const span = stored.evMax - stored.evMin || 1;
      for (let i = 0; i < count; i++) {
        ev[i] = stored.evMin + (view.getUint16(i * 2, true) / 65535) * span;
      }
    }

    strategies.set(node.id, {
      actions: describeActions(node),
      player: node.player,
      frequency,
      ev,
    });
  }

  return { ...shell, strategies, exploitabilityPercent: packed.exploitabilityPercent };
}
