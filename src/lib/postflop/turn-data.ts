/**
 * The precomputed turn strategy, and how it gets back off the wire.
 *
 * Only the TURN nodes are shipped, which is four of the five hundred and eighty
 * a turn tree has. The other five hundred and seventy six are the river subtrees
 * under all forty eight cards, and shipping those would be megabytes for a
 * street where forty seven of the forty eight never happen. `playthrough.ts`
 * solves the one river that does, live, from the ranges the turn action leaves
 * behind.
 *
 * Strategies cover every hand rather than the ones that usually get there,
 * because a player is allowed to play badly: betting a hand the solver never
 * bets still has to leave the hand playable at the node after the bet.
 */

import type { PlayerNode, Tree } from "../solver/tree";
import type { HandSet } from "../solver/hands";
import { buildSpot, type SpotDefinition } from "./spots";
import { SPOTS_BY_ID } from "./spots";
import { describeActions, type StreetStrategy } from "./decision";

export interface PackedTurnNode {
  id: number;
  /** Base64, one byte per action per hand. */
  frequency: string;
  /** Base64, two little-endian bytes per action per hand. Null at opponent nodes. */
  ev: string | null;
  evMin: number;
  evMax: number;
}

export interface PackedTurn {
  spotId: string;
  handCount: number;
  nodes: PackedTurnNode[];
  exploitabilityPercent: number;
}

export interface SolvedTurn {
  spot: SpotDefinition;
  hands: HandSet;
  tree: Tree;
  ranges: [Float64Array, Float64Array];
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

export function packTurnNode(
  id: number,
  frequency: Float64Array,
  ev: Float64Array | null,
): PackedTurnNode {
  const frequencyBytes = new Uint8Array(frequency.length);
  for (let i = 0; i < frequency.length; i++) {
    frequencyBytes[i] = Math.round(Math.min(1, Math.max(0, frequency[i]!)) * 255);
  }

  if (!ev) {
    return { id, frequency: toBase64(frequencyBytes), ev: null, evMin: 0, evMax: 0 };
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

  return { id, frequency: toBase64(frequencyBytes), ev: toBase64(evBytes), evMin, evMax };
}

/**
 * Rebuild a playable turn from the shipped bytes.
 *
 * The tree is reconstructed from the spot definition rather than serialised,
 * which means node ids have to line up. They will, because the builder is
 * deterministic, and if a spot is edited without regenerating they will not --
 * so the count is checked rather than assumed.
 */
export function loadTurn(packed: PackedTurn): SolvedTurn {
  const definition = SPOTS_BY_ID.get(packed.spotId);
  if (!definition) throw new Error(`No spot called ${packed.spotId}`);

  const built = buildSpot(definition, { withViews: false });
  if (built.hands.count !== packed.handCount) {
    throw new Error(
      `${packed.spotId} was solved for ${packed.handCount} hands but the board now allows ${built.hands.count}. Regenerate it.`,
    );
  }

  const turnNodes = built.tree.playerNodes.filter((node) => node.street === 0);
  if (turnNodes.length !== packed.nodes.length) {
    throw new Error(
      `${packed.spotId} was solved with ${packed.nodes.length} turn nodes and now has ${turnNodes.length}. Regenerate it.`,
    );
  }

  const byId = new Map<number, PlayerNode>(turnNodes.map((node) => [node.id, node]));
  const strategies = new Map<number, StreetStrategy>();

  for (const stored of packed.nodes) {
    const node = byId.get(stored.id);
    if (!node) throw new Error(`${packed.spotId} refers to a node ${stored.id} that is not on the turn`);

    const count = node.actions.length * packed.handCount;
    const frequencyBytes = fromBase64(stored.frequency);
    if (frequencyBytes.length !== count) {
      throw new Error(`${packed.spotId} node ${stored.id} has the wrong number of frequencies`);
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

    strategies.set(stored.id, {
      actions: describeActions(node),
      player: node.player,
      frequency,
      ev,
    });
  }

  return {
    spot: definition,
    hands: built.hands,
    // The turn tree carries 48 river subtrees the playthrough never walks, so
    // the tree it plays on is the turn betting alone, ending where the river
    // gets dealt and solved.
    tree: built.tree,
    ranges: built.ranges,
    strategies,
    exploitabilityPercent: packed.exploitabilityPercent,
  };
}
