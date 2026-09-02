/**
 * A whole hand: a preflop line, a flop, and the game that follows.
 *
 * The postflop spots in `spots.ts` start on the turn with a story about how the
 * hand got there. This does not need a story, because the hand gets there by
 * being played. What a scenario fixes is the seat, the opponent's seat, and the
 * three cards on the flop; everything else -- the two ranges, the pot, the
 * stacks -- is derived from the preflop charts and the sizing rules this repo
 * already has, so a scenario is about a dozen lines and no invented numbers.
 *
 * Everything is in big blinds, which is the unit the preflop half of the
 * trainer already speaks. A hundred big blind stack opens to two and a half and
 * gets called, so the flop is played for five and a half into ninety seven and
 * a half, and every number after that follows from the bet sizes.
 */

import { RFI_BY_DEPTH } from "../charts/rfi";
import { VS_OPEN_100BB } from "../charts/vs-open";
import { parseCards } from "../equity";
import { parseRange } from "../range";
import { BIG_BLIND, SMALL_BLIND, inPositionOn, openSize } from "../sizing";
import type { Position, RfiPosition } from "../positions";
import {
  buildHandSet,
  buildRunoutViews,
  compactToLive,
  deckAfter,
  riverChanceWeight,
  weightsFromClasses,
  type HandSet,
  type RiverView,
} from "../solver/hands";
import {
  buildStreets,
  DEFAULT_BETTING,
  IP,
  OOP,
  type BettingConfig,
  type Player,
  type Tree,
} from "../solver/tree";

/**
 * Bet sizes for a hand played out over three streets.
 *
 * One size and no raises per street, which is a much tighter action abstraction
 * than the turn-only spots use, and it is not a preference. A flop solve deals
 * forty nine turns under every flop line and forty eight rivers under every
 * turn line, so the river betting round is instantiated twenty one thousand
 * times: every extra branch there is multiplied by that. Two sizes on the flop
 * alone would be two thirds again as much work for the whole solve.
 *
 * This is the approximation `docs/postflop-solver.md` calls the one that
 * usually matters more than card abstraction, and it is stated here rather than
 * buried so it can be swept later.
 */
export const FULL_HAND_BETTING = {
  flop: { betSizes: [0.5], raiseSizes: [], maxBets: 1, allInSnap: DEFAULT_BETTING.allInSnap },
  turn: { betSizes: [0.75], raiseSizes: [], maxBets: 1, allInSnap: DEFAULT_BETTING.allInSnap },
  river: { betSizes: [0.75], raiseSizes: [], maxBets: 1, allInSnap: DEFAULT_BETTING.allInSnap },
} satisfies Record<string, Omit<BettingConfig, "startingPot" | "effectiveStack">>;

/**
 * The river, once it is the only street left, is solved on its own from the
 * ranges the hand produced, and can afford a wider tree than the one the flop
 * solve had to model it with. See `playthrough.ts`.
 */
export const LIVE_RIVER_BETTING = {
  betSizes: [0.33, 0.75],
  raiseSizes: [1],
  maxBets: 2,
  allInSnap: DEFAULT_BETTING.allInSnap,
} satisfies Omit<BettingConfig, "startingPot" | "effectiveStack">;

export const STARTING_STACK = 100;

export interface Scenario {
  id: string;
  label: string;
  /** Why this flop is worth playing. Shown under the table. */
  note: string;
  /** Three cards. */
  flop: string;
  opener: RfiPosition;
  defender: Position;
  /** Which of the two seats you sit in. */
  hero: "opener" | "defender";
}

export const SCENARIOS: Scenario[] = [
  {
    id: "bb-defends-two-tone",
    label: "Big blind, two tone flop",
    flop: "Ks 9h 4h",
    opener: "BTN",
    defender: "BB",
    hero: "defender",
    note: "A king that hits the button's range far harder than yours, and a flush draw that does not care. Out of position with the weaker range is the most common seat in poker.",
  },
  {
    id: "btn-opens-dry",
    label: "Button, dry ace flop",
    flop: "Ad 8c 3s",
    opener: "BTN",
    defender: "BB",
    hero: "opener",
    note: "Nothing draws to anything and you hold every ace the big blind folded. The whole hand is about betting small enough that the price is wrong to defend.",
  },
  {
    id: "bb-defends-low-connected",
    label: "Big blind, low connected flop",
    flop: "9c 7d 5h",
    opener: "CO",
    defender: "BB",
    hero: "defender",
    note: "The one flop where the caller's range is the stronger one. Every card in it is a card you kept and the cutoff folded, which is why the checking is not all yours.",
  },
  {
    id: "co-opens-broadway",
    label: "Cutoff, broadway flop",
    flop: "Qs Jd 7c",
    opener: "CO",
    defender: "BB",
    hero: "opener",
    note: "Both players hold queens and jacks, so nobody can claim the board. Ranges this symmetric are where bet sizing stops being about strength.",
  },
  {
    id: "btn-opens-paired",
    label: "Button, paired flop",
    flop: "8h 8d 3c",
    opener: "BTN",
    defender: "BB",
    hero: "opener",
    note: "Almost nothing connects and almost nothing improves, so a hand is worth what it can represent. The cleanest bluffing texture there is.",
  },
  {
    id: "bb-defends-monotone",
    label: "Big blind, monotone flop",
    flop: "Jc 8c 4c",
    opener: "BTN",
    defender: "BB",
    hero: "defender",
    note: "Three clubs. Holding one is worth more than most made hands, because it takes the flush away from exactly the hands that would keep calling.",
  },
];

