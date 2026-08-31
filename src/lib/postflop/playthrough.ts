/**
 * Playing a hand out, rather than answering a question about one.
 *
 * A drill that shows one decision and scores it is a quiz. This walks a hand:
 * you get cards, you act, the opponent acts back out of a solved strategy, a
 * river comes, you act again, and somebody wins the pot. Every decision you
 * make is priced against the solver, and the opponent is not a script -- it is
 * the equilibrium strategy for the hand it is actually holding.
 *
 * ## What is solved, and what could not be
 *
 * The turn and the river are solved. The streets before them are not, and
 * cannot be here: a flop solve is three betting rounds and two chance layers,
 * which is minutes and gigabytes even for a commercial solver. So a hand starts
 * on the turn, with the ranges the preflop charts say the two players would
 * have, and the screen says so. Inventing a flop strategy would be exactly the
 * kind of made-up number this project refuses to render.
 *
 * ## How the river gets solved without shipping a solved river
 *
 * This is the trick that makes the whole thing cheap. A full turn solve holds
 * the strategy for all forty eight rivers, which is megabytes, and only one
 * river ever comes. So instead:
 *
 *   1. The turn strategy is precomputed and shipped. Four nodes, so kilobytes.
 *   2. As the turn plays out, each player's range is multiplied by the
 *      probability they would have taken the action they took. Plain Bayes, and
 *      exact.
 *   3. One river card comes.
 *   4. The river subgame is solved right there, from the narrowed ranges, in a
 *      few hundred milliseconds.
 *
 * The approximation in step 4 is worth stating. Re-solving the river on its own
 * is not identical to reading it out of a full turn solve, because in the full
 * solve the river strategy also feeds back into what the turn was worth.
 * Conditioned on the turn action that actually happened and the ranges it
 * implies, the two are close, and the gap is far smaller than the one between
 * solving the turn and not solving it.
 */

import { evaluate7, intToCard } from "../equity";
import type { Card } from "../cards";
import { buildHandSet, type HandSet } from "../solver/hands";
import {
  buildTree,
  IP,
  OOP,
  type Player,
  type PlayerNode,
  type Tree,
  type TreeNode,
} from "../solver/tree";
import { solveStreet, type ActionOption, type StreetStrategy } from "./decision";
import { RIVER_BETTING, type SpotDefinition } from "./spots";
import type { SolvedTurn } from "./turn-data";

export type Event =
  | { kind: "street"; name: "turn" | "river"; board: Card[] }
  | { kind: "acted"; who: "you" | "opponent"; label: string; cost: number | null; mix: string }
  | {
      kind: "result";
      /** The pot you take down. Zero when you lose. */
      won: number;
      /** What you put in across the hand, which is what a loss costs. */
      staked: number;
      reason: "fold" | "showdown";
      opponentHand: [Card, Card];
      verdict: "win" | "lose" | "split";
    };

export interface Choice {
  actions: ActionOption[];
  street: "turn" | "river";
  /** Chips in the middle, including what is already out on this street. */
  pot: number;
  /** What it costs to continue, or zero when nothing is bet. */
  toCall: number;
}

/** Everything the screen needs. Recomputed rather than mutated, so React sees it change. */
export interface HandView {
  spot: SpotDefinition;
  cards: [Card, Card];
  board: Card[];
  events: Event[];
  choice: Choice | null;
  finished: boolean;
  /** Total expected value given up across every decision, in chips. */
  cost: number;
  /** The mix at the decision you are facing, revealed only once you have acted. */
  lastMix: string | null;
  /**
   * The solved strategy at the decision you just made, over the whole range.
   * Null until you act, because showing it first would be showing the answer.
   */
  review: Review | null;
}

export interface Review {
  actions: ActionOption[];
  /** `actions x hands`, the solved strategy at that node. */
  frequency: Float64Array;
  /** Your range as it stood when you decided, for weighting the summary. */
  weight: Float64Array;
  hands: HandSet;
  street: "turn" | "river";
}

export class Playthrough {
  readonly spot: SpotDefinition;
  readonly hero: Player;

