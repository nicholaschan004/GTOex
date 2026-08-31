/**
 * The postflop spots the trainer drills.
 *
 * A preflop spot is a seat and a stack depth, and there are eighty of them. A
 * postflop spot is a board, two ranges, a pot, a stack, a set of legal bet
 * sizes and a point in the betting where you have to decide, and there are
 * effectively infinitely many. So these are hand-picked rather than enumerated,
 * and each one is chosen because it teaches something a chart cannot.
 *
 * The ranges are not invented. They come from this repo's own preflop charts:
 * the button's opening range and the big blind's calling range against it are
 * the same strings the preflop trainer drills, expanded to combinations once
 * the board takes some of the cards away. That join is the point. A postflop
 * spot that started from a range nobody would actually have is a spot nobody
 * will ever be in.
 */

import { parseRange } from "../range";
import { parseCards } from "../equity";
import { RFI_BY_DEPTH } from "../charts/rfi";
import { VS_OPEN_100BB } from "../charts/vs-open";
import { buildHandSet, buildRiverViews, weightsFromClasses, type HandSet, type RiverView } from "../solver/hands";
import { buildTree, buildTurnTree, DEFAULT_BETTING, IP, OOP, type BettingConfig, type PlayerNode, type Player, type Tree } from "../solver/tree";
import { riverChanceWeight } from "../solver/hands";

/** Preflop lines the postflop spots start from, so the ranges are ones people hold. */
const PREFLOP = {
  btnOpen: RFI_BY_DEPTH[100].BTN,
  bbCallsBtn: VS_OPEN_100BB.BTN.BB!.call,
  coOpen: RFI_BY_DEPTH[100].CO,
  btnCallsCo: VS_OPEN_100BB.CO.BTN!.call,
  bbCallsCo: VS_OPEN_100BB.CO.BB!.call,
} as const;

export interface SpotDefinition {
  id: string;
  /** How the spot reads in one line. */
  label: string;
  street: "turn" | "river";
  board: string;
  /** Why this spot is worth drilling. Shown under the table. */
  note: string;
  oopRange: string;
  ipRange: string;
  /** Which seat you are sitting in. */
  hero: Player;
  /** How the hand reached the turn. Fixed, because the flop is not solved. */
  story: string;
  pot: number;
  stack: number;
}

/**
 * Bet sizes, kept small on purpose.
 *
 * Every size added multiplies the tree, and for a river solved live in the
 * browser the whole budget is a few hundred milliseconds. Two sizes and one
 * raise is enough for the strategy to have real structure without the solve
 * outrunning the time between one hand and the next. This is action
 * abstraction, and it is a real approximation: see docs/postflop-solver.md.
 */
export const RIVER_BETTING: Omit<BettingConfig, "startingPot" | "effectiveStack"> = {
  betSizes: [0.33, 0.75],
  raiseSizes: [1],
  maxBets: 2,
  allInSnap: DEFAULT_BETTING.allInSnap,
};

/** Tighter still on the turn, because each turn node costs 48 river subgames. */
export const TURN_BETTING: Omit<BettingConfig, "startingPot" | "effectiveStack"> = {
  betSizes: [0.6],
  raiseSizes: [1],
  maxBets: 1,
  allInSnap: DEFAULT_BETTING.allInSnap,
};

/**
 * Scenarios, each played from the turn to the end.
 *
 * A hand here is not a question with an answer, it is a situation you play out,
 * so a spot no longer names a decision point. It names a board, two ranges and
 * a pot, and the line is whatever the two of you do from there.
 *
 * The `line` field is gone for the same reason. What is left is the story of
 * how the hand got to the turn, which is fixed because the flop cannot be
 * solved here and pretending otherwise would be inventing a strategy.
 */
