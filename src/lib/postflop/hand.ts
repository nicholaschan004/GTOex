/**
 * A hand, played from the deal to the showdown.
 *
 * You are dealt two cards, you act preflop, the flop comes, and you play it out
 * against an opponent that is not a script: at every decision it draws from the
 * solved strategy for the hand it is actually holding, and after every action
 * both ranges narrow by exactly the amount that action implies.
 *
 * ## What is solved, and what is not
 *
 * PREFLOP is a chart, and says so. This repo's opening and defending ranges are
 * conventional baseline data, not solver output, and the preflop decision is
 * scored right or wrong against them rather than priced. That is not laziness
 * about the scoring: a chart has no expected values in it to price against, and
 * inventing some would be inventing the number that matters most.
 *
 * THE FLOP comes out of a three street solve done at build time -- the flop
 * betting round, all 49 turns, all 48 rivers under each -- and shipped as its
 * four flop nodes. See `flop-data.ts`.
 *
 * THE TURN AND THE RIVER are solved when they arrive, from the ranges the play
 * so far implies. They have to be: after two players act on the flop the ranges
 * are whatever those actions made them, and there is no precomputing that. It
 * is also the better answer, because those solves see the real ranges and carry
 * no bucketing.
 *
 * ## The one place beliefs are patched
 *
 * Narrowing a range is Bayes and nothing else: multiply each hand's weight by
 * how often it takes the action that was taken. But you are allowed to play
 * badly, and if you take an action the solver never takes with any hand, the
 * multiplier is zero for every hand and the range vanishes. An empty range is
 * not a belief the opponent can hold, and a solver handed one produces
 * nonsense. So a range that would vanish is kept as it was, scaled down, and a
 * hand that would vanish on its own is kept at a trace. See `narrow`.
 */

import type { Card } from "../cards";
import { handClassOf } from "../cards";
import { intToCard } from "../equity";
import { judge, type Action, type Spot, type Verdict } from "../drill";
import { blindPostedBy, formatChips, threeBetSize } from "../sizing";
import { compactToLive, buildHandSet, type HandSet } from "../solver/hands";
import {
  IP,
  OOP,
  streetNodesByPath,
  type Player,
  type PlayerNode,
  type TreeNode,
} from "../solver/tree";
import type { ActionKind } from "../solver/tree";
import { evaluate7 } from "../equity";
import type { ActionOption, StreetStrategy } from "./decision";
import type { SolvedFlopHand } from "./flop-data";
import { STARTING_STACK } from "./scenario";
import {
  LIVE_ITERATIONS,
  solveSubgame,
  subgameTree,
  type SubgameRequest,
  type SubgameSolution,
} from "./subgame";

export type Street = "preflop" | "flop" | "turn" | "river";

const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

/**
 * How often the hand you are dealt is one your seat continues with.
 *
 * Not one: a preflop decision with only one answer is not a decision. Not a
 * half either, because this mode exists to play hands out and the preflop
 * drills are where folding gets drilled. Three in four keeps the fold live
 * without spending most of the session on hands that end before the flop.
 */
export const CONTINUE_BIAS = 0.75;

/** A range that would vanish is scaled to this instead. See the note above. */
const TRACE = 1e-3;

export interface Choice {
  street: Street;
  actions: ActionOption[];
  /** Chips in the middle, including what is out on this street. */
  pot: number;
  /** What it costs to continue, or zero when nothing is bet. */
  toCall: number;
}

export type HandEvent =
  | { kind: "street"; name: Street; board: Card[]; pot: number }
  | {
      kind: "acted";
      who: "you" | "opponent";
      street: Street;
      label: string;
      action: ActionKind;
      /** Chips added by this action, for sliding into the pot. */
      added: number;
      /** The pot once they are in. */
      pot: number;
      /** Big blinds given up against the best action. Null where you did not decide. */
      cost: number | null;
      /** How the solver plays your hand here. Empty where you did not decide. */
      mix: string;
    }
  | {
      kind: "result";
      ending: "showdown" | "fold" | "folded-preflop" | "off-line";
      verdict: "win" | "lose" | "split" | null;
      /** The pot you take down. Zero when you do not. */
      won: number;
      /** What you put in across the hand, which is what losing costs. */
      staked: number;
      opponentHand: [Card, Card] | null;
      note: string | null;
    };

