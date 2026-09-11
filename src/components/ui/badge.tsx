import { cn } from "@/lib/cn";

/**
 * The four states that are the whole mental model of the app, plus a neutral.
 * Consumers map draft/inventory statuses onto these — the badge itself stays
 * a fixed vocabulary so the same colour never means two things.
 */
export type BadgeTone = "matched" | "new" | "queued" | "failed" | "neutral";
export type BadgeSize = "sm" | "md";

const TONE: Record<BadgeTone, { surface: string; glyph: string }> = {
  matched: { surface: "bg-ok/10 border-ok/35", glyph: "text-ok" },
  new: { surface: "bg-ink/6 border-ink/20", glyph: "text-ink" },
  queued: { surface: "bg-warn/12 border-warn/35", glyph: "text-warn" },
  failed: { surface: "bg-stop/10 border-stop/35", glyph: "text-stop" },
  neutral: { surface: "bg-card border-line", glyph: "text-ink-soft" },
};

/**
 * Each tone gets its own silhouette as well as its own hue, so the state
 * survives colourblindness, glare and a scuffed phone screen. The label always
 * stays --ink: the mid-luminance status hues do not clear 4.5:1 as text.
 */
function Glyph({ tone }: { tone: BadgeTone }) {
  const common = {
    viewBox: "0 0 8 8",
    className: cn("size-2 shrink-0", TONE[tone].glyph),
  } as const;
  switch (tone) {
    case "matched":
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="4" cy="4" r="3.6" fill="currentColor" />
        </svg>
      );
    case "new":
      return (
        <svg {...common} aria-hidden="true">
          <rect x="0.4" y="0.4" width="7.2" height="7.2" rx="1.2" fill="currentColor" />
        </svg>
      );
    case "queued":
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="4" cy="4" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M4 0.9a3.1 3.1 0 0 1 0 6.2z" fill="currentColor" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 0.4 7.8 7.6H0.2z" fill="currentColor" />
        </svg>
      );
    case "neutral":
      return (
        <svg {...common} aria-hidden="true">
          <rect x="0.4" y="3" width="7.2" height="2" rx="1" fill="currentColor" />
        </svg>
      );
  }
}

const SIZE: Record<BadgeSize, string> = {
  sm: "h-6 gap-1.5 px-2 text-2xs",
  md: "h-7 gap-2 px-2.5 text-xs",
};

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Numerals — a count, a price — switch to mono with locked advance widths. */
  mono?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Badge({
  tone = "neutral",
  size = "sm",
  mono = false,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "text-ink inline-flex items-center rounded-sm border font-medium",
        TONE[tone].surface,
        SIZE[size],
        mono && "font-mono tabular-nums",
        className,
      )}
    >
      <Glyph tone={tone} />
      {children}
    </span>
  );
}
