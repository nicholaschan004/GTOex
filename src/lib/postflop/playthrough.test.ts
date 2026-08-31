import { describe, expect, it } from "vitest";
import { Playthrough } from "./playthrough";
import { loadTurn } from "./turn-data";
import { SPOTS, buildSpot } from "./spots";
import { TURNS, TURNS_BY_SPOT } from "../charts/turn.generated";
import { evaluate7, parseCards } from "../equity";
import { mulberry32 } from "../rng";

const scenario = loadTurn(TURNS_BY_SPOT.get("turn-two-tone")!);

/**
 * Rivers get solved lightly here. Every hand that reaches one solves a subgame,
 * and these tests play hundreds; at the shipping setting that is a minute and a
 * half of wall clock to check things that do not depend on how exact the river
 * is. The two tests that DO care say so.
 */
const FAST = 30;

/** Play one hand to the end, choosing with `choose`. */
function play(
  turn = scenario,
  rng: () => number = mulberry32(1),
  choose: (actions: { kind: string }[]) => number = (actions) =>
    Math.max(0, actions.findIndex((a) => a.kind === "check" || a.kind === "call")),
) {
  const hand = new Playthrough(turn, { rng, riverIterations: FAST });
  for (let step = 0; step < 12; step++) {
    const view = hand.view();
    if (view.finished || !view.choice) break;
    hand.act(choose(view.choice.actions));
  }
  return hand.view();
}

describe("the shipped turn data", () => {
  it("covers every scenario", () => {
    expect(TURNS).toHaveLength(SPOTS.length);
    for (const spot of SPOTS) expect(TURNS_BY_SPOT.has(spot.id)).toBe(true);
  });

  /**
   * The generated file is committed and a scenario can be edited without anyone
   * remembering to regenerate. The tree is rebuilt from the definition rather
   * than serialised, so a changed board or bet size would silently line the
   * strategy up against the wrong nodes. `loadTurn` refuses instead.
   */
  it("still matches the scenarios it was generated from", () => {
    for (const packed of TURNS) {
      expect(() => loadTurn(packed)).not.toThrow();
      const loaded = loadTurn(packed);
      const built = buildSpot(loaded.spot, { withViews: false });
      expect(loaded.hands.count).toBe(built.hands.count);
      expect(loaded.strategies.size).toBe(
        built.tree.playerNodes.filter((node) => node.street === 0).length,
      );
    }
  });

  it("refuses data that no longer fits its scenario", () => {
    const packed = TURNS_BY_SPOT.get("turn-two-tone")!;
    expect(() => loadTurn({ ...packed, handCount: 999 })).toThrow(/Regenerate/);
    expect(() => loadTurn({ ...packed, nodes: packed.nodes.slice(1) })).toThrow(/Regenerate/);
  });

  it("was solved to something worth calling solved", () => {
    for (const packed of TURNS) {
      expect(packed.exploitabilityPercent).toBeGreaterThanOrEqual(0);
      expect(packed.exploitabilityPercent).toBeLessThan(0.5);
    }
  });

  it("carries values where you decide and not where the opponent does", () => {
    for (const packed of TURNS) {
      const loaded = loadTurn(packed);
      const hero = loaded.spot.hero;
      for (const node of packed.nodes) {
        const strategy = loaded.strategies.get(node.id)!;
        if (strategy.player === hero) expect(node.ev).not.toBeNull();
        else expect(node.ev).toBeNull();
      }
    }
  });
});

