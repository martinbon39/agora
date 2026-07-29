/**
 * Key bar for touch devices: answering an agent's approval prompt needs keys
 * the virtual keyboard hides (Esc, arrows, Tab, Ctrl+C).
 */
const KEYS: [label: string, seq: string][] = [
  ["esc", "\x1b"],
  ["tab", "\t"],
  ["⇧tab", "\x1b[Z"],
  ["↑", "\x1b[A"],
  ["↓", "\x1b[B"],
  ["←", "\x1b[D"],
  ["→", "\x1b[C"],
  ["^C", "\x03"],
  ["⏎", "\r"],
];

export function QuickKeys({
  onKey,
  className,
}: {
  onKey: (seq: string) => void;
  className?: string;
}) {
  return (
    <div
      className={
        className ??
        "hidden shrink-0 gap-1.5 overflow-x-auto border-b border-border/60 bg-sidebar px-2 py-1.5 pointer-coarse:flex"
      }
    >
      {KEYS.map(([label, seq]) => (
        <button
          key={label}
          tabIndex={-1}
          onPointerDown={(e) => {
            // preventDefault: the tap must neither steal focus nor pop the
            // virtual keyboard — the key sequence goes straight to the pty
            e.preventDefault();
            onKey(seq);
          }}
          onClick={(e) => e.preventDefault()}
          className="h-9 min-w-11 shrink-0 rounded-lg border border-border bg-card px-2.5 font-mono text-[13px] text-muted-foreground shadow-xs transition-transform active:scale-90"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
