import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { handClassOf } from "../lib/cards";
import { aggregateStrategy } from "../lib/postflop/decision";
import { Hand, type HandView } from "../lib/postflop/hand";
import { loadFlop, type SolvedFlopHand } from "../lib/postflop/flop-data";
import { SCENARIOS } from "../lib/postflop/scenario";
import { stageOf } from "../lib/postflop/stage";
import { createSolver, type SolverHandle } from "../lib/postflop/worker-client";
import { roundChips } from "../lib/sizing";
import { OOP } from "../lib/solver/tree";
import { cn } from "../lib/cn";
import { HandTable, useReducedMotion } from "./HandTable";
import { StrategyGrid } from "./StrategyGrid";
import { ActionButton, Chip, type DrillBodyProps } from "./ui";

/**
 * Play a hand out, from the deal to the showdown.
 *
 * You act preflop, on the flop, on the turn and on the river; the opponent
 * draws from the solved strategy for the hand it is holding; and at the end the
 * hand is rated on how much of the expected value that was actually on offer
 * you kept. Playing badly does not stop the hand -- that is most of the point,
 * because the interesting question after a mistake is what the rest of the hand
 * looks like.
 *
 * The screen paces itself. The engine resolves a whole street the moment you
 * act, and dealing that out a beat at a time is what makes it a hand rather
 * than a diff.
 */
