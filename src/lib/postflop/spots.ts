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
  /** Who is being asked to act. */
  hero: Player;
  /**
   * Action indices from the root down to the decision. Empty means the root,
   * which is out of position first to act.
   */
  line: number[];
  /** How the line reads before you decide. */
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

export const SPOTS: SpotDefinition[] = [
  {
    id: "river-blank-btn-bb",
    label: "Big blind, river bricks",
    street: "river",
    board: "Ks 9h 4c 7d 2s",
    note: "Nothing got there. Both players have exactly what they had on the flop, so this is a pure question of who can represent the king.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: OOP,
    line: [],
    story: "You check-called the flop and the turn. The river bricks.",
    pot: 60,
    stack: 180,
  },
  {
    id: "river-flush-completes",
    label: "Button, the flush comes in",
    street: "river",
    board: "Ah 8h 3c Jd 6h",
    note: "The third heart lands on the river. Which hands hold one matters more than which hands are strong, because a lone heart blocks the hands that can call.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: IP,
    line: [0],
    story: "The big blind checks the river to you.",
    pot: 55,
    stack: 170,
  },
  {
    id: "river-paired-board",
    label: "Facing a bet on a paired river",
    street: "river",
    board: "Qs 7d 7h 2c Qc",
    note: "Two pair on the board, so almost nothing beats a queen and almost everything beats nothing. A hand with no showdown value is worth exactly what it can represent.",
    oopRange: PREFLOP.bbCallsCo,
    ipRange: PREFLOP.coOpen,
    hero: OOP,
    line: [0, 2],
    story: "You check, and the cutoff bets three quarters of the pot.",
    pot: 44,
    stack: 150,
  },
  {
    id: "river-straight-board",
    label: "Button on a four-straight river",
    street: "river",
    board: "9c 8d 7s 2h Ts",
    note: "The board makes a straight by itself with a jack or a six. Both ranges hit this hard, which is why the sizes the solver picks are not the ones intuition picks.",
    oopRange: PREFLOP.bbCallsCo,
    ipRange: PREFLOP.coOpen,
    hero: IP,
    line: [0],
    story: "Checked to you on the river.",
    pot: 48,
    stack: 160,
  },
  {
    id: "turn-two-tone",
    label: "Big blind on a drawing turn",
    street: "turn",
    board: "Ks Jc 9h 7d",
    note: "Every straight draw in the deck got there or nearly did. A hand's value is not what it is now, it is the spread of what it becomes.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: OOP,
    line: [],
    story: "You check-called the flop. The turn brings a card everyone likes.",
    pot: 40,
    stack: 130,
  },
  {
    id: "turn-dry",
    label: "Button on a dry turn",
    street: "turn",
    board: "Ad 8c 3h 2s",
    note: "Nothing draws to anything. With no cards left to fear, the turn is about who holds an ace and who can convincingly claim to.",
    oopRange: PREFLOP.bbCallsBtn,
    ipRange: PREFLOP.btnOpen,
    hero: IP,
    line: [0],
    story: "The big blind checks the turn to you.",
    pot: 36,
    stack: 140,
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

/** Walk the line from the root and check it lands somewhere the hero acts. */
function nodeAtLine(tree: Tree, line: number[], hero: Player): PlayerNode {
  let node = tree.root;
  for (const index of line) {
    if (node.kind !== "player") throw new Error("The line runs past a decision");
    const next = node.children[index];
    if (!next) throw new Error(`No action ${index} at that point in the tree`);
    node = next;
  }
  if (node.kind !== "player") throw new Error("The line ends somewhere nobody acts");
  if (node.player !== hero) throw new Error("The line ends on the wrong player");
  return node;
}

export function buildSpot(definition: SpotDefinition): BuiltSpot {
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
    views = buildRiverViews(hands);
    tree = buildTurnTree(
      { ...TURN_BETTING, startingPot: definition.pot, effectiveStack: definition.stack },
      TURN_BETTING,
      views.length,
      riverChanceWeight(board.length),
    );
  }

  return {
    definition,
    hands,
    views,
    tree,
    ranges,
    node: nodeAtLine(tree, definition.line, definition.hero),
  };
}