export interface Review {
  actions: ActionOption[];
  /** `actions x hands`, the solved strategy at the decision you just made. */
  frequency: Float64Array;
  /** Your range as it stood when you decided. */
  weight: Float64Array;
  hands: HandSet;
  street: Street;
}

export interface Rating {
  /** Big blinds given up across every postflop decision. */
  cost: number;
  decisions: number;
  /**
   * The expected value that was actually on offer: for each decision, the gap
   * between its best action and its worst. A decision where every action is
   * worth the same tests nothing and contributes nothing here.
   */
  atStake: number;
  /** The share of that you kept. Null when nothing was on offer all hand. */
  kept: number | null;
  /**
   * Decisions that were played but not priced, because the solver had no
   * strategy to price them against. See `priceable`.
   */
  unpriced: number;
  preflop: Verdict | null;
  grade: string;
}

export interface HandView {
  street: Street;
  cards: [Card, Card];
  board: Card[];
  pot: number;
  /** What each player has behind, for the table to show a stack. */
  stacks: { you: number; opponent: number };
  /** What each player has put out on this street, for the chips in front of a seat. */
  committed: { you: number; opponent: number };
  events: HandEvent[];
  choice: Choice | null;
  finished: boolean;
  rating: Rating;
  /** The solved strategy at your last decision. Null until you commit to one. */
  review: Review | null;
}

/** Solving a street. Injected so tests can run it in process and the app cannot. */
export type SubgameSolver = (request: SubgameRequest) => Promise<SubgameSolution>;

export const directSolver: SubgameSolver = async (request) => solveSubgame(request);

export interface PlayOptions {
  rng?: () => number;
  solver?: SubgameSolver;
  /** Overrides for how hard the live solves work. Tests turn these right down. */
  iterations?: Partial<typeof LIVE_ITERATIONS>;
}

export class Hand {
  readonly source: SolvedFlopHand;
  readonly hero: Player;

  private readonly rng: () => number;
  private readonly solver: SubgameSolver;
  private readonly iterations: typeof LIVE_ITERATIONS;

  private street: Street = "preflop";
  private hands: HandSet;
  private ranges: [Float64Array, Float64Array];
  private heroIndex: number;
  private villainIndex: number;
  private readonly heroCards: [number, number];
  private readonly villainCards: [number, number];

  private strategies = new Map<number, StreetStrategy>();
  private node: TreeNode | null = null;

  /** Chips out on the street being played. */
  private onStreet: [number, number] = [0, 0];
  /** Chips from streets that have closed, equal for both since a street closes on a call. */
  private closed = 0;
  private board: number[];

  private readonly events: HandEvent[] = [];
  private choice: Choice | null = null;
  private finished = false;
  private review: Review | null = null;

  private cost = 0;
  private atStake = 0;
  private decisions = 0;
  private unpriced = 0;
  private preflopVerdict: Verdict | null = null;

