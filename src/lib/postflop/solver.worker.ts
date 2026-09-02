/**
 * Solving a street off the main thread.
 *
 * A turn is a two street subgame -- the turn betting round and 48 river
 * subgames underneath it -- and it takes a second or two. On the main thread
 * that is a second or two in which nothing paints: no card lands, no chips
 * move, no button responds. So it happens here, and the table keeps animating
 * while it does.
 *
 * Nothing crosses this boundary except plain numbers. See `subgame.ts`.
 */

import { solveSubgame, type SubgameRequest, type SubgameSolution } from "./subgame";

export interface SolveMessage {
  id: number;
  request: SubgameRequest;
}

export type SolveReply =
  | { id: number; solution: SubgameSolution }
  | { id: number; error: string };

self.addEventListener("message", (event: MessageEvent<SolveMessage>) => {
  const { id, request } = event.data;
  const reply = (message: SolveReply) => (self as unknown as Worker).postMessage(message);

  try {
    reply({ id, solution: solveSubgame(request) });
  } catch (error) {
    reply({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
