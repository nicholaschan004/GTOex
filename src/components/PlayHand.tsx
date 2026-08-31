import { useEffect, useMemo, useRef, useState } from "react";
import { handClassOf } from "../lib/cards";
import { aggregateStrategy } from "../lib/postflop/decision";
import { Playthrough, type HandView } from "../lib/postflop/playthrough";
import { SPOTS } from "../lib/postflop/spots";
import { loadTurn, type SolvedTurn } from "../lib/postflop/turn-data";
import { OOP } from "../lib/solver/tree";
import { cn } from "../lib/cn";
import { PlayingCard } from "./PlayingCard";
import { StrategyGrid } from "./StrategyGrid";
import { ActionButton, Chip, type DrillBodyProps } from "./ui";

/**
 * Play a hand out.
 *
 * You get cards, you act, the opponent acts back out of the solved strategy for
 * the hand it is actually holding, a river comes, you act again, and somebody
 * wins the pot. Every decision you make is priced against the solver rather
 * than marked right or wrong, because postflop the same hand correctly bets
 * some of the time and checks the rest.
 *
 * The hand starts on the turn. The flop is not solved and could not be here --
 * three betting rounds and two chance layers is minutes and gigabytes even for
 * a commercial solver -- so how the hand got here is fixed and the screen says
 * so rather than inventing a flop strategy.
 */
