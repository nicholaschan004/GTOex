/**
 * Phase 0 placeholder.
 *
 * Deliberately not a mock of the trainer. Rendering a fake table with invented
 * hands would make the scaffold look finished and would be the first thing to
 * mislead anyone who opened the deploy, so this screen says exactly what exists
 * so far and nothing more. It is replaced wholesale in phase 1 by the drill loop.
 */
export default function App() {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          {/* Not font-mono: in a monospace face the capital O is a near twin
              of a zero, so the wordmark reads as "GT0ex". Mono is reserved for
              figures, where the tabular alignment is the point. */}
          <h1 className="text-4xl font-semibold tracking-tight text-ink">GTOex</h1>
          <p className="text-sm text-muted">Preflop trainer</p>
        </div>

        <div className="rounded-lg border border-line bg-surface p-5 text-left">
          <p className="text-sm text-muted">
            Scaffold only. The range parser, chart data and drill loop are not
            built yet.
          </p>
        </div>
      </div>
    </main>
  );
}