  constructor(source: SolvedFlopHand, options: PlayOptions = {}) {
    this.source = source;
    this.hero = source.seats.hero;
    this.rng = options.rng ?? Math.random;
    this.solver = options.solver ?? directSolver;
    this.iterations = { ...LIVE_ITERATIONS, ...options.iterations };

    this.hands = source.hands;
    this.ranges = [Float64Array.from(source.ranges[0]), Float64Array.from(source.ranges[1])];
    this.board = [...source.hands.board];

    this.heroIndex = this.dealHero();
    this.villainIndex = pickCompatible(
      this.hands,
      this.ranges[other(this.hero)]!,
      this.heroIndex,
      this.rng,
    );
    this.heroCards = [this.hands.cardA[this.heroIndex]!, this.hands.cardB[this.heroIndex]!];
    this.villainCards = [
      this.hands.cardA[this.villainIndex]!,
      this.hands.cardB[this.villainIndex]!,
    ];

    // The blinds are already out there, so they are what each seat has on the
    // street before anybody acts.
    this.onStreet = [postedBy(source, OOP), postedBy(source, IP)];
    this.events.push({ kind: "street", name: "preflop", board: [], pot: this.pot() });
    if (this.hero !== source.seats.raiser) {
      // The opener acts first, so if you are defending you are already facing a
      // raise by the time you see your cards.
      const villain = other(this.hero);
      this.push(
        "opponent",
        "preflop",
        `opens to ${formatChips(source.seats.openTo)}`,
        "raise",
        source.seats.openTo - this.onStreet[villain]!,
        null,
        "",
      );
      this.onStreet[villain] = source.seats.openTo;
    }
    this.choice = this.preflopChoice();
  }

  view(): HandView {
    return {
      street: this.street,
      cards: [intToCard(this.heroCards[0]), intToCard(this.heroCards[1])],
      // The flop is known from the moment the scenario loads, but it has not
      // been dealt until it has been dealt.
      board: this.street === "preflop" ? [] : this.board.map(intToCard),
      stacks: {
        you: STARTING_STACK - this.closed - this.onStreet[this.hero]!,
        opponent: STARTING_STACK - this.closed - this.onStreet[other(this.hero)]!,
      },
      committed: {
        you: this.onStreet[this.hero]!,
        opponent: this.onStreet[other(this.hero)]!,
      },
      pot: this.pot(),
      events: [...this.events],
      choice: this.choice,
      finished: this.finished,
      rating: this.rating(),
      review: this.review,
    };
  }

  /** Take an action. Resolves once everything it set off has been resolved. */
  async act(index: number): Promise<number> {
    if (!this.choice || this.finished) return 0;
    if (this.street === "preflop") return this.actPreflop(index);

    const node = this.node;
    if (!node || node.kind !== "player") return 0;

    const strategy = this.strategy(node);
    const priced = this.priceable(node);
    const cost = priced ? this.costAt(node, index) : 0;

    if (priced) {
      this.cost += cost;
      this.atStake += this.spreadAt(node);
      this.decisions++;
    } else {
      this.unpriced++;
    }

    this.review = {
      actions: strategy.actions,
      frequency: strategy.frequency,
      // Snapshotted before narrowing, so the grid shows the range you were
      // deciding with rather than the one your own action just implied.
      weight: Float64Array.from(this.ranges[node.player]!),
      hands: this.hands,
      street: this.street,
    };

    const action = node.actions[index]!;
    this.push(
      "you",
      this.street,
      strategy.actions[index]!.label,
      action.kind,
      action.to - this.onStreet[node.player]!,
      priced ? cost : null,
      priced ? this.mixAt(node) : "",
    );

    this.narrow(node, index);
    this.step(node, index);
    this.choice = null;
    await this.advance();
    return cost;
  }

  // -------------------------------------------------------------------------
  // Preflop
  // -------------------------------------------------------------------------

  /**
   * The money in the middle that belongs to neither player: blinds posted by
   * seats that folded. Everything else in the pot is one of the two stacks.
   */
  private get dead(): number {
    return this.source.seats.pot - 2 * this.source.seats.openTo;
  }

  private preflopSpot(): Spot {
    const { scenario } = this.source;
    const cards: [Card, Card] = [intToCard(this.heroCards[0]), intToCard(this.heroCards[1])];
    const hand = handClassOf(cards[0], cards[1]);

    return this.hero === this.source.seats.raiser
      ? { kind: "rfi", position: scenario.opener, depth: 100, cards, hand }
      : {
          kind: "vs-open",
          opener: scenario.opener,
          position: scenario.defender,
          depth: 100,
          cards,
          hand,
        };
  }

