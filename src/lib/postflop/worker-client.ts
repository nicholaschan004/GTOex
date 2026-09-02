/**
 * The main thread's half of the solver worker.
 *
 * Falls back to solving in place if a worker cannot be started, because a
 * trainer that refuses to deal a hand is worse than one that stutters for a
 * second while it thinks.
 */

import { directSolver, type SubgameSolver } from "./hand";
import type { SubgameSolution } from "./subgame";
import type { SolveMessage, SolveReply } from "./solver.worker";

export interface SolverHandle {
  solve: SubgameSolver;
  dispose(): void;
}

export function createSolver(): SolverHandle {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return { solve: directSolver, dispose: () => {} };
  }

  const pending = new Map<
    number,
    { resolve: (value: SubgameSolution) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;

  worker.addEventListener("message", (event: MessageEvent<SolveReply>) => {
    const waiting = pending.get(event.data.id);
    if (!waiting) return;
    pending.delete(event.data.id);
    if ("error" in event.data) waiting.reject(new Error(event.data.error));
    else waiting.resolve(event.data.solution);
  });

  worker.addEventListener("error", (event) => {
    // A worker that dies takes every request in flight with it, and a promise
    // that never settles would leave the table frozen mid-hand with no reason
    // on screen.
    for (const [, waiting] of pending) waiting.reject(new Error(event.message || "The solver stopped"));
    pending.clear();
  });

  return {
    solve: (request) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, request } satisfies SolveMessage);
      }),
    dispose: () => {
      worker.terminate();
      pending.clear();
    },
  };
}
