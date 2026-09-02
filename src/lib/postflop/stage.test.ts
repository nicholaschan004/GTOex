import { describe, expect, it } from "vitest";
import { stageOf } from "./stage";
import type { HandEvent, Street } from "./hand";

const street = (name: Street, pot: number): HandEvent => ({
  kind: "street",
  name,
  board: [],
  pot,
});

const acted = (who: "you" | "opponent", label: string, added: number, pot: number): HandEvent => ({
  kind: "acted",
  who,
  street: "flop",
  label,
  action: "bet",
  added,
  pot,
  cost: null,
  mix: "",
});

const EVENTS: HandEvent[] = [
  street("preflop", 1.5),
  acted("opponent", "opens to 2.5", 2.5, 4),
  acted("you", "Call 2.5", 1.5, 5.5),
  street("flop", 5.5),
  acted("you", "Check", 0, 5.5),
  acted("opponent", "Bet 2.8", 2.8, 8.3),
  acted("you", "Call 2.8", 2.8, 11.1),
  street("turn", 11.1),
  {
    kind: "result",
    ending: "showdown",
    verdict: "win",
    won: 11.1,
    staked: 5.3,
    opponentHand: ["Ah", "Kd"],
    note: null,
  },
];

describe("what the table is showing", () => {
  it("shows nothing before the first beat", () => {
    const stage = stageOf(EVENTS, 0);
    expect(stage.pot).toBe(0);
    expect(stage.boardShown).toBe(0);
    expect(stage.caughtUp).toBe(false);
  });

  it("deals the board a street behind the engine", () => {
    // The engine already knows the turn card; the screen has only got as far
    // as the flop, so it is showing three.
    expect(stageOf(EVENTS, 4).boardShown).toBe(3);
    expect(stageOf(EVENTS, 8).boardShown).toBe(4);
  });

  it("follows the pot action by action", () => {
    expect(stageOf(EVENTS, 1).pot).toBe(1.5);
    expect(stageOf(EVENTS, 2).pot).toBe(4);
    expect(stageOf(EVENTS, 3).pot).toBe(5.5);
    expect(stageOf(EVENTS, 7).pot).toBeCloseTo(11.1, 9);
  });

  /**
   * Chips sit in front of a seat while the street is live and are gone once it
   * closes, because by then they are in the pot. Carrying them over would show
   * the same chips twice.
   */
  it("clears the chips in front of a seat when the street closes", () => {
    const midStreet = stageOf(EVENTS, 6);
    expect(midStreet.committed.opponent).toBeCloseTo(2.8, 9);
    expect(midStreet.committed.you).toBe(0);

    const closed = stageOf(EVENTS, 8);
    expect(closed.committed).toEqual({ you: 0, opponent: 0 });
    expect(closed.pot).toBeCloseTo(11.1, 9);
  });

  it("keeps only the last thing each player said, and forgets it on a new street", () => {
    expect(stageOf(EVENTS, 3).said).toEqual({ you: "Call 2.5", opponent: "opens to 2.5" });
    expect(stageOf(EVENTS, 4).said).toEqual({ you: null, opponent: null });
    expect(stageOf(EVENTS, 7).said).toEqual({ you: "Call 2.8", opponent: "Bet 2.8" });
  });

  it("holds the result back until its beat", () => {
    expect(stageOf(EVENTS, EVENTS.length - 1).result).toBeNull();
    expect(stageOf(EVENTS, EVENTS.length)!.result?.verdict).toBe("win");
    expect(stageOf(EVENTS, EVENTS.length).caughtUp).toBe(true);
  });

  it("survives being asked for more beats than there are", () => {
    expect(stageOf(EVENTS, 99).caughtUp).toBe(true);
    expect(stageOf(EVENTS, -3).pot).toBe(0);
    expect(stageOf([], 0).caughtUp).toBe(true);
  });
});