export const SPOTS: SpotDefinition[] = [
  {
    id: "turn-two-tone",
    label: "Drawing turn, out of position",
    street: "turn",
    board: "Ks Jc 9h 7d",
    note: "Every straight draw in the deck got there or nearly did, so a hand is worth the spread of what it becomes rather than what it is.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: OOP,
    story: "You defended the big blind, the button bet the flop, you called. The turn is a card everybody likes.",
    pot: 40,
    stack: 130,
  },
  {
    id: "turn-dry",
    label: "Dry turn, in position",
    street: "turn",
    board: "Ad 8c 3h 2s",
    note: "Nothing draws to anything. With no cards left to fear, the hand is about who holds an ace and who can convincingly claim to.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: IP,
    story: "You opened the button, the big blind called, and the flop checked through.",
    pot: 36,
    stack: 140,
  },
  {
    id: "turn-paired",
    label: "Paired turn, out of position",
    street: "turn",
    board: "Qs 7d 7h 2c",
    note: "The board pairs and almost nothing improves. A hand with no showdown value is worth exactly what it can represent, which is the cleanest bluffing spot there is.",
    oopRange: PREFLOP.bbCallsCo,
    ipRange: PREFLOP.coOpen,
    hero: OOP,
    story: "You called a cutoff open from the big blind and checked the flop through.",
    pot: 26,
    stack: 150,
  },
  {
    id: "turn-connected",
    label: "Connected turn, in position",
    street: "turn",
    board: "9c 8d 7s 2h",
    note: "Both ranges hit this hard and every card can change who is ahead, which is why the sizes the solver picks are not the ones intuition picks.",
    oopRange: PREFLOP.bbCallsCo,
    ipRange: PREFLOP.coOpen,
    hero: IP,
    story: "You opened the cutoff, the big blind called, and you both checked the flop.",
    pot: 28,
    stack: 160,
  },
  {
    id: "turn-monotone",
    label: "Monotone flop, out of position",
    street: "turn",
    board: "Qh 8h 5h 2c",
    note: "Three hearts on the flop and a blank turn. Holding one heart is worth more than most made hands here, because it takes the flush away from the hands that would call.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: OOP,
    story: "You defended the big blind and called a bet on the monotone flop.",
    pot: 44,
    stack: 128,
  },
  {
    id: "turn-flush-arrives",
    label: "The flush arrives, in position",
    street: "turn",
    board: "As Ts 6d 3s",
    note: "The third spade lands on the turn. Everything that was a draw is now either the nuts or nothing, and both ranges know it.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: IP,
    story: "You opened the button, the big blind called and called your flop bet. The turn brings a third spade.",
    pot: 46,
    stack: 125,
  },
  {
    id: "turn-broadway-oop-raiser",
    label: "Broadway board, raiser out of position",
    street: "turn",
    board: "Ac Kd Qh 4s",
    note: "The only scenario here where the preflop raiser is the one out of position, and it changes everything: the stronger range has to act first, which is worth less than it sounds.",
    oopRange: PREFLOP.coOpen,
    ipRange: PREFLOP.btnCallsCo,
    hero: OOP,
    story: "You opened the cutoff, the button called, and you both checked the broadway flop.",
    pot: 22,
    stack: 165,
  },
  {
    id: "turn-low-dry",
    label: "Low board, in position",
    street: "turn",
    board: "7c 5d 2h 9s",
    note: "Nobody has anything and nobody can have much. When neither range connects, the pot goes to whoever is willing to bet for it.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: IP,
    story: "You opened the button, the big blind called, and the flop checked through.",
    pot: 20,
    stack: 170,
  },
  {
    id: "turn-overcard",
    label: "Overcard turn, out of position",
    street: "turn",
    board: "8d 6c 3h Ks",
    note: "The king hits the range that raised preflop and misses the one that called. A card that is good for your opponent is not automatically a card you give up on.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: OOP,
    story: "You called from the big blind and the low flop checked through. The turn is a king.",
    pot: 20,
    stack: 170,
  },
  {
    id: "turn-low-spr",
    label: "Big pot, short stack",
    street: "turn",
    board: "Jh 9c 4d Qs",
    note: "Less than a pot behind, so a bet is the whole stack and there is no third decision. Everything compresses into one call or fold, which is a different game to a deep one.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: OOP,
    story: "You check-raised the flop and the button called. You have less than a pot behind.",
    pot: 90,
    stack: 62,
  },
];

export const SPOTS_BY_ID: ReadonlyMap<string, SpotDefinition> = new Map(
  SPOTS.map((spot) => [spot.id, spot]),
);

export interface BuiltSpot {
  definition: SpotDefinition;
  hands: HandSet;
  /** Only on a turn spot. */
  views: RiverView[] | undefined;
  tree: Tree;
  ranges: [Float64Array, Float64Array];
  /** The node the hero is being asked about. */
  node: PlayerNode;
}

/**
 * `withViews: false` skips the per-river showdown ranks.
 *
 * Playing a hand out needs the turn TREE but never the forty eight rank views,
 * because it solves the one river that actually comes rather than all of them.
 * Building them anyway is 54,000 hand evaluations and half a megabyte for
 * nothing, on a screen someone is waiting at.
 */
export function buildSpot(
  definition: SpotDefinition,
  { withViews = true }: { withViews?: boolean } = {},
): BuiltSpot {
  const board = parseCards(definition.board);
  const expected = definition.street === "river" ? 5 : 4;
  if (board.length !== expected) {
    throw new Error(`${definition.id}: a ${definition.street} needs ${expected} board cards`);
  }

  const hands = buildHandSet(board, definition.street === "river");
  const ranges: [Float64Array, Float64Array] = [
    weightsFromClasses(hands, parseRange(definition.oopRange)),
    weightsFromClasses(hands, parseRange(definition.ipRange)),
  ];

  let views: RiverView[] | undefined;
  let tree: Tree;

  if (definition.street === "river") {
    tree = buildTree({
      ...RIVER_BETTING,
      startingPot: definition.pot,
      effectiveStack: definition.stack,
    });
  } else {
    // One river per card the board has not taken, whether or not the ranks for
    // them get computed.
    const rivers = 52 - board.length;
    if (withViews) views = buildRiverViews(hands);
    tree = buildTurnTree(
      { ...TURN_BETTING, startingPot: definition.pot, effectiveStack: definition.stack },
      TURN_BETTING,
      rivers,
      riverChanceWeight(board.length),
    );
  }

  return {
    definition,
    hands,
    views,
    tree,
    ranges,
    // Where the hand starts, which out of position always is.
    node: tree.root as PlayerNode,
  };
}
