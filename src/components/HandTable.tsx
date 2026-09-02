import { useEffect, useState } from "react";
import type { Card } from "../lib/cards";
import { roundChips } from "../lib/sizing";
import type { HandView, Street } from "../lib/postflop/hand";
import type { Stage } from "../lib/postflop/stage";
import { cn } from "../lib/cn";
import { PlayingCard } from "./PlayingCard";

/**
 * The table, as a table.
 *
 * The preflop drill draws a six handed ring because the seat you are in is the
 * whole question there. Here there are two players and the question is the
 * hand, so the felt is given over to the board, the pot and the two stacks, and
 * the animation carries the rest: cards land, chips go out in front of a seat,
 * the pot counts up when the street closes.
 *
 * Every animation here is a CSS transition on a mounted flag rather than a
 * keyframe library. There is nothing to sequence that the event walker upstairs
 * is not already sequencing.
 */

export interface HandTableProps {
  view: HandView;
  stage: Stage;
  /** Whose decision it is, for the ring around the seat. Null between hands. */
  turn: "you" | "opponent" | null;
  /** True while a street is being solved, which is the one wait worth naming. */
  thinking: boolean;
  reducedMotion: boolean;
}

const NEXT_STREET: Record<Street, Street | null> = {
  preflop: "flop",
  flop: "turn",
  turn: "river",
  river: null,
};

export function HandTable({ view, stage, turn, thinking, reducedMotion }: HandTableProps) {
  const showdown = stage.result?.ending === "showdown";
  const opponentCards = stage.result?.opponentHand ?? null;

  return (
    <div className="relative mx-auto w-full max-w-2xl select-none">
      <div className="relative rounded-[46%/34%] border-[6px] border-felt-rail bg-felt px-4 py-4 shadow-2xl">
        <Seat
          name="Opponent"
          stack={view.stacks.opponent}
          said={stage.said.opponent}
          active={turn === "opponent" || thinking}
          committed={stage.committed.opponent}
          reducedMotion={reducedMotion}
          cards={showdown && opponentCards ? opponentCards : null}
          // Face down from the deal. They have cards before the flop too.
          faceDown
        />

        <div className="my-2 flex flex-col items-center gap-2">
          <Board cards={view.board} shown={stage.boardShown} reducedMotion={reducedMotion} />
          <Pot amount={stage.pot} reducedMotion={reducedMotion} />
          {/* Named after the street being solved, which is the one about to
              arrive, not the one still on screen. */}
          {thinking && (
            <p className="animate-pulse text-xs text-muted" role="status">
              Solving the {NEXT_STREET[stage.street] ?? "hand"}
            </p>
          )}
        </div>

        <Seat
          name="You"
          stack={view.stacks.you}
          said={stage.said.you}
          active={turn === "you"}
          committed={stage.committed.you}
          reducedMotion={reducedMotion}
          cards={view.cards}
          faceDown={false}
        />
      </div>
    </div>
  );
}

