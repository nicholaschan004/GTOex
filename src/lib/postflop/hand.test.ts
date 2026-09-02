import { describe, expect, it } from "vitest";
import { Hand, gradeOf, type HandEvent, type HandView } from "./hand";
import { buildFlopShell, type SolvedFlopHand } from "./flop-data";
import { SCENARIOS_BY_ID } from "./scenario";
import { describeActions, type StreetStrategy } from "./decision";
import { streetNodesByPath } from "../solver/tree";
import { evaluate7, parseCards } from "../equity";
import { mulberry32 } from "../rng";
import { BIG_BLIND, SMALL_BLIND } from "../sizing";

/**
 * A scenario with a made up flop strategy.
 *
 * The engine's job is accounting, dealing, narrowing and scoring, and none of
 * that depends on the strategy being a good one. Solving a real flop is a
 * quarter of an hour, so the tests that are about the engine use this and the
 * ones that are about the solve use the shipped data.
 */
function synthetic(id: string): SolvedFlopHand {
  const shell = buildFlopShell(SCENARIOS_BY_ID.get(id)!);
  const strategies = new Map<number, StreetStrategy>();

  for (const node of streetNodesByPath(shell.tree).values()) {
    const actions = node.actions.length;
    const n = shell.hands.count;
    const frequency = new Float64Array(actions * n).fill(1 / actions);
    const ev = new Float64Array(actions * n);
    // Deterministic and varied, so there is a best action and it is not always
    // the same one.
    for (let h = 0; h < n; h++) {
      for (let a = 0; a < actions; a++) ev[a * n + h] = ((h * 7 + a * 13) % 11) / 10;
    }
    strategies.set(node.id, { actions: describeActions(node), player: node.player, frequency, ev });
  }

  return { ...shell, strategies, exploitabilityPercent: 0 };
}

/** Rivers and turns get solved for real here, so they get solved barely. */
const FAST = { turn: 2, river: 2 };

/** Play a hand out, choosing with `choose`. */
async function play(
  source: SolvedFlopHand,
  rng: () => number,
  choose: (view: HandView) => number = () => 1,
): Promise<HandView> {
  const hand = new Hand(source, { rng, iterations: FAST });
  for (let step = 0; step < 16; step++) {
    const view = hand.view();
    if (view.finished || !view.choice) break;
    await hand.act(choose(view));
  }
  return hand.view();
}

const resultOf = (view: HandView) => {
  const found = view.events.find((event) => event.kind === "result");
  if (!found || found.kind !== "result") throw new Error("the hand produced no result");
  return found;
};

