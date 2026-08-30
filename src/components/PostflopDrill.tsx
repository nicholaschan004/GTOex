import { useEffect, useMemo, useRef, useState } from "react";
import { handClassOf } from "../lib/cards";
import { intToCard } from "../lib/equity";
import {
  aggregateToClasses,
  costOf,
  dealFrom,
  isCloseEnough,
  solveDecision,
  unpackDecision,
  type SolvedDecision,
} from "../lib/postflop/decision";
import { SPOTS, buildSpot, type BuiltSpot } from "../lib/postflop/spots";
import { TURN_DECISIONS_BY_SPOT } from "../lib/charts/turn.generated";
import { cn } from "../lib/cn";
import { PlayingCard } from "./PlayingCard";
import { StrategyGrid } from "./StrategyGrid";
import { ActionButton, Chip, type DrillBodyProps } from "./ui";

/**
 * The postflop drill.
 *
 * Two streets, two very different routes to the same screen. A river spot is a
 * few hundred milliseconds to solve, so it is solved in the browser when you
 * pick it. A turn spot is eight seconds and twenty megabytes, so it was solved
 * at build time and ships as data. By the time either reaches this component
 * they are the same object and nothing here knows the difference.
 *
 * The scoring is the part that had to change from preflop. A chart says open or
 * fold; a solved postflop strategy says this hand bets sixty percent of the
 * time. So an answer is not right or wrong, it costs something, and what this
 * screen reports is that cost in chips. Anything under a percent of the pot is
 * inside the solve's own error and is called fine rather than correct, because
 * claiming to know the difference there would be claiming more than the solver
 * does.
 */
