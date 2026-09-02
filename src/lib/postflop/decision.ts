/**
 * The shapes a solved street takes on the way to the screen.
 *
 * A node's actions have to be named before anyone can press one, a node's
 * strategy has to be carried around whether it came off the wire or out of a
 * solve a moment ago, and a strategy over 1,128 combinations has to collapse
 * onto 169 cells before it can be looked at. That is all this file is.
 */

import type { HandSet } from "../solver/hands";
import type { ActionKind, Player, PlayerNode } from "../solver/tree";
import { handClassOf } from "../cards";
import { roundChips } from "../sizing";
import { intToCard } from "../equity";
import { CLASS_COUNT, classIndexOf } from "../combos";

export interface ActionOption {
  kind: ActionKind;
  /** How it reads on a button: "Check", "Bet 2.8", "Raise to 9". */
  label: string;
  /** Chips the acting player has in once the action is taken. */
  to: number;
}

export function describeActions(node: PlayerNode): ActionOption[] {
  const { actions } = node;
  // Whatever it costs to stay in without raising is the acting player's current
  // stake, which is what turns a total into a bet size.
  const passive = actions.find((action) => action.kind === "check" || action.kind === "fold");
  const mine = passive?.to ?? 0;

  return actions.map((action) => {
    // A tenth of a blind, because a hand played from preflop is counted in big
    // blinds and half its sizes are not whole ones.
    const added = roundChips(action.to - mine);
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
        return { kind: action.kind, label: `Raise to ${roundChips(action.to)}`, to: action.to };
    }
  });
}

/**
 * A node's solved strategy and action values, over every hand on the board.
 *
 * Nothing is filtered out. A player is allowed to play badly, and a hand bet
 * that the solver never bets still has to have a strategy at the node after the
 * bet, or the hand cannot continue.
 */
export interface StreetStrategy {
  actions: ActionOption[];
  player: Player;
  /** `actions x handCount`. */
  frequency: Float64Array;
  /** `actions x handCount`, in chips. */
  ev: Float64Array;
}

/**
 * Collapse a per-combination strategy onto the 169 class grid.
 *
 * The grid is how anyone reads a poker range, and it has 169 cells while a
 * postflop strategy has up to 1,128 entries. So the combinations of a class are
 * averaged, weighted by how often each one is actually here.
 *
 * This is lossy and worth being honest about: on a two-tone board the two
 * combinations of AKs play very differently, one having a flush draw and the
 * other not, and the cell shows their average. It is the standard way solvers
 * summarise a strategy and it is a summary, not the strategy.
 */
export function aggregateStrategy(
  actionCount: number,
  frequencies: Float64Array,
  weights: Float64Array,
  hands: HandSet,
): { frequency: Float64Array; present: boolean[] } {
  const count = hands.count;
  const frequency = new Float64Array(actionCount * CLASS_COUNT);
  const mass = new Float64Array(CLASS_COUNT);

  for (let i = 0; i < count; i++) {
    const weight = weights[i]!;
    if (weight <= 0) continue;

    const klass = classIndexOf(
      handClassOf(intToCard(hands.cardA[i]!), intToCard(hands.cardB[i]!)),
    );
    mass[klass] = mass[klass]! + weight;
    for (let a = 0; a < actionCount; a++) {
      frequency[a * CLASS_COUNT + klass] =
        frequency[a * CLASS_COUNT + klass]! + weight * frequencies[a * count + i]!;
    }
  }

  const present: boolean[] = [];
  for (let k = 0; k < CLASS_COUNT; k++) {
    present.push(mass[k]! > 0);
    if (mass[k]! <= 0) continue;
    for (let a = 0; a < actionCount; a++) {
      frequency[a * CLASS_COUNT + k] = frequency[a * CLASS_COUNT + k]! / mass[k]!;
    }
  }

  return { frequency, present };
}