  private preflopChoice(): Choice {
    const { seats, scenario } = this.source;
    const opening = this.hero === seats.raiser;
    const threeBet = threeBetSize(scenario.opener, scenario.defender, 100);

    // `to` is the total on the street, as it is everywhere else, so folding
    // leaves the blind where it already is rather than taking it back.
    const posted = postedBy(this.source, this.hero);
    const actions: ActionOption[] = opening
      ? [
          { kind: "fold", label: "Fold", to: posted },
          { kind: "raise", label: `Open to ${formatChips(seats.openTo)}`, to: seats.openTo },
        ]
      : [
          { kind: "fold", label: "Fold", to: posted },
          { kind: "call", label: `Call ${formatChips(seats.openTo)}`, to: seats.openTo },
          { kind: "raise", label: `3-bet to ${formatChips(threeBet)}`, to: threeBet },
        ];

    return {
      street: "preflop",
      actions,
      pot: this.pot(),
      toCall: opening ? 0 : seats.openTo,
    };
  }

  private async actPreflop(index: number): Promise<number> {
    const { seats } = this.source;
    const chosen = this.choice!.actions[index]!;
    const answered: Action =
      chosen.kind === "fold" ? "fold" : chosen.kind === "call" ? "call" : "raise";

    this.preflopVerdict = judge(this.preflopSpot(), answered);
    this.push(
      "you",
      "preflop",
      chosen.label,
      chosen.kind,
      chosen.to - this.onStreet[this.hero]!,
      null,
      "",
    );
    this.onStreet[this.hero] = chosen.to;
    this.choice = null;

    const opening = this.hero === seats.raiser;
    const continues = opening ? answered === "raise" : answered === "call";

    if (!continues) {
      if (answered === "fold") {
        this.finish({
          ending: "folded-preflop",
          verdict: null,
          won: 0,
          // The blind is only lost if you had one out there to lose.
          staked: this.onStreet[this.hero]!,
          opponentHand: null,
          note: null,
        });
      } else {
        this.finish({
          ending: "off-line",
          verdict: null,
          won: 0,
          staked: 0,
          opponentHand: null,
          // A 3-bet can be the right play and often is, so the wording turns
          // on what the chart says rather than assuming a mistake. The hand
          // stops either way, and for a structural reason rather than a
          // judgement about it.
          note:
            this.preflopVerdict?.correct === true
              ? "The chart 3-bets this hand too. A 3-bet pot plays for different money against a different range, and this scenario was not solved for that one, so the hand stops here."
              : "A 3-bet pot plays for different money against a different range, and this scenario was not solved for that one. The hand stops here.",
        });
      }
      return 0;
    }

    if (opening) {
      const villain = other(this.hero);
      this.push(
        "opponent",
        "preflop",
        `calls ${formatChips(seats.openTo)}`,
        "call",
        seats.openTo - this.onStreet[villain]!,
        null,
        "",
      );
      this.onStreet[villain] = seats.openTo;
    }

    // Preflop closes with both players in for the open.
    this.closed = seats.openTo;
    this.onStreet = [0, 0];
    this.street = "flop";
    this.strategies = this.source.strategies;
    this.node = this.source.tree.root;
    this.events.push({ kind: "street", name: "flop", board: this.board.map(intToCard), pot: this.pot() });
    await this.advance();
    return 0;
  }

  // -------------------------------------------------------------------------
  // Postflop
  // -------------------------------------------------------------------------

  private strategy(node: PlayerNode): StreetStrategy {
    const found = this.strategies.get(node.id);
    if (!found) throw new Error(`No solved strategy at node ${node.id} on the ${this.street}`);
    return found;
  }

  private indexOf(player: Player): number {
    return player === this.hero ? this.heroIndex : this.villainIndex;
  }

  /**
   * Whether the solver has an opinion worth quoting about this hand, here.
   *
   * CFR averages the strategies it played weighted by how often each hand
   * arrived, so a hand with no weight at all accumulates no average and comes
   * back UNIFORM -- not "the solver checks half the time", but "nothing was
   * ever recorded". Measured on the shipped scenarios, actions the solver
   * appears to mix cost a mean of 0.001bb over hands the range holds and up to
   * eleven blinds over hands it does not, which is the same fact seen from the
   * other side.
   *
   * You can still play the hand. It is just not scored, and the screen says so
   * rather than billing you against a number that was never computed.
   */
  private priceable(node: PlayerNode): boolean {
    return this.ranges[node.player]![this.indexOf(node.player)]! > 0;
  }