describe("playing a hand", () => {
  it("always reaches a result", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 20; i++) {
      const view = play(scenario, rng);
      expect(view.finished).toBe(true);
      expect(view.events.some((event) => event.kind === "result")).toBe(true);
    }
  });

  it("reaches a result from every scenario, whichever seat you are in", () => {
    for (const packed of TURNS) {
      const turn = loadTurn(packed);
      const rng = mulberry32(3);
      for (let i = 0; i < 4; i++) expect(play(turn, rng).finished).toBe(true);
    }
  });

  it("never deals you and the opponent the same card", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 20; i++) {
      const view = play(scenario, rng);
      const result = view.events.find((e) => e.kind === "result");
      if (!result || result.kind !== "result") throw new Error("no result");

      const cards = [...view.cards, ...result.opponentHand, ...view.board];
      expect(new Set(cards).size).toBe(cards.length);
    }
  });

  it("deals a river when the hand gets that far, and never a fifth street", () => {
    const rng = mulberry32(9);
    let sawRiver = 0;
    for (let i = 0; i < 20; i++) {
      const view = play(scenario, rng);
      expect(view.board.length === 4 || view.board.length === 5).toBe(true);
      if (view.board.length === 5) sawRiver++;
    }
    // Playing passively should see plenty of rivers; seeing none would mean the
    // chance node was never reached.
    expect(sawRiver).toBeGreaterThan(4);
  });

  /**
   * The one that would have caught a silent disaster. A showdown has to be
   * decided by the cards, and if the hand indices drifted when the river
   * changed the index space, the wrong hand would win and nothing else would
   * complain.
   */
  it("awards a showdown to whoever actually has the better hand", () => {
    const rng = mulberry32(13);
    let checked = 0;

    for (let i = 0; i < 30; i++) {
      const view = play(scenario, rng);
      const result = view.events.find((e) => e.kind === "result");
      if (!result || result.kind !== "result" || result.reason !== "showdown") continue;

      const board = parseCards(view.board.join(" "));
      const hero = evaluate7([...board, ...parseCards(view.cards.join(" "))]);
      const villain = evaluate7([...board, ...parseCards(result.opponentHand.join(" "))]);

      const expected = hero > villain ? "win" : hero < villain ? "lose" : "split";
      expect(result.verdict).toBe(expected);
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
  });

  it("does not decide every hand the same way", () => {
    const rng = mulberry32(21);
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const result = play(scenario, rng).events.find((e) => e.kind === "result");
      if (result && result.kind === "result") seen.add(result.verdict);
    }
    // Winning sixty of sixty would mean the showdown was not being computed.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("does not bill passive play as a catastrophe", () => {
    const rng = mulberry32(31);
    let total = 0;
    for (let i = 0; i < 10; i++) total += play(scenario, rng).cost;
    // Checking and calling everything is not the equilibrium and should cost
    // something, but a whole hand of it should not cost half the pot.
    expect(total / 10).toBeLessThan(scenario.spot.pot * 0.5);
    expect(total).toBeGreaterThan(0);
  });

  it("prices a decision at zero when it takes the best action", () => {
    const hand = new Playthrough(scenario, { rng: mulberry32(2), riverIterations: FAST });
    const view = hand.view();
    expect(view.choice).not.toBeNull();

    const costs = view.choice!.actions.map((_, at) => {
      const probe = new Playthrough(scenario, { rng: mulberry32(2), riverIterations: FAST });
      return probe.act(at);
    });
    expect(Math.min(...costs)).toBeCloseTo(0, 9);
    for (const cost of costs) expect(cost).toBeGreaterThanOrEqual(0);
  });

  it("shows what the solver does only after you have committed", () => {
    const hand = new Playthrough(scenario, { rng: mulberry32(4), riverIterations: FAST });
    expect(hand.view().review).toBeNull();
    hand.act(0);
    const view = hand.view();
    if (!view.finished && view.choice) {
      // A fresh decision hides the answer again.
      expect(view.review).toBeNull();
    } else {
      expect(view.review).not.toBeNull();
    }
  });

  /**
   * The short-stack scenario is the only one where a turn bet is the whole
   * stack, so it is the only one that reaches the river with nothing left to
   * bet. That path builds no river tree at all, and a tree on an empty stack
   * would offer a one chip bet neither player has.
   */
  it("plays a river out with no betting when the turn got both players all in", () => {
    const short = loadTurn(TURNS_BY_SPOT.get("turn-low-spr")!);
    const rng = mulberry32(17);
    let allIn = 0;

    for (let i = 0; i < 30; i++) {
      const hand = new Playthrough(short, { rng, riverIterations: FAST });
      for (let step = 0; step < 8; step++) {
        const view = hand.view();
        if (view.finished || !view.choice) break;
        // Take the aggressive action when there is one, so the stack goes in.
        const at = view.choice.actions.findIndex((a) => a.kind === "bet" || a.kind === "call");
        hand.act(at >= 0 ? at : 0);
      }

      const view = hand.view();
      expect(view.finished).toBe(true);
      if (view.board.length !== 5) continue;

      const result = view.events.find((event) => event.kind === "result");
      if (!result || result.kind !== "result") throw new Error("no result");
      // Everyone is all in, so the river cannot have been bet: the only events
      // after the river card are the result.
      const afterRiver = view.events.slice(
        view.events.findIndex((e) => e.kind === "street" && e.name === "river"),
      );
      expect(afterRiver.filter((e) => e.kind === "acted")).toHaveLength(0);
      expect(result.reason).toBe("showdown");
      allIn++;
    }

    expect(allIn).toBeGreaterThan(3);
  });

  it("logs the hand in the order it happened", () => {
    const view = play(scenario, mulberry32(6));
    const kinds = view.events.map((event) => event.kind);
    expect(kinds[0]).toBe("street");
    expect(kinds[kinds.length - 1]).toBe("result");

    const streets = view.events.filter((event) => event.kind === "street");
    expect(streets[0]).toMatchObject({ name: "turn" });
    if (streets.length > 1) expect(streets[1]).toMatchObject({ name: "river" });
  });
}, 120_000);