describe("before the flop", () => {
  const defending = synthetic("bb-defends-two-tone");
  const opening = synthetic("btn-opens-dry");

  it("puts you in the seat the scenario says, facing the right action", () => {
    const asDefender = new Hand(defending, { rng: mulberry32(1) }).view();
    expect(asDefender.choice!.actions.map((a) => a.kind)).toEqual(["fold", "call", "raise"]);
    // The opener has already acted, because the opener acts first.
    expect(asDefender.events.some((e) => e.kind === "acted" && e.who === "opponent")).toBe(true);

    const asOpener = new Hand(opening, { rng: mulberry32(1) }).view();
    expect(asOpener.choice!.actions.map((a) => a.kind)).toEqual(["fold", "raise"]);
    expect(asOpener.events.some((e) => e.kind === "acted")).toBe(false);
  });

  it("starts the pot at the blinds and reaches the solved pot once both are in", async () => {
    const hand = new Hand(defending, { rng: mulberry32(2), iterations: FAST });

    // The hand begins at the blinds, but you are defending, so by the time it
    // is your turn the opener's raise is already out there.
    const opened = hand.view().events[0]!;
    if (opened.kind !== "street") throw new Error("a hand starts by dealing a street");
    expect(opened.pot).toBeCloseTo(1.5, 9);
    expect(hand.view().pot).toBeCloseTo(1.5 + defending.seats.openTo, 9);

    await hand.act(1); // call
    const view = hand.view();
    expect(view.street).toBe("flop");
    // Which has to be the pot the flop was solved for, or every price after it
    // is quoted against a number the solver never saw.
    expect(view.pot).toBeCloseTo(defending.seats.pot, 9);
  });

  it("ends the hand when you fold, and charges you the blind you posted", async () => {
    const hand = new Hand(defending, { rng: mulberry32(3), iterations: FAST });
    await hand.act(0);

    const view = hand.view();
    expect(view.finished).toBe(true);
    const result = resultOf(view);
    expect(result.ending).toBe("folded-preflop");
    expect(result.staked).toBeCloseTo(1, 9);
    expect(result.won).toBe(0);
    expect(view.board).toHaveLength(0);
  });

  /**
   * A 3-bet is a legal action and can be the right one, but it plays for a
   * different pot against a different range, and this scenario was not solved
   * for that. Stopping and saying so is the honest end; inventing a flop
   * strategy for a pot nobody solved is not.
   */
  it("stops, rather than improvising, when you take it off the solved line", async () => {
    const hand = new Hand(defending, { rng: mulberry32(4), iterations: FAST });
    await hand.act(2);

    const result = resultOf(hand.view());
    expect(result.ending).toBe("off-line");
    expect(result.note).toMatch(/not solved/i);
    expect(hand.view().rating.preflop).not.toBeNull();
  });

  /**
   * Weighted toward hands the seat plays, so that hands get played, but not
   * only those: a preflop decision whose answer is always the same is not a
   * decision, it is a button.
   */
  it("deals mostly hands you continue with, but not only those", () => {
    const rng = mulberry32(5);
    let continuing = 0;
    const rounds = 400;

    for (let i = 0; i < rounds; i++) {
      const view = new Hand(defending, { rng }).view();
      const [a, b] = parseCards(view.cards.join(" "));
      const at = defending.hands.indexOf(a!, b!);
      expect(at).toBeGreaterThanOrEqual(0);
      if (defending.ranges[defending.seats.hero]![at]! > 0) continuing++;
    }

    const share = continuing / rounds;
    expect(share).toBeGreaterThan(0.6);
    expect(share).toBeLessThan(0.9);
  });
});

