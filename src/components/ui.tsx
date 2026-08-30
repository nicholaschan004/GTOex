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

export function Chip({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-felt bg-felt text-ink"
          : "border-line text-muted hover:border-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function ActionButton({
  children,
  onClick,
  shortcut,
  emphasis = false,
  price = null,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  shortcut: string;
  emphasis?: boolean;
  /** The size, on its own line. Null for actions that do not have one. */
  price?: string | null;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Flex column so a button with a size under it and a button without
        // one still centre their labels against each other; the row stretches
        // them to a common height on its own.
        "flex flex-col justify-center rounded-lg px-6 py-2.5 transition-colors",
        emphasis
          ? "bg-felt text-ink hover:bg-felt/80"
          : "border border-line bg-raised text-ink hover:bg-line",
        disabled && "opacity-40",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-base">{children}</span>
        <span className="font-mono text-xs text-muted">{shortcut}</span>
      </span>
      {/* The size sits under the action rather than inside the label, so the
          button still reads as one word at a glance and the price is there
          when you look for it. */}
      {price && <span className="mt-0.5 block font-mono text-xs text-muted">{price}</span>}
    </button>
  );
}