  private costAt(node: PlayerNode, index: number): number {
    const { ev } = this.strategy(node);
    const stride = this.hands.count;
    const at = this.indexOf(node.player);

    let best = -Infinity;
    for (let a = 0; a < node.actions.length; a++) best = Math.max(best, ev[a * stride + at]!);
    return Math.max(0, best - ev[index * stride + at]!);
  }

  /** How much expected value the decision was worth getting right. */
  private spreadAt(node: PlayerNode): number {
    const { ev } = this.strategy(node);
    const stride = this.hands.count;
    const at = this.indexOf(node.player);

    let best = -Infinity;
    let worst = Infinity;
    for (let a = 0; a < node.actions.length; a++) {
      const value = ev[a * stride + at]!;
      best = Math.max(best, value);
      worst = Math.min(worst, value);
    }
    return Math.max(0, best - worst);
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

  /**
   * Bayes: whoever acted is now only holding hands that take that action.
   *
   * With the two guards the file header describes. Neither fires on a hand
   * played the way the solver plays it, and both keep a hand played some other
   * way from leaving the opponent with nothing to believe.
   */
  private narrow(node: PlayerNode, index: number): void {
    const { frequency } = this.strategy(node);
    const stride = this.hands.count;
    const range = this.ranges[node.player]!;

    const next = new Float64Array(stride);
    let total = 0;
    for (let h = 0; h < stride; h++) {
      next[h] = range[h]! * frequency[index * stride + h]!;
      total += next[h]!;
    }

    if (total <= 0) {
      // Nobody takes this action with anything, so it says nothing about the
      // range. Keep the range and mark that it got here by an unlikely road.
      for (let h = 0; h < stride; h++) next[h] = range[h]! * TRACE;
    } else {
      const own = this.indexOf(node.player);
      next[own] = Math.max(next[own]!, total * 1e-6);
    }

    this.ranges[node.player] = next;
  }

  private step(node: PlayerNode, index: number): void {
    this.onStreet[node.player] = node.actions[index]!.to;
    this.node = node.children[index]!;
  }

  private pot(): number {
    return this.dead + 2 * this.closed + this.onStreet[0] + this.onStreet[1];
  }

  /** Resolve everything that is not a decision of yours, until one is. */
  private async advance(): Promise<void> {
    for (let guard = 0; guard < 64; guard++) {
      const node = this.node;
      if (!node) return;

      if (node.kind === "fold") {
        this.finishFold(node.winner);
        return;
      }

      // Both mean the street is over: a flop or river tree ends its street with
      // a showdown, a turn tree ends it with the chance node that deals the
      // river. Which one it is depends on how many streets the tree covers, and
      // neither is anything to do with the hand being over.
      if (node.kind === "showdown" || node.kind === "chance") {
        if (this.street === "river") {
          this.finishShowdown();
          return;
        }
        await this.dealNextStreet();
        continue;
      }

      if (node.player === this.hero) {
        this.review = null;
        this.choice = this.choiceAt(node);
        return;
      }

      const index = this.sample(node);
      const action = node.actions[index]!;
      this.push(
        "opponent",
        this.street,
        this.strategy(node).actions[index]!.label,
        action.kind,
        action.to - this.onStreet[node.player]!,
        null,
        "",
      );
      this.narrow(node, index);
      this.step(node, index);
    }
    throw new Error("The hand did not terminate");
  }

  private choiceAt(node: PlayerNode): Choice {
    const actions = this.strategy(node).actions;
    const passive = actions.find((a) => a.kind === "check" || a.kind === "fold");
    return {
      street: this.street,
      actions,
      pot: this.pot(),
      toCall: this.onStreet[other(this.hero)]! - (passive?.to ?? 0),
    };
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
   * Deal the next card and solve the street under it.
   *
   * The card cannot be one either player holds, which is the same reason the
   * chance weight in a turn solve is one in forty four and not one in forty
   * eight: the dealer's deck has more cards in it than the players can see
   * come.
   */
  private async dealNextStreet(): Promise<void> {
    // The street closed, so both players have matched. Bank it.
    this.closed += this.onStreet[0]!;
    this.onStreet = [0, 0];

    const taken = new Set([...this.board, ...this.heroCards, ...this.villainCards]);
    const deck: number[] = [];
    for (let card = 0; card < 52; card++) if (!taken.has(card)) deck.push(card);
    this.board = [...this.board, deck[Math.floor(this.rng() * deck.length)]!];

    this.street = STREETS[STREETS.indexOf(this.street) + 1]!;
    const complete = this.board.length === 5;

    // Carry the narrowed ranges into the new board's index space. Hands holding
    // the card that just came stop existing.
    const all = buildHandSet(this.board, complete);
    const carried: [Float64Array, Float64Array] = [
      new Float64Array(all.count),
      new Float64Array(all.count),
    ];
    for (let h = 0; h < this.hands.count; h++) {
      const at = all.indexOf(this.hands.cardA[h]!, this.hands.cardB[h]!);
      if (at < 0) continue;
      carried[0][at] = this.ranges[0][h]!;
      carried[1][at] = this.ranges[1][h]!;
    }

    const heroAt = all.indexOf(this.heroCards[0], this.heroCards[1]);
    const villainAt = all.indexOf(this.villainCards[0], this.villainCards[1]);
    const compact = compactToLive(all, carried, { keep: [heroAt, villainAt] });

    this.hands = compact.hands;
    this.ranges = compact.ranges;
    this.heroIndex = compact.hands.indexOf(this.heroCards[0], this.heroCards[1]);
    this.villainIndex = compact.hands.indexOf(this.villainCards[0], this.villainCards[1]);

    const pot = this.dead + 2 * this.closed;
    const stack = STARTING_STACK - this.closed;
    this.events.push({ kind: "street", name: this.street, board: this.board.map(intToCard), pot });

    // Nothing behind means nothing to decide: the rest of the board runs out
    // and the hands are tabled. Building a betting tree on an empty stack would
    // offer a bet neither player has.
    if (stack <= 0) {
      this.strategies = new Map();
      this.node = complete ? { kind: "showdown", amount: 0 } : null;
      if (!complete) await this.dealNextStreet();
      return;
    }

    const combos: number[] = [];
    for (let h = 0; h < compact.hands.count; h++) {
      combos.push(compact.hands.cardA[h]!, compact.hands.cardB[h]!);
    }

    const solution = await this.solver({
      board: [...this.board],
      combos,
      ranges: [[...compact.ranges[0]], [...compact.ranges[1]]],
      pot,
      stack,
      iterations: complete ? this.iterations.river : this.iterations.turn,
    });

    const tree = subgameTree(this.board, pot, stack);
    const byPath = streetNodesByPath(tree);
    this.strategies = new Map();
    for (const stored of solution.nodes) {
      const node = byPath.get(stored.path);
      if (!node) throw new Error(`Solved a node at "${stored.path}" the tree does not have`);
      this.strategies.set(node.id, {
        actions: stored.actions,
        player: node.player,
        frequency: Float64Array.from(stored.frequency),
        ev: Float64Array.from(stored.ev),
      });
    }

    this.node = tree.root;
  }

  // -------------------------------------------------------------------------
  // Finishing
  // -------------------------------------------------------------------------

  private finishFold(winner: Player): void {
    const { heroIn, total } = this.contributions();

    this.finish({
      ending: "fold",
      verdict: winner === this.hero ? "win" : "lose",
      won: winner === this.hero ? total : 0,
      staked: heroIn,
      opponentHand: [intToCard(this.villainCards[0]), intToCard(this.villainCards[1])],
      note: null,
    });
  }

  private finishShowdown(): void {
    const hero = evaluate7([...this.board, ...this.heroCards]);
    const villain = evaluate7([...this.board, ...this.villainCards]);
    const verdict = hero > villain ? "win" : hero < villain ? "lose" : "split";
    const { heroIn, total } = this.contributions();

    this.finish({
      ending: "showdown",
      verdict,
      won: verdict === "win" ? total : verdict === "split" ? total / 2 : 0,
      staked: heroIn,
      opponentHand: [intToCard(this.villainCards[0]), intToCard(this.villainCards[1])],
      note: null,
    });
  }

  /**
   * What each player put in, and what the pot therefore holds.
   *
   * The winner takes the dead money plus both contributions, which is the whole
   * pot; a split halves it. Reported as a pot rather than a profit because that
   * is how a poker player reads a hand: you won a nine blind pot, or you lost
   * the four you put in.
   */
  private contributions(): { heroIn: number; villainIn: number; total: number } {
    const heroIn = this.closed + this.onStreet[this.hero]!;
    const villainIn = this.closed + this.onStreet[other(this.hero)]!;
    return { heroIn, villainIn, total: this.dead + heroIn + villainIn };
  }

  private finish(result: Omit<Extract<HandEvent, { kind: "result" }>, "kind">): void {
    this.events.push({ kind: "result", ...result });
    this.finished = true;
    this.choice = null;
  }

  private rating(): Rating {
    const kept = this.atStake > 1e-9 ? 1 - this.cost / this.atStake : null;
    return {
      cost: this.cost,
      decisions: this.decisions,
      atStake: this.atStake,
      kept,
      unpriced: this.unpriced,
      preflop: this.preflopVerdict,
      grade: gradeOf(kept, this.unpriced),
    };
  }

  // -------------------------------------------------------------------------

  private push(
    who: "you" | "opponent",
    street: Street,
    label: string,
    action: ActionKind,
    added: number,
    cost: number | null,
    mix: string,
  ): void {
    // `pot()` still reads the state before the action, so the pot the event
    // carries is the one the chips land in.
    this.events.push({
      kind: "acted",
      who,
      street,
      label,
      action,
      added,
      pot: this.pot() + added,
      cost,
      mix,
    });
  }

  /**
   * Which hand you get.
   *
   * Weighted toward hands your seat continues with, because the mode exists to
   * play hands out, but not entirely: a quarter of the time it deals a hand
   * from the part of the board's range your seat folds, so that folding is
   * still a real answer rather than a button nobody ever presses.
   */
  private dealHero(): number {
    const mine = this.ranges[this.hero]!;
    if (this.rng() < CONTINUE_BIAS) return pick(mine, this.rng);

    const folded = new Float64Array(mine.length);
    let total = 0;
    for (let h = 0; h < mine.length; h++) {
      folded[h] = mine[h]! > 0 ? 0 : 1;
      total += folded[h]!;
    }
    return total > 0 ? pick(folded, this.rng) : pick(mine, this.rng);
  }
}

/**
 * What the rating reads as.
 *
 * The bands are a judgement call and the number above them is not, which is
 * why the screen shows both. Keeping 90% of the expected value that was
 * genuinely on offer across a hand is good play; keeping half of it is not.
 */
export function gradeOf(kept: number | null, unpriced = 0): string {
  // "Nothing to get wrong" and "nothing we can tell you" are different answers
  // and would otherwise read the same.
  if (kept === null) return unpriced > 0 ? "Not scored" : "Nothing to get wrong";
  if (kept >= 0.98) return "Solver";
  if (kept >= 0.9) return "Sharp";
  if (kept >= 0.75) return "Solid";
  if (kept >= 0.5) return "Loose";
  return "Spewed";
}

/** The blind a seat has already posted, which is money it does not have to call. */
function postedBy(source: SolvedFlopHand, player: Player): number {
  return blindPostedBy(
    player === source.seats.raiser ? source.scenario.opener : source.scenario.defender,
  );
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
