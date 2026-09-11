import { cn } from "@/lib/cn";

export type SpinnerSize = "sm" | "md" | "lg";
export type SpinnerTone = "current" | "accent" | "soft";

const SIZE: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-5",
  lg: "size-8",
};

const TONE: Record<SpinnerTone, string> = {
  current: "text-current",
  accent: "text-accent",
  soft: "text-ink-soft",
};

export interface SpinnerProps {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  /** Announced to screen readers. Omit when adjacent text already says it. */
  label?: string;
  className?: string;
}

/**
 * Indeterminate progress. Marked `data-motion="essential"` so the global
 * reduced-motion reset slows it rather than freezing it — a stopped spinner
 * reads as a hung app, and there is no static way to say "still working".
 */
export function Spinner({ size = "md", tone = "current", label, className }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex items-center", className)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        data-motion="essential"
        className={cn("animate-turn shrink-0", SIZE[size], TONE[tone])}
      >
        <circle
          cx="12"
          cy="12"
          r="9.5"
          stroke="currentColor"
          strokeOpacity="0.22"
          strokeWidth="3"
        />
        <path
          d="M21.5 12A9.5 9.5 0 0 0 12 2.5"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