  private readonly rng: () => number;
  /** How hard to solve the river. Lower is faster and less exact; tests use it. */
  private readonly riverIterations: number;

  private street: "turn" | "river" = "turn";
  private hands: HandSet;
  private tree: Tree;
  private strategies: Map<number, StreetStrategy>;
  private ranges: [Float64Array, Float64Array];
  private heroIndex: number;
  private villainIndex: number;

  private node: TreeNode;
  /** Chips out on the street being played. */
  private onStreet: [number, number] = [0, 0];
  /** Chips from streets that have closed. Equal for both, since a street closes on a call. */
  private closed = 0;
  private board: number[];

  private readonly events: Event[] = [];
  private choice: Choice | null = null;
  private finished = false;
  private givenUp = 0;
  private review: Review | null = null;

  constructor(turn: SolvedTurn, options: { rng?: () => number; riverIterations?: number } = {}) {
    const rng = options.rng ?? Math.random;
    this.riverIterations = options.riverIterations ?? 200;
    this.spot = turn.spot;
    this.hero = turn.spot.hero;
    this.rng = rng;
    this.hands = turn.hands;
    this.tree = turn.tree;
    this.strategies = turn.strategies;
    this.ranges = [Float64Array.from(turn.ranges[0]), Float64Array.from(turn.ranges[1])];
    this.board = [...turn.hands.board];

    this.heroIndex = pick(this.ranges[this.hero]!, rng);
    this.villainIndex = pickCompatible(
      this.hands,
      this.ranges[other(this.hero)]!,
      this.heroIndex,
      rng,
    );

    this.node = this.tree.root;
    this.events.push({ kind: "street", name: "turn", board: this.boardCards() });
    this.advance();
  }

  view(): HandView {
    const last = [...this.events].reverse().find((e) => e.kind === "acted" && e.who === "you");
    return {
      spot: this.spot,
      cards: this.cardsOf(this.heroIndex),
      board: this.boardCards(),
      events: [...this.events],
      choice: this.choice,
      finished: this.finished,
      cost: this.givenUp,
      lastMix: last && last.kind === "acted" ? last.mix : null,
      review: this.review,
    };
  }

  /** Take an action. Returns what it gave up against the best one available. */
  act(index: number): number {
    if (!this.choice || this.finished || this.node.kind !== "player") return 0;
    const node = this.node;

    const cost = this.costAt(node, index);
    this.givenUp += cost;
    this.review = {
      actions: this.strategy(node).actions,
      frequency: this.strategy(node).frequency,
      // Snapshotted before narrowing, so the grid shows the range you were
      // deciding with rather than the one your own action just implied.
      weight: Float64Array.from(this.ranges[node.player]!),
      hands: this.hands,
      street: this.street,
    };
    this.events.push({
      kind: "acted",
      who: "you",
      label: this.choice.actions[index]!.label,
      cost,
      mix: this.mixAt(node),
    });

    this.narrow(node, index);
    this.step(node, index);
    this.choice = null;
    this.advance();
    return cost;
  }

  // -------------------------------------------------------------------------

  private strategy(node: PlayerNode): StreetStrategy {
    const found = this.strategies.get(node.id);
    if (!found) throw new Error(`No solved strategy at node ${node.id}`);
    return found;
  }

  private indexOf(player: Player): number {
    return player === this.hero ? this.heroIndex : this.villainIndex;
  }

  private costAt(node: PlayerNode, index: number): number {
    const { ev } = this.strategy(node);
    const stride = this.hands.count;
    const at = this.indexOf(node.player);

    let best = -Infinity;
    for (let a = 0; a < node.actions.length; a++) best = Math.max(best, ev[a * stride + at]!);
    return Math.max(0, best - ev[index * stride + at]!);
  }

  private mixAt(node: PlayerNode): string {
    const { frequency, actions } = this.strategy(node);
    const stride = this.hands.count;
    const at = this.indexOf(node.player);

    return actions
      .map((action, a) => ({ label: action.label, share: frequency[a * stride + at]! }))
      .filter((entry) => entry.share > 0.005)
      .map((entry) => `${entry.label.toLowerCase()} ${(entry.share * 100).toFixed(0)}%`)
      .join(", ");
  }