describe("playing it out", () => {
  const defending = synthetic("bb-defends-two-tone");
  const opening = synthetic("btn-opens-dry");

  it("always reaches a result", async () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 6; i++) {
      const view = await play(defending, rng);
      expect(view.finished).toBe(true);
      expect(resultOf(view).ending).toBeTruthy();
    }
  });

  it("reaches a result from either seat", async () => {
    for (const source of [defending, opening]) {
      const rng = mulberry32(3);
      for (let i = 0; i < 3; i++) expect((await play(source, rng)).finished).toBe(true);
    }
  });

  it("deals a board that grows one street at a time and stops at five", async () => {
    const rng = mulberry32(9);
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const view = await play(defending, rng);
      expect([0, 3, 4, 5]).toContain(view.board.length);
      seen.add(view.board.length);

      const streets = view.events.filter((e) => e.kind === "street").map((e) => e.name);
      expect(streets[0]).toBe("preflop");
      // Streets arrive in order and none is skipped or repeated.
      expect(streets).toEqual(
        ["preflop", "flop", "turn", "river"].slice(0, streets.length),
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("never deals a card twice", async () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 6; i++) {
      const view = await play(defending, rng);
      const result = resultOf(view);
      const cards = [...view.cards, ...view.board, ...(result.opponentHand ?? [])];
      expect(new Set(cards).size).toBe(cards.length);
    }
  });

  /**
   * The one that would have caught a silent disaster. Every street rebuilds the
   * hand set on a new board and compacts it, so both players' indices move
   * twice per hand. If they drifted, the wrong hand would win and nothing else
   * would complain.
   */
  it("awards a showdown to whoever actually has the better hand", async () => {
    const rng = mulberry32(13);
    let checked = 0;

    for (let i = 0; i < 14; i++) {
      const view = await play(defending, rng);
      const result = resultOf(view);
      if (result.ending !== "showdown") continue;

      const board = parseCards(view.board.join(" "));
      const hero = evaluate7([...board, ...parseCards(view.cards.join(" "))]);
      const villain = evaluate7([...board, ...parseCards(result.opponentHand!.join(" "))]);
      expect(result.verdict).toBe(hero > villain ? "win" : hero < villain ? "lose" : "split");
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  /**
   * The pot is the dead blinds plus what the two players put in, and nothing
   * else. A hand that pays out more than that is printing chips.
   */
  it("pays out exactly what went in", async () => {
    const rng = mulberry32(17);
    for (let i = 0; i < 8; i++) {
      const view = await play(defending, rng);
      const result = resultOf(view);
      if (result.ending === "off-line") continue;

      const acted = view.events.filter((e): e is Extract<HandEvent, { kind: "acted" }> =>
        e.kind === "acted",
      );
      // Everything in the middle either got posted as a blind or was put there
      // by an action, and the blinds are a small and a big whoever holds them.
      const added = acted.reduce((total, event) => total + event.added, 0);
      const pot = SMALL_BLIND + BIG_BLIND + added;

      if (result.verdict === "win") expect(result.won).toBeCloseTo(pot, 6);
      if (result.verdict === "split") expect(result.won).toBeCloseTo(pot / 2, 6);
      if (result.verdict === "lose") expect(result.won).toBe(0);
      expect(result.staked).toBeGreaterThan(0);
      expect(result.won).toBeGreaterThanOrEqual(0);
    }
  });
  // These solve real turn and river subgames and the suite runs several
  // files at once, so the default five seconds is a coin flip rather than a
  // threshold.
}, 120_000);

describe("scoring", () => {
  const defending = synthetic("bb-defends-two-tone");

  it("charges nothing for the best action and never a negative amount", async () => {
    const hand = new Hand(defending, { rng: mulberry32(21), iterations: FAST });
    await hand.act(1); // call preflop, on to the flop

    const view = hand.view();
    expect(view.choice).not.toBeNull();

    const costs: number[] = [];
    for (let at = 0; at < view.choice!.actions.length; at++) {
      const probe = new Hand(defending, { rng: mulberry32(21), iterations: FAST });
      await probe.act(1);
      costs.push(await probe.act(at));
    }
    expect(Math.min(...costs)).toBeCloseTo(0, 9);
    for (const cost of costs) expect(cost).toBeGreaterThanOrEqual(0);
  });

  /**
   * The claim the whole rating rests on. Play the cheapest action at every
   * decision and the hand has to come back having given up nothing, whatever
   * the cards did.
   */
  it("keeps all of what was on offer when every decision takes the best action", async () => {
    for (const seed of [23, 41, 57]) {
      const view = await playBest(defending, seed);
      if (view.rating.decisions === 0) continue;
      expect(view.rating.cost).toBeCloseTo(0, 6);
      expect(view.rating.kept).toBeCloseTo(1, 6);
      expect(view.rating.grade).toBe("Solver");
    }
  });

  it("adds the rating up from the decisions it charged for", async () => {
    const hand = new Hand(defending, { rng: mulberry32(43), iterations: FAST });
    let total = 0;
    let charged = 0;
    for (let step = 0; step < 16; step++) {
      const view = hand.view();
      if (view.finished || !view.choice) break;
      const cost = await hand.act(view.street === "preflop" ? 1 : 0);
      total += cost;
      if (view.street !== "preflop") charged++;
    }
    const rating = hand.view().rating;
    expect(rating.cost).toBeCloseTo(total, 9);
    // Every postflop decision is either priced or explicitly not, and the two
    // have to account for all of them: a decision that quietly fell out of both
    // would be a hand scored on less than it was played on.
    expect(rating.decisions + rating.unpriced).toBe(charged);
  });

  /**
   * A hand your range never has here gets played and not scored, because the
   * solver's average strategy for it is uniform-by-default rather than a
   * strategy. Dealt with a seed that produces one.
   */
  it("plays a hand your range does not have, and declines to price it", async () => {
    const rng = mulberry32(97);
    for (let i = 0; i < 40; i++) {
      const hand = new Hand(defending, { rng, iterations: FAST });
      const [a, b] = parseCards(hand.view().cards.join(" "));
      const at = defending.hands.indexOf(a!, b!);
      if (defending.ranges[defending.seats.hero]![at]! > 0) continue;

      await hand.act(1); // call anyway
      if (hand.view().finished) continue;
      await hand.act(0);

      const view = hand.view();
      expect(view.rating.unpriced).toBeGreaterThan(0);
      expect(view.rating.decisions).toBe(0);
      expect(view.rating.cost).toBe(0);
      // And the log does not put a price on it either.
      const mine = view.events.filter((e) => e.kind === "acted" && e.who === "you");
      for (const event of mine) {
        if (event.kind === "acted" && event.street !== "preflop") expect(event.cost).toBeNull();
      }
      return;
    }
    throw new Error("no off-range hand was dealt in 40 tries");
  });

  it("keeps the score between nothing and everything, whatever you do", async () => {
    const rng = mulberry32(29);
    for (let i = 0; i < 6; i++) {
      const view = await play(defending, rng, () => 0);
      const { kept, cost, atStake } = view.rating;
      expect(cost).toBeGreaterThanOrEqual(0);
      expect(cost).toBeLessThanOrEqual(atStake + 1e-9);
      if (kept !== null) {
        expect(kept).toBeGreaterThanOrEqual(0);
        expect(kept).toBeLessThanOrEqual(1);
      }
    }
  });

  it("bands the score without hiding it", () => {
    expect(gradeOf(null)).toMatch(/nothing to get wrong/i);
    // A hand nobody could price is not a hand with nothing at stake.
    expect(gradeOf(null, 2)).toBe("Not scored");
    expect(gradeOf(1)).toBe("Solver");
    expect(gradeOf(0.95)).toBe("Sharp");
    expect(gradeOf(0.8)).toBe("Solid");
    expect(gradeOf(0.6)).toBe("Loose");
    expect(gradeOf(0.1)).toBe("Spewed");
  });

  it("shows what the solver does only after you have committed", async () => {
    const hand = new Hand(defending, { rng: mulberry32(31), iterations: FAST });
    expect(hand.view().review).toBeNull();
    await hand.act(1);
    expect(hand.view().review).toBeNull(); // a fresh flop decision hides it again
    await hand.act(0);
    const view = hand.view();
    if (!view.finished && view.choice) expect(view.review).toBeNull();
    else expect(view.review).not.toBeNull();
  });
  // These solve real turn and river subgames and the suite runs several
  // files at once, so the default five seconds is a coin flip rather than a
  // threshold.
}, 120_000);

/** Replay a fixed line from the same seed, which deals the same cards. */
async function replay(source: SolvedFlopHand, seed: number, line: number[]): Promise<Hand> {
  const hand = new Hand(source, { rng: mulberry32(seed), iterations: FAST });
  for (const action of line) await hand.act(action);
  return hand;
}

/**
 * Play the cheapest action available at every decision.
 *
 * The engine prices an action only once it is taken, so finding the cheapest
 * one means taking each of them on a replay of the same line and keeping the
 * one that charged least. The seed makes the replays deal identically, and a
 * cost is computed before anything else consumes randomness, so probing one
 * action cannot change what the next probe sees.
 */
async function playBest(source: SolvedFlopHand, seed: number): Promise<HandView> {
  const line: number[] = [];

  for (let step = 0; step < 16; step++) {
    const view = (await replay(source, seed, line)).view();
    if (view.finished || !view.choice) return view;

    // Preflop is a chart rather than a price, so every action costs zero and
    // "cheapest" would just fold. Take the one that plays the hand.
    if (view.street === "preflop") {
      line.push(1);
      continue;
    }

    let best = 0;
    let bestCost = Infinity;
    for (let at = 0; at < view.choice.actions.length; at++) {
      const cost = await (await replay(source, seed, line)).act(at);
      if (cost < bestCost) {
        bestCost = cost;
        best = at;
      }
    }
    line.push(best);
  }

  return (await replay(source, seed, line)).view();
}