export function PlayHand({ round, answered, onAnswer }: DrillBodyProps) {
  const [index, setIndex] = useState(0);
  const scenario = SCENARIOS[Math.min(index, SCENARIOS.length - 1)]!;
  const reducedMotion = useReducedMotion();

  const [source, setSource] = useState<SolvedFlopHand | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<HandView | null>(null);
  const [thinking, setThinking] = useState(false);
  const [shown, setShown] = useState(0);

  const hand = useRef<Hand | null>(null);
  const solver = useRef<SolverHandle | null>(null);
  /** Set synchronously, so two clicks in one React batch cannot both land. */
  const acting = useRef(false);
  const recorded = useRef(false);

  // One worker for the session. Starting it per hand would pay the module load
  // on every deal, which is most of what a river solve costs.
  useEffect(() => {
    solver.current = createSolver();
    return () => {
      solver.current?.dispose();
      solver.current = null;
    };
  }, []);

  /**
   * The solved scenarios are their own chunk and only matter to someone who
   * opens this mode. Landing on the preflop drill should not pay for a flop
   * solve nobody asked for.
   */
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setView(null);
    setFailed(null);

    import("../lib/charts/flop.generated")
      .then(({ FLOPS_BY_SCENARIO }) => {
        if (cancelled) return;
        const packed = FLOPS_BY_SCENARIO.get(scenario.id);
        if (!packed) throw new Error(`${scenario.id} has not been solved`);
        setSource(loadFlop(packed));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [scenario]);

  useEffect(() => {
    if (!source) return;
    hand.current = new Hand(source, {
      solver: (request) => solver.current!.solve(request),
    });
    acting.current = false;
    recorded.current = false;
    // The blinds are posted before anybody does anything, so the first event is
    // the state the hand starts in rather than something that happens in it.
    // Making it wait for a beat would show an empty pot that never existed.
    setShown(1);
    setView(hand.current.view());
  }, [source, round]);

  const events = view?.events;

  /**
   * Walk the event list a beat at a time.
   *
   * Your own actions appear at once, because you just pressed the button. The
   * opponent's get a pause, because a reply that lands the instant you act does
   * not read as a reply.
   */
  useEffect(() => {
    if (!events) return;
    if (reducedMotion) {
      setShown(events.length);
      return;
    }
    if (shown >= events.length) return;

    const next = events[shown]!;
    const beat =
      next.kind === "street" ? 620 : next.kind === "result" ? 420 : next.who === "you" ? 140 : 760;
    const timer = setTimeout(() => setShown((count) => count + 1), beat);
    return () => clearTimeout(timer);
  }, [events, shown, reducedMotion]);

  const stage = useMemo(() => stageOf(events ?? [], shown), [events, shown]);

  const act = useCallback(
    async (at: number) => {
      const current = hand.current;
      if (!current || acting.current) return;
      const before = current.view();
      if (!before.choice || before.finished) return;

      acting.current = true;
      // Only name the wait if there is one. Most actions resolve instantly;
      // the ones that close a street have to solve the next one first.
      const slow = setTimeout(() => setThinking(true), 150);

      try {
        await current.act(at);
      } catch (error) {
        setFailed(error instanceof Error ? error.message : String(error));
      } finally {
        clearTimeout(slow);
        setThinking(false);
        acting.current = false;
      }

      const next = current.view();
      setView(next);

      // One record per hand, not per decision: a hand you played four decisions
      // in is one hand, and scoring it four times would let a long line quietly
      // outvote a short one.
      if (next.finished && !recorded.current) {
        recorded.current = true;
        const { kept, preflop } = next.rating;
        onAnswer({
          key: `play:${scenario.id}`,
          label: scenario.label,
          correct: kept !== null ? kept >= 0.9 : (preflop?.correct ?? true),
        });
      }
    },
    [onAnswer, scenario],
  );

  const choosing = !!view?.choice && !view.finished && stage.caughtUp && !thinking;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!choosing || answered) return;
      const slot = Number.parseInt(event.key, 10);
      if (Number.isInteger(slot) && slot >= 1 && slot <= (view?.choice?.actions.length ?? 0)) {
        void act(slot - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const review = stage.caughtUp ? (view?.review ?? null) : null;
  const classes = useMemo(
    () =>
      review
        ? aggregateStrategy(review.actions.length, review.frequency, review.weight, review.hands)
        : null,
    [review],
  );

  return (
    <>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Scenario">
        {SCENARIOS.map((option, at) => (
          <Chip key={option.id} active={at === index} onClick={() => setIndex(at)} title={option.note}>
            {option.label}
          </Chip>
        ))}
      </nav>

      {failed && (
        <p className="text-center text-sm text-wrong" role="status">
          {failed}
        </p>
      )}

      {!view && !failed && (
        <p className="text-center text-sm text-muted" role="status">
          Loading the solved scenario…
        </p>
      )}

      {view && source && (
        <>
          <p className="text-center text-sm text-muted">
            {source.seats.hero === OOP ? "Out of position" : "In position"} against the{" "}
            {scenario.hero === "opener" ? scenario.defender : scenario.opener}
            {". "}
            {stage.street === "preflop"
              ? "100bb deep, six handed."
              : `${roundChips(view.pot)}bb in the middle.`}
          </p>

          <HandTable
            view={view}
            stage={stage}
            turn={choosing ? "you" : thinking ? "opponent" : null}
            thinking={thinking}
            reducedMotion={reducedMotion}
          />

          {choosing && (
            <div className="flex flex-wrap justify-center gap-3" aria-label="Your options" role="group">
              {view.choice!.actions.map((action, at) => (
                <ActionButton
                  key={action.label}
                  onClick={() => void act(at)}
                  shortcut={String(at + 1)}
                  emphasis={action.kind !== "fold" && action.kind !== "check"}
                >
                  {action.label}
                </ActionButton>
              ))}
            </div>
          )}

          {stage.result && <Summary view={view} />}

          {classes && review && (
            <div className="space-y-2">
              <p className="text-center text-xs text-muted">
                What the solver does with your whole range at that {review.street} decision:
              </p>
              <StrategyGrid
                actions={review.actions}
                strategy={classes}
                highlight={handClassOf(view.cards[0], view.cards[1])}
              />
            </div>
          )}
        </>
      )}

      <p className="text-center text-xs text-muted">{scenario.note}</p>
    </>
  );
}

/**
 * A lookup rather than a conditional, so no verdict name is ever written as a
 * string literal inside a `cn()` call. `check-classes.mjs` reads every literal
 * in those as a class name, and "lose" is not one.
 */
const VERDICT_COLOUR = {
  win: "text-correct",
  lose: "text-wrong",
  split: "text-ink",
} as const;

function Summary({ view }: { view: HandView }) {
  const result = view.events.find((event) => event.kind === "result");
  if (!result || result.kind !== "result") return null;

  const { verdict, won, staked, ending } = result;
  const headline =
    ending === "off-line"
      ? "Hand stopped"
      : verdict === "win"
        ? `You win ${roundChips(won)}bb`
        : verdict === "split"
          ? `Split, ${roundChips(won)}bb back`
          : staked > 0
            ? `You lose ${roundChips(staked)}bb`
            : "You lose the pot";

  const { kept, cost, decisions, preflop, grade, unpriced } = view.rating;

  return (
    <div className="space-y-3 text-center">
      <p
        className={cn("text-lg font-semibold", verdict ? VERDICT_COLOUR[verdict] : "text-muted")}
        role="status"
      >
        {headline}
        {result.opponentHand && (
          <span className="ml-2 text-sm font-normal text-muted">
            {ending === "fold" ? "on a fold" : "at showdown"}, they had{" "}
            <span className="text-ink">
              {result.opponentHand[0]}
              {result.opponentHand[1]}
            </span>
          </span>
        )}
      </p>

      {result.note && <p className="mx-auto max-w-md text-sm text-muted">{result.note}</p>}

      {/*
        The result and the score are deliberately separate lines. Winning a pot
        with a bad line and losing one with a good line both happen constantly,
        and a trainer that conflated them would be teaching results rather than
        decisions.
      */}
      <div className="mx-auto max-w-md space-y-1 rounded-lg border border-line bg-raised px-4 py-3">
        <p className="text-sm">
          <span className="text-ink">{grade}</span>
          {kept !== null && (
            <span className="text-muted">
              {" · "}kept <span className="text-ink">{(kept * 100).toFixed(0)}%</span> of the
              expected value on offer across {decisions} decision{decisions === 1 ? "" : "s"}
            </span>
          )}
        </p>
        {cost > 0.005 && (
          <p className="text-xs text-muted">
            Gave up <span className="text-wrong">{cost.toFixed(2)}bb</span> against playing every
            street the way the solver does.
          </p>
        )}

        {/*
          Where it went, street by street. One number for the hand says how you
          did; this says which decision to think about, which is the part worth
          taking to the next hand.
        */}
        <Breakdown view={view} />
        {unpriced > 0 && (
          <p className="text-xs text-muted">
            {unpriced} decision{unpriced === 1 ? "" : "s"} went unscored: your range never takes
            this hand to the flop, so the solver never had to have a strategy for it. You can
            still play it out, but there is nothing to price it against.
          </p>
        )}
        {preflop && (
          <p className="text-xs text-muted">
            Preflop:{" "}
            <span className={preflop.correct ? "text-correct" : "text-wrong"}>
              {preflop.correct ? "chart agrees" : `chart says ${preflop.best}`}
            </span>
            {". "}Scored against a chart rather than a solve, so it is right or wrong rather than
            priced.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Your own decisions and what each one cost.
 *
 * The mix is shown next to it, because "you bet, the solver bets that hand 30%
 * of the time" is a different lesson from "you bet, the solver never bets that
 * hand", and a single price does not tell them apart.
 */
function Breakdown({ view }: { view: HandView }) {
  const decisions = view.events.filter(
    (event) => event.kind === "acted" && event.who === "you" && event.cost !== null,
  );
  if (decisions.length === 0) return null;

  return (
    <ol className="space-y-0.5 pt-1 text-xs" style={{ listStyle: "none" }}>
      {decisions.map((event, at) => {
        if (event.kind !== "acted") return null;
        const free = (event.cost ?? 0) <= 0.005;
        return (
          <li key={at} className="flex items-baseline justify-between gap-3">
            <span className="text-muted">
              <span className="text-ink">{event.street}</span> {event.label.toLowerCase()}
              {event.mix && <span className="ml-2 text-muted">({event.mix})</span>}
            </span>
            <span className={cn("shrink-0 font-mono", free ? "text-correct" : "text-wrong")}>
              {free ? "free" : `-${(event.cost ?? 0).toFixed(2)}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
