import { cn } from "../lib/cn";

/** Shared between the preflop and postflop drills, which are otherwise peers. */

export interface DrillBodyProps {
  /** Bumps when the user asks for the next hand. Deal on it. */
  round: number;
  /** Whether an answer is already in, so a body can ignore its action keys. */
  answered: boolean;
  /** Called once, when the user commits to an action. */
  onAnswer: (record: { key: string; label: string; correct: boolean }) => void;
}

/**
 * How a button is coloured, which is the same question as what the action is.
 *
 * Three tones rather than five, because folding and checking never appear
 * together -- a node offers one or the other -- so they can share the recessive
 * one. The hues are the range grid's: whatever colour you press an action in
 * here is the colour that action is drawn in on the grid afterwards.
 */
export type ActionTone = "fold" | "call" | "bet";

export function toneOf(kind: string): ActionTone {
  if (kind === "call") return "call";
  if (kind === "bet" || kind === "raise") return "bet";
  return "fold";
}

/**
 * The keyboard hint, on its own cap rather than in the label.
 *
 * Sitting it on the page colour instead of the button means one contrast ratio
 * to hold rather than one per button tone, and it reads as the key it is. It is
 * hidden on small screens: a phone has no 1 key, and the space is worth more.
 */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden shrink-0 rounded border border-line bg-page px-1.5 py-px font-mono text-[0.6875rem] leading-normal text-muted sm:inline-block">
      {children}
    </span>
  );
}

export function Chip({
  children,
  active,
  onClick,
  title,
  label,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
  /** Names the chip when what it shows changes with the screen width. */
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        // min-h-11 rather than padding alone: these are the smallest things on
        // the page to hit and they were 30px tall, under every touch guideline
        // there is. 44px is the one Apple and WCAG 2.5.5 both name.
        "inline-flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page",
        // Gold for the one you are on, which is already what gold means on this
        // screen -- it rings your own seat at the table. The old active chip was
        // felt green on a near-black page at 1.47:1, so which chip was selected
        // was close to unreadable.
        active
          ? "border-accent bg-raised font-medium text-ink"
          : "border-act-fold-edge text-muted hover:bg-act-fold hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A row of chips: one scrolling line on a phone, wrapped everywhere else.
 *
 * Six scenarios and four modes wrap to five rows on a 360px screen, which is
 * about a third of the phone spent on pickers before the table starts. A rail
 * hides some of the options, which is a real cost, but it is a smaller one than
 * making you scroll past the choice you already made to see the hand you are
 * playing.
 *
 * The vertical padding is not decoration: `overflow-x` other than visible
 * computes `overflow-y` to auto as well, and without room the focus ring on a
 * chip would be clipped by its own container.
 */
export function ChipRail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <nav
      className="-mx-3 flex gap-2 overflow-x-auto px-3 py-1 sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-0"
      aria-label={label}
    >
      {children}
    </nav>
  );
}

export function ActionButton({
  children,
  onClick,
  shortcut,
  tone = "fold",
  price = null,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  shortcut: string;
  tone?: ActionTone;
  /** The size, on its own line. Null for actions that do not have one. */
  price?: string | null;
  disabled?: boolean;
}) {
  // Compared out here rather than inside the cn() below, because
  // check-classes.mjs reads every string literal in a cn() call as a class
  // name and "bet" is not one. Keeping only real classes in there is what lets
  // the checker see these colours at all.
  const bet = tone === "bet";
  const call = tone === "call";
  const fold = tone === "fold";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Flex column so a button with a size under it and a button without
        // one still centre their labels against each other; the row stretches
        // them to a common height on its own.
        "flex min-h-12 flex-col items-center justify-center rounded-lg border px-3 py-2 transition-colors sm:px-6",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page",
        // Written out rather than looked up in a record so that the class
        // checker can see them. Every one of these colours has a floor it has
        // to clear and contrast.test.ts holds it there.
        bet && "border-act-bet-edge bg-act-bet text-ink hover:bg-act-bet-hi",
        call && "border-act-call-edge bg-act-call text-ink hover:bg-act-call-hi",
        // Fold is outlined rather than filled. It should be findable without
        // competing with the action you are usually being asked to consider,
        // so its edge does the standing-off and its fill stays near the page.
        fold && "border-act-fold-edge bg-act-fold text-ink hover:bg-act-fold-hi",
        disabled && "opacity-40",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-sm sm:text-base">{children}</span>
        <Keycap>{shortcut}</Keycap>
      </span>
      {/* The size sits under the action rather than inside the label, so the
          button still reads as one word at a glance and the price is there
          when you look for it.

          Ink, not muted. Muted is a colour for text on the page, and on a
          filled button it measured 2:1 -- the size under "Open" was the least
          readable thing on the screen. The smaller mono face is what makes it
          secondary here; it does not need to be dimmer as well. */}
      {price && <span className="mt-0.5 block font-mono text-xs text-ink">{price}</span>}
    </button>
  );
}

/**
 * A row of actions.
 *
 * On a phone they share the width evenly, because three buttons of natural
 * width wrap two-then-one and put the action you are most likely to want on a
 * line of its own. Above that they go back to their own widths and centre,
 * which reads better when there is room for it.
 *
 * The column count is an inline style for the reason the range grid's is: a
 * class built from a template string is a class Tailwind never generates.
 */
export function ActionRow({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div
      className="grid gap-2 sm:flex sm:flex-wrap sm:justify-center sm:gap-3"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      aria-label="Your options"
      role="group"
    >
      {children}
    </div>
  );
}