export function PlayHand({ round, answered, onAnswer }: DrillBodyProps) {
  const [index, setIndex] = useState(0);
  const definition = SPOTS[Math.min(index, SPOTS.length - 1)]!;

  const [turn, setTurn] = useState<SolvedTurn | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<HandView | null>(null);
  const [busy, setBusy] = useState(false);
  const hand = useRef<Playthrough | null>(null);
  const recorded = useRef(false);

  /**
   * The solved scenarios are a couple of hundred kilobytes and only matter to
   * someone who clicks this mode, so they arrive on a dynamic import and get
   * their own chunk. Landing on the preflop drill should not pay for a turn
   * solve nobody asked for.
   */
  useEffect(() => {
    let cancelled = false;
    setTurn(null);
    setView(null);
    setFailed(null);

    import("../lib/charts/turn.generated")
      .then(({ TURNS_BY_SPOT }) => {
        if (cancelled) return;
        const packed = TURNS_BY_SPOT.get(definition.id);
        if (!packed) throw new Error(`${definition.id} has not been solved`);
        setTurn(loadTurn(packed));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [definition]);

  useEffect(() => {
    if (!turn) return;
    hand.current = new Playthrough(turn);
    recorded.current = false;
    setView(hand.current.view());
  }, [turn, round]);

  /**
   * Answering can deal a river, and dealing a river solves a subgame. That is a
   * couple of hundred milliseconds of blocking work, so the click paints a
   * waiting state first and does the work on the next tick. Without the yield
   * the screen simply freezes mid-hand.
   */
  const act = (action: number) => {
    if (!hand.current || busy || !view?.choice) return;
    setBusy(true);
    setTimeout(() => {
      hand.current!.act(action);
      const next = hand.current!.view();
      setView(next);
      setBusy(false);

      // One record per hand, not per decision: a hand you played three
      // decisions in is one hand, and scoring it three times would let a long
      // line quietly outvote a short one.
      if (next.finished && !recorded.current) {
        recorded.current = true;
        onAnswer({
          key: `play:${definition.id}`,
          label: definition.label,
          correct: next.cost <= definition.pot * 0.01,
        });
      }
    }, 0);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (answered || busy || !view?.choice) return;
      const slot = Number.parseInt(event.key, 10);
      if (Number.isInteger(slot) && slot >= 1 && slot <= view.choice.actions.length) {
        act(slot - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const review = view?.review ?? null;
  const classes = useMemo(
    () => (review ? aggregateStrategy(review.actions.length, review.frequency, review.weight, review.hands) : null),
    [review],
  );

  return (
    <>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Scenario">
        {SPOTS.map((spot, at) => (
          <Chip key={spot.id} active={at === index} onClick={() => setIndex(at)} title={spot.note}>
            {spot.label}
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

      {view && (
        <>
          <section className="space-y-1 text-center">
            <p className="text-sm text-muted">
              You are {definition.hero === OOP ? "out of position" : "in position"} · pot{" "}
              {view.choice?.pot ?? definition.pot} · {definition.stack} behind
            </p>
            <p className="text-sm text-muted">{definition.story}</p>
          </section>

          <div className="flex flex-wrap justify-center gap-1.5" aria-label="Board">
            {view.board.map((card) => (
              <PlayingCard key={card} card={card} scale={0.62} />
            ))}
          </div>

          <div className="flex justify-center gap-3" aria-label="Your hand">
            <PlayingCard card={view.cards[0]} />
            <PlayingCard card={view.cards[1]} />
          </div>

          <ActionLog view={view} />

          {view.choice && !view.finished && (
            <div className="flex flex-wrap justify-center gap-3">
              {view.choice.actions.map((action, at) => (
                <ActionButton
                  key={action.label}
                  onClick={() => act(at)}
                  shortcut={String(at + 1)}
                  emphasis={action.kind !== "fold" && action.kind !== "check"}
                  disabled={busy}
                >
                  {action.label}
                </ActionButton>
              ))}
            </div>
          )}

          {busy && (
            <p className="text-center text-sm text-muted" role="status">
              Solving the river…
            </p>
          )}

          {view.finished && <Summary view={view} />}

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

      <p className="text-center text-xs text-muted">{definition.note}</p>
    </>
  );
}

/** The hand so far, as a running commentary. */
function ActionLog({ view }: { view: HandView }) {
  return (
    <ol className="mx-auto w-full max-w-md space-y-1 text-sm" style={{ listStyle: "none" }}>
      {view.events.map((event, at) => {
        if (event.kind === "street") {
          return (
            <li key={at} className="pt-1 text-center text-xs uppercase tracking-wide text-muted">
              {event.name}
            </li>
          );
        }
        if (event.kind === "result") return null;
        return (
          <li key={at} className="flex items-baseline justify-between gap-3 text-muted">
            <span>
              <span className={event.who === "you" ? "text-ink" : undefined}>
                {event.who === "you" ? "You" : "Opponent"}
              </span>{" "}
              {event.label.toLowerCase()}
            </span>
            {event.cost !== null && (
              <span className="shrink-0 font-mono text-xs">
                {event.cost <= 0.005 ? (
                  <span className="text-correct">free</span>
                ) : (
                  <span className="text-wrong">-{event.cost.toFixed(2)}</span>
                )}
                {event.mix && <span className="ml-2 text-muted">{event.mix}</span>}
              </span>
            )}
          </li>
        );
      })}
    </ol>
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

  const clean = view.cost <= view.spot.pot * 0.01;
  const { verdict, won, staked } = result;

  // Worded off the verdict rather than the sign of the number: checking a hand
  // down and losing it costs nothing, and a sign test would call that a split.
  const headline =
    verdict === "win"
      ? `You win ${won.toFixed(0)}`
      : verdict === "split"
        ? `Split, ${won.toFixed(0)} back`
        : staked > 0
          ? `You lose ${staked.toFixed(0)}`
          : "You lose the pot";

  return (
    <div className="space-y-2 text-center">
      <p
        className={cn("text-lg font-semibold", VERDICT_COLOUR[verdict])}
        role="status"
      >
        {headline}
        <span className="ml-2 text-sm font-normal text-muted">
          {result.reason === "fold" ? "on a fold" : "at showdown"}
        </span>
      </p>

      <p className="text-sm text-muted">
        Opponent had{" "}
        <span className="text-ink">
          {result.opponentHand[0]}
          {result.opponentHand[1]}
        </span>
        .
      </p>

      {/*
        The result and the score are deliberately separate lines. Winning a pot
        with a bad line and losing one with a good line both happen constantly,
        and a trainer that conflated them would be teaching results rather than
        decisions.
      */}
      <p className="text-sm">
        {clean ? (
          <span className="text-correct">Played it clean.</span>
        ) : (
          <span className="text-wrong">Gave up {view.cost.toFixed(2)} chips across the hand.</span>
        )}{" "}
        <span className="text-muted">
          {verdict === "win" && !clean && "Winning the pot and playing it well are different things."}
          {verdict === "lose" && clean && "Nothing wrong with the line; the cards did that."}
        </span>
      </p>
    </div>
  );
}