export function PostflopDrill({
  street,
  round,
  answered,
  onAnswer,
}: DrillBodyProps & { street: "turn" | "river" }) {
  const spots = useMemo(() => SPOTS.filter((spot) => spot.street === street), [street]);
  const [index, setIndex] = useState(0);
  const definition = spots[Math.min(index, spots.length - 1)]!;

  const [built, setBuilt] = useState<BuiltSpot | null>(null);
  const [decision, setDecision] = useState<SolvedDecision | null>(null);
  const [hand, setHand] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /**
   * Guards against answering twice in one tick.
   *
   * `chosen` is state, so two clicks landing in the same React batch both read
   * it as null, both pass the guard, and the hand gets recorded twice. A ref is
   * set synchronously and closes that window. Found by a test harness clicking
   * two buttons in a row, which is also roughly what a double tap does.
   */
  const committed = useRef(false);

  // Solving a river blocks for a few hundred milliseconds. The timeout is not a
  // delay, it is a yield: without it React never paints the "solving" state and
  // the screen simply freezes with the old spot on it.
  useEffect(() => {
    let cancelled = false;
    setDecision(null);
    setBuilt(null);
    setFailed(null);

    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        const spot = buildSpot(definition);
        const packed = TURN_DECISIONS_BY_SPOT.get(definition.id);
        const solved =
          definition.street === "turn" && packed
            ? unpackDecision(packed)
            : solveDecision(spot, { iterations: 250 });
        if (cancelled) return;
        setBuilt(spot);
        setDecision(solved);
      } catch (error) {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [definition]);

  useEffect(() => {
    if (!decision) return;
    setHand(dealFrom(decision));
    setChosen(null);
    committed.current = false;
  }, [decision, round]);

  const cost = decision !== null && hand !== null && chosen !== null ? costOf(decision, chosen, hand) : null;

  const answer = (action: number) => {
    if (!decision || hand === null || committed.current) return;
    committed.current = true;
    const price = costOf(decision, action, hand);
    setChosen(action);
    onAnswer({
      key: `${street}:${definition.id}`,
      label: definition.label,
      correct: isCloseEnough(price, definition.pot),
    });
  };

  // Numbers rather than letters: the actions change from spot to spot, so F for
  // fold would sometimes be the second button and sometimes not exist.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (answered || !decision) return;
      const slot = Number.parseInt(event.key, 10);
      if (Number.isInteger(slot) && slot >= 1 && slot <= decision.actions.length) {
        answer(slot - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const classes = useMemo(
    () => (decision && built ? aggregateToClasses(decision, built.hands) : null),
    [decision, built],
  );

  const cards =
    built && decision && hand !== null
      ? ([
          intToCard(built.hands.cardA[decision.hands[hand]!]!),
          intToCard(built.hands.cardB[decision.hands[hand]!]!),
        ] as const)
      : null;

  return (
    <>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Spot">
        <span className="text-xs text-muted">Spot</span>
        {spots.map((spot, at) => (
          <Chip key={spot.id} active={at === index} onClick={() => setIndex(at)} title={spot.note}>
            {spot.label}
          </Chip>
        ))}
      </nav>

      <section className="space-y-1 text-center">
        <p className="text-sm text-muted">
          {definition.board} · pot {definition.pot} · {definition.stack} behind
        </p>
        <p className="text-sm text-muted">{definition.story}</p>
      </section>

      <div className="flex flex-wrap justify-center gap-1.5" aria-label="Board">
        {definition.board.split(/\s+/).map((card) => (
          <PlayingCard key={card} card={card as never} scale={0.62} />
        ))}
      </div>

      {failed && (
        <p className="text-center text-sm text-wrong" role="status">
          Could not solve this spot: {failed}
        </p>
      )}

      {!decision && !failed && (
        <p className="text-center text-sm text-muted" role="status">
          {definition.street === "river" ? "Solving this spot…" : "Loading…"}
        </p>
      )}

      {decision && cards && (
        <>
          <div className="flex justify-center gap-3" aria-label="Your hand">
            <PlayingCard card={cards[0]} />
            <PlayingCard card={cards[1]} />
          </div>

          {chosen === null ? (
            <div className="flex flex-wrap justify-center gap-3">
              {decision.actions.map((action, at) => (
                <ActionButton
                  key={action.label}
                  onClick={() => answer(at)}
                  shortcut={String(at + 1)}
                  emphasis={action.kind !== "fold" && action.kind !== "check"}
                >
                  {action.label}
                </ActionButton>
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              <Verdict
                cost={cost ?? 0}
                pot={definition.pot}
                decision={decision}
                hand={hand!}
                chosen={chosen}
              />

              {classes && (
                <div className="space-y-2">
                  <StrategyGrid
                    actions={decision.actions}
                    strategy={classes}
                    highlight={handClassOf(cards[0], cards[1])}
                  />
                  <p className="text-center text-xs text-muted">
                    Averaged over the combinations of each class that can be here, which is a
                    summary: two combinations of the same class can play differently.
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="text-center text-xs text-muted">
            Solved to {decision.exploitabilityPercent.toFixed(3)}% of pot.{" "}
            {definition.street === "river"
              ? "Computed in your browser just now."
              : "Computed at build time; a turn solve is eight seconds."}
          </p>
        </>
      )}

      <p className="text-center text-xs text-muted">{definition.note}</p>
    </>
  );
}

function Verdict({
  cost,
  pot,
  decision,
  hand,
  chosen,
}: {
  cost: number;
  pot: number;
  decision: SolvedDecision;
  hand: number;
  chosen: number;
}) {
  const fine = isCloseEnough(cost, pot);
  const count = decision.hands.length;
  const mix = decision.actions
    .map((action, at) => ({ action, share: decision.frequency[at * count + hand]! }))
    .filter((entry) => entry.share > 0.005);

  return (
    <div className="space-y-2 text-center">
      <p className={cn("text-lg font-semibold", fine ? "text-correct" : "text-wrong")} role="status">
        {/*
          "Fine" rather than "correct". At a mixed node several actions are
          genuinely right, and the honest claim is that this one costs nothing
          worth measuring, not that it was the answer.
        */}
        {fine ? "Fine" : `Costs ${cost.toFixed(2)} chips`}
      </p>
      <p className="text-sm text-muted">
        {fine && cost > 0 && (
          <>
            <span className="text-ink">{cost.toFixed(2)}</span> chips, which is under a percent of
            the pot.{" "}
          </>
        )}
        {mix.length > 1 ? "The solver mixes: " : "The solver plays "}
        {mix.map((entry, at) => (
          <span key={entry.action.label}>
            {at > 0 && ", "}
            <span className={cn(at === 0 ? "text-ink" : undefined)}>
              {entry.action.label.toLowerCase()} {(entry.share * 100).toFixed(0)}%
            </span>
          </span>
        ))}
        {mix.length === 0 && "nothing here"}.
      </p>
      <p className="text-xs text-muted">
        You chose <span className="text-ink">{decision.actions[chosen]!.label.toLowerCase()}</span>.
      </p>
    </div>
  );
}