export const SCENARIOS_BY_ID: ReadonlyMap<string, Scenario> = new Map(
  SCENARIOS.map((scenario) => [scenario.id, scenario]),
);

// ---------------------------------------------------------------------------
// What the preflop line implies
// ---------------------------------------------------------------------------

export interface Seats {
  /** Ranges by seat, indexed the way the solver indexes players. */
  ranges: [string, string];
  /** Which seat the hero sits in. */
  hero: Player;
  /** Which seat opened, for the story and for the preflop screen. */
  raiser: Player;
  pot: number;
  stack: number;
  openTo: number;
}

/**
 * The pot the flop is played for, counted rather than looked up.
 *
 * The opener raises to `r` and the defender calls it, so both have `r` in. What
 * is left is whatever the blinds put in and abandoned, which depends on whether
 * the defender is one of them.
 */
export function seatsOf(scenario: Scenario): Seats {
  const openTo = openSize(scenario.opener, 100);
  const entry = VS_OPEN_100BB[scenario.opener][scenario.defender];
  if (!entry) {
    throw new Error(`${scenario.id}: no chart for ${scenario.defender} against ${scenario.opener}`);
  }

  let dead = SMALL_BLIND + BIG_BLIND;
  if (scenario.defender === "SB") dead = BIG_BLIND;
  if (scenario.defender === "BB") dead = SMALL_BLIND;
  if (scenario.opener === "SB") dead = 0;

  const openerIsIp = inPositionOn(scenario.opener, scenario.defender);
  const raiser: Player = openerIsIp ? IP : OOP;
  const ranges: [string, string] = openerIsIp
    ? [entry.call, RFI_BY_DEPTH[100][scenario.opener]]
    : [RFI_BY_DEPTH[100][scenario.opener], entry.call];

  return {
    ranges,
    raiser,
    hero: scenario.hero === "opener" ? raiser : raiser === OOP ? IP : OOP,
    pot: 2 * openTo + dead,
    stack: STARTING_STACK - openTo,
    openTo,
  };
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

export interface FlopGame {
  scenario: Scenario;
  seats: Seats;
  hands: HandSet;
  ranges: [Float64Array, Float64Array];
  tree: Tree;
  /** Set 0 is the turn; set `1 + t` is the river under turn card `t`. */
  viewSets: RiverView[][];
  /** The cards that can come on the turn, in the order the chance node deals them. */
  turnCards: number[];
  /** The cards that can come on each river, by turn index. */
  riverCards: number[][];
}

/**
 * Build the three street game a scenario describes.
 *
 * The hand set is compacted to the combinations either range holds, which on a
 * flop takes 1176 down to roughly 800 and costs nothing: see `compactToLive`.
 * Every loop in the solver and every one of the 21,168 river subgames is that
 * much narrower.
 */
export function buildFlopGame(scenario: Scenario): FlopGame {
  const board = parseCards(scenario.flop);
  if (board.length !== 3) {
    throw new Error(`${scenario.id}: a flop is three cards, got ${board.length}`);
  }

  const seats = seatsOf(scenario);
  const all = buildHandSet(board, false);
  const compact = compactToLive(all, [
    weightsFromClasses(all, parseRange(seats.ranges[0])),
    weightsFromClasses(all, parseRange(seats.ranges[1])),
  ]);

  const hands = compact.hands;
  const turnCards = deckAfter(board);
  const viewSets: RiverView[][] = [buildRunoutViews(hands)];
  const riverCards: number[][] = [];
  for (const turn of turnCards) {
    viewSets.push(buildRunoutViews(hands, [turn]));
    riverCards.push(deckAfter([...board, turn]));
  }

  const tree = buildStreets(
    { ...FULL_HAND_BETTING.flop, startingPot: seats.pot, effectiveStack: seats.stack },
    [
      {
        cards: turnCards.length,
        chanceWeight: riverChanceWeight(board.length),
        betting: FULL_HAND_BETTING.turn,
        viewSet: () => 0,
      },
      {
        cards: turnCards.length - 1,
        chanceWeight: riverChanceWeight(board.length + 1),
        betting: FULL_HAND_BETTING.river,
        viewSet: (dealt) => 1 + dealt[0]!,
      },
    ],
  );

  return {
    scenario,
    seats,
    hands,
    ranges: compact.ranges,
    tree,
    viewSets,
    turnCards,
    riverCards,
  };
}
