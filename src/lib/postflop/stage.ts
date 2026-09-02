/**
 * What the table looks like partway through a hand.
 *
 * The engine resolves a whole street the moment you act: you call, the
 * opponent's reply, the next card and sometimes the card after that all land in
 * the event list at once. Showing that as a jump cut would make the hand
 * unreadable, so the screen walks the list a beat at a time, and this is what
 * it should be showing when it has walked `shown` of them.
 *
 * A pure function of the events rather than state built up in the component,
 * because the interesting cases -- chips resetting between streets, the board
 * appearing a street behind the engine, a result arriving while an action
 * bubble is still up -- are worth testing without a browser.
 */

import type { HandEvent, Street } from "./hand";

const CARDS_DEALT: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

export interface Stage {
  street: Street;
  /** How many board cards have landed on the table. */
  boardShown: number;
  pot: number;
  /** Chips out in front of each seat on this street. */
  committed: { you: number; opponent: number };
  /** The last thing each player said, for the bubble over their seat. */
  said: { you: string | null; opponent: string | null };
  result: Extract<HandEvent, { kind: "result" }> | null;
  /** Whether the screen has caught up with the engine. */
  caughtUp: boolean;
}

export function stageOf(events: readonly HandEvent[], shown: number): Stage {
  const stage: Stage = {
    street: "preflop",
    boardShown: 0,
    pot: 0,
    committed: { you: 0, opponent: 0 },
    said: { you: null, opponent: null },
    result: null,
    caughtUp: shown >= events.length,
  };

  for (const event of events.slice(0, Math.max(0, shown))) {
    if (event.kind === "street") {
      stage.street = event.name;
      stage.boardShown = CARDS_DEALT[event.name];
      stage.pot = event.pot;
      // A new street takes the chips off the felt and into the pot, and nobody
      // has said anything on it yet.
      stage.committed = { you: 0, opponent: 0 };
      stage.said = { you: null, opponent: null };
      continue;
    }

    if (event.kind === "acted") {
      stage.pot = event.pot;
      stage.committed[event.who] += event.added;
      stage.said[event.who] = event.label;
      continue;
    }

    stage.result = event;
  }

  return stage;
}