  /** Bayes: whoever acted is now only holding hands that take that action. */
  private narrow(node: PlayerNode, index: number): void {
    const { frequency } = this.strategy(node);
    const stride = this.hands.count;
    const range = this.ranges[node.player]!;
    for (let h = 0; h < stride; h++) range[h] = range[h]! * frequency[index * stride + h]!;
  }

  private step(node: PlayerNode, index: number): void {
    this.onStreet[node.player] = node.actions[index]!.to;
    this.node = node.children[index]!;
  }

  private potNow(): number {
    return this.spot.pot + 2 * this.closed + this.onStreet[0] + this.onStreet[1];
  }

  /** Resolve everything that is not a decision of yours, until one is. */
  private advance(): void {
    for (let guard = 0; guard < 64; guard++) {
      const node = this.node;

      if (node.kind === "fold") {
        this.finish(node.winner === this.hero ? "win" : "lose", "fold");
        return;
      }
      if (node.kind === "showdown") {
        if (this.street === "turn") {
          this.dealRiver();
          continue;
        }
        this.finish(this.showdownVerdict(), "showdown");
        return;
      }
      if (node.kind === "chance") {
        this.dealRiver();
        continue;
      }

      if (node.player === this.hero) {
        const actions = this.strategy(node).actions;
        const passive = actions.find((a) => a.kind === "check" || a.kind === "fold");
        this.review = null;
        this.choice = {
          actions,
          street: this.street,
          pot: this.potNow(),
          toCall: this.onStreet[other(this.hero)] - (passive?.to ?? 0),
        };
        return;
      }

      const index = this.sample(node);
      this.events.push({
        kind: "acted",
        who: "opponent",
        label: this.strategy(node).actions[index]!.label,
        cost: null,
        mix: "",
      });
      this.narrow(node, index);
      this.step(node, index);
    }
    throw new Error("The hand did not terminate");
  }

  private sample(node: PlayerNode): number {
    const { frequency } = this.strategy(node);
    const stride = this.hands.count;
    const at = this.indexOf(node.player);

    let target = this.rng();
    for (let a = 0; a < node.actions.length; a++) {
      target -= frequency[a * stride + at]!;
      if (target <= 0) return a;
    }
    return node.actions.length - 1;
  }

  /**
   * Deal a river and solve the subgame under it.
   *
   * The card cannot be one either player holds, which is the same reason the
   * chance weight in a turn solve is one in forty four and not one in forty
   * eight: the dealer's deck has forty eight cards but four of them are already
   * in front of the players.
   */
  private dealRiver(): void {
    // The street closed, so both players have matched. Bank it.
    this.closed += this.onStreet[0];
    this.onStreet = [0, 0];

    const taken = new Set([
      ...this.board,
      this.hands.cardA[this.heroIndex]!,
      this.hands.cardB[this.heroIndex]!,
      this.hands.cardA[this.villainIndex]!,
      this.hands.cardB[this.villainIndex]!,
    ]);
    const deck: number[] = [];
    for (let card = 0; card < 52; card++) if (!taken.has(card)) deck.push(card);
    const river = deck[Math.floor(this.rng() * deck.length)]!;

    const heroCards: [number, number] = [
      this.hands.cardA[this.heroIndex]!,
      this.hands.cardB[this.heroIndex]!,
    ];
    const villainCards: [number, number] = [
      this.hands.cardA[this.villainIndex]!,
      this.hands.cardB[this.villainIndex]!,
    ];

    this.board = [...this.board, river];
    const hands = buildHandSet(this.board);

    // Carry the narrowed ranges into the river's index space. Hands holding the
    // card that just came stop existing.
    const ranges: [Float64Array, Float64Array] = [
      new Float64Array(hands.count),
      new Float64Array(hands.count),
    ];
    for (let h = 0; h < this.hands.count; h++) {
      const at = hands.indexOf(this.hands.cardA[h]!, this.hands.cardB[h]!);
      if (at < 0) continue;
      ranges[0]![at] = this.ranges[0]![h]!;
      ranges[1]![at] = this.ranges[1]![h]!;
    }

    this.hands = hands;
    this.ranges = ranges;
    this.heroIndex = hands.indexOf(heroCards[0], heroCards[1]);
    this.villainIndex = hands.indexOf(villainCards[0], villainCards[1]);
    this.street = "river";
    this.events.push({ kind: "street", name: "river", board: this.boardCards() });

    // Both players all in on the turn, so the river is a card and nothing else.
    // Building a betting tree on an empty stack would offer a bet of one chip
    // that neither player has.
    const behind = this.spot.stack - this.closed;
    if (behind <= 0) {
      this.node = { kind: "showdown", amount: 0 };
      return;
    }

    const tree = buildTree({
      ...RIVER_BETTING,
      startingPot: this.spot.pot + 2 * this.closed,
      effectiveStack: behind,
    });

    this.strategies = solveStreet(
      { definition: this.spot, hands, views: undefined, tree, ranges, node: tree.playerNodes[0]! },
      { iterations: this.riverIterations },
    );

    this.tree = tree;
    this.node = tree.root;
  }