function Seat({
  name,
  stack,
  said,
  active,
  committed,
  cards,
  faceDown,
  reducedMotion,
}: {
  name: string;
  stack: number;
  said: string | null;
  active: boolean;
  committed: number;
  cards: [Card, Card] | null;
  faceDown: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div
      className="grid items-center justify-center"
      style={{ gridTemplateColumns: "8rem auto 8rem" }}
    >
      {/* An empty gutter matching the one on the right, so the cards stay on
          the centre line whatever is said beside them. */}
      <div aria-hidden />

      <div className="flex min-w-0 flex-col items-center gap-1.5">
        <div className="flex h-[4.5rem] items-end gap-1.5">
          {cards ? (
            cards.map((card, at) => (
              <Land key={`${card}-${at}`} delay={at * 90} reducedMotion={reducedMotion}>
                <PlayingCard card={card} scale={0.62} />
              </Land>
            ))
          ) : faceDown ? (
            [0, 1].map((at) => (
              <Land key={at} delay={at * 90} reducedMotion={reducedMotion}>
                <CardBack />
              </Land>
            ))
          ) : null}
        </div>

        <div
          className={cn(
            "rounded-full border px-3 py-0.5 text-center transition-colors",
            active ? "border-accent bg-felt-rail" : "border-line/60 bg-felt-rail/60",
          )}
        >
          <span className="text-xs text-ink">{name}</span>
          <span className="ml-2 font-mono text-xs text-muted">{roundChips(stack)}bb</span>
        </div>
      </div>

      <div className="flex h-16 flex-col items-start justify-center gap-1 pl-2">
        {/* Keyed on what they said and how much is out, so a seat that acts
            twice on one street animates the second action too rather than
            silently swapping the text. */}
        {said && (
          <Land key={said} reducedMotion={reducedMotion}>
            <span className="whitespace-nowrap rounded bg-base/70 px-2 py-0.5 text-xs text-ink">
              {said}
            </span>
          </Land>
        )}
        {committed > 0 && (
          <Land key={committed} reducedMotion={reducedMotion}>
            <span className="flex items-center gap-1.5">
              <ChipIcon />
              <span className="font-mono text-xs text-ink">{roundChips(committed)}</span>
            </span>
          </Land>
        )}
      </div>
    </div>
  );
}

function Board({
  cards,
  shown,
  reducedMotion,
}: {
  cards: Card[];
  shown: number;
  reducedMotion: boolean;
}) {
  return (
    <div className="flex h-[3.9rem] items-center justify-center gap-1.5" aria-label="Board">
      {cards.slice(0, shown).map((card, at) => (
        // Keyed on the card so the three flop cards do not re-land when the
        // turn arrives; only the new one animates.
        <Land key={card} delay={at < 3 ? at * 110 : 0} reducedMotion={reducedMotion}>
          <PlayingCard card={card} scale={0.56} />
        </Land>
      ))}
    </div>
  );
}

/**
 * The pot, counting up rather than jumping.
 *
 * Poker software has done this forever and it is not decoration: the number
 * moving is what tells you chips went in, on a screen where the chips
 * themselves are a token rather than a stack.
 */
function Pot({ amount, reducedMotion }: { amount: number; reducedMotion: boolean }) {
  const shown = useCountUp(amount, reducedMotion);
  return (
    <div className="flex items-center gap-2 rounded-full bg-felt-rail/80 px-3 py-1">
      <ChipIcon />
      <span className="font-mono text-sm text-ink">{roundChips(shown)}bb</span>
    </div>
  );
}

function ChipIcon() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full border-2 border-accent bg-felt-rail"
      aria-hidden
    />
  );
}

function CardBack() {
  return (
    <div
      className="rounded-lg border border-felt-rail bg-gradient-to-br from-raised to-base shadow-lg ring-1 ring-black/30"
      style={{ width: `${4.5 * 0.62}rem`, height: `${6.25 * 0.62}rem` }}
      role="img"
      aria-label="Face down card"
    />
  );
}

/** Fades and slides its child in once, on mount. */
function Land({
  children,
  delay = 0,
  reducedMotion,
}: {
  children: React.ReactNode;
  delay?: number;
  reducedMotion: boolean;
}) {
  const [landed, setLanded] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setTimeout(() => setLanded(true), delay);
    return () => clearTimeout(timer);
  }, [delay, reducedMotion]);

  return (
    <div
      className={cn(
        "transition-all duration-300 ease-out",
        landed ? "translate-y-0 scale-100 opacity-100" : "-translate-y-3 scale-95 opacity-0",
      )}
    >
      {children}
    </div>
  );
}

/** Tween a number toward its target, so a pot grows rather than teleports. */
function useCountUp(target: number, reducedMotion: boolean): number {
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (reducedMotion) {
      setShown(target);
      return;
    }

    let frame = 0;
    const from = shown;
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 400);
      // Ease out, so the last blind of a big pot is still readable.
      setShown(from + (target - from) * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `shown` is the starting point, not an input: depending on it would
    // restart the tween on every frame it sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reducedMotion]);

  return shown;
}

/** The OS-level "stop moving things" setting, which this screen has to respect. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