  private showdownVerdict(): "win" | "lose" | "split" {
    const hero = evaluate7([
      ...this.board,
      this.hands.cardA[this.heroIndex]!,
      this.hands.cardB[this.heroIndex]!,
    ]);
    const villain = evaluate7([
      ...this.board,
      this.hands.cardA[this.villainIndex]!,
      this.hands.cardB[this.villainIndex]!,
    ]);
    return hero > villain ? "win" : hero < villain ? "lose" : "split";
  }

  /**
   * What the hand was worth, net of everything put in.
   *
   * Winning collects the dead money plus whatever the loser put in; losing
   * costs what you put in; a split returns both stakes and halves the dead
   * money. At a showdown the two stakes are equal by construction, since you
   * only get there by matching.
   */
  private finish(verdict: "win" | "lose" | "split", reason: "fold" | "showdown"): void {
    const heroIn = this.closed + this.onStreet[this.hero];
    const villainIn = this.closed + this.onStreet[other(this.hero)];

    // Reported as a pot rather than as a profit, which is how a poker player
    // reads a hand: you won a forty chip pot, or you lost the twelve you put
    // in. The verdict carries whether it was a win, because a hand lost after
    // checking it down loses nothing and a sign test would call that a split.
    const won = verdict === "win" ? this.spot.pot + villainIn : verdict === "split" ? this.spot.pot / 2 : 0;

    this.events.push({
      kind: "result",
      won,
      staked: heroIn,
      reason,
      verdict,
      opponentHand: this.cardsOf(this.villainIndex),
    });
    this.finished = true;
    this.choice = null;
  }

  private cardsOf(index: number): [Card, Card] {
    return [intToCard(this.hands.cardA[index]!), intToCard(this.hands.cardB[index]!)];
  }

  private boardCards(): Card[] {
    return this.board.map((card) => intToCard(card));
  }
}

function other(player: Player): Player {
  return player === OOP ? IP : OOP;
}

function pick(range: Float64Array, rng: () => number): number {
  let total = 0;
  for (const weight of range) total += weight;
  if (total <= 0) throw new Error("Cannot deal from an empty range");

  let target = rng() * total;
  for (let i = 0; i < range.length; i++) {
    target -= range[i]!;
    if (target <= 0) return i;
  }
  return range.length - 1;
}

/** The opponent cannot be holding a card you are holding. */
function pickCompatible(
  hands: HandSet,
  range: Float64Array,
  taken: number,
  rng: () => number,
): number {
  const a = hands.cardA[taken]!;
  const b = hands.cardB[taken]!;
  const live = new Float64Array(range.length);
  for (let h = 0; h < range.length; h++) {
    const x = hands.cardA[h]!;
    const y = hands.cardB[h]!;
    live[h] = x === a || x === b || y === a || y === b ? 0 : range[h]!;
  }
  return pick(live, rng);
}
