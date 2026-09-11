"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/cn";

import {
  clampCount,
  DEFAULT_BOUNDS,
  parseCount,
  repeatDelay,
  stepCount,
  type CountBounds,
} from "./number-field.utils";

export type NumberFieldSize = "md" | "touch";

const SIZE: Record<NumberFieldSize, { stepper: string; value: string; text: string }> = {
  md: { stepper: "size-12", value: "h-12", text: "text-2xl" },
  // 64px steppers: a gloved thumb at arm's length, under fluorescent light.
  touch: { stepper: "size-16", value: "h-16", text: "text-4xl" },
};

export interface NumberFieldProps {
  label: string;
  hideLabel?: boolean;
  /** Controlled value. Omit and use `defaultValue` for uncontrolled. */
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  error?: string;
  size?: NumberFieldSize;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Emits a hidden input so the field works inside a plain form post. */
  name?: string;
  className?: string;
}

function StepGlyph({ direction }: { direction: -1 | 1 }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-1/3">
      <path
        d={direction === 1 ? "M12 4v16M4 12h16" : "M4 12h16"}
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The press target itself. Holds no state: the repeat timer belongs to the
 * field, so a stepper is just a button that reports presses.
 */
function Stepper({
  direction,
  disabled,
  label,
  controls,
  className,
  onPressStart,
  onPressEnd,
  onStep,
}: {
  direction: -1 | 1;
  disabled: boolean;
  label: string;
  controls: string;
  className: string;
  onPressStart: () => void;
  onPressEnd: () => void;
  onStep: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-controls={controls}
      className={className}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Keeps a long press from selecting text or raising the context menu.
        event.preventDefault();
        onPressStart();
      }}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onStep();
        }
      }}
    >
      <StepGlyph direction={direction} />
    </button>
  );
}

/**
 * A count field built for a thumb, not a mouse: oversized steppers either side
 * of a mono numeral, press-and-hold to run the count up, and a tick of motion
 * on every change so a press that did nothing is obvious.
 */
export function NumberField({
  label,
  hideLabel = false,
  value,
  defaultValue,
  onValueChange,
  min = DEFAULT_BOUNDS.min,
  max = DEFAULT_BOUNDS.max,
  step = DEFAULT_BOUNDS.step,
  hint,
  error,
  size = "touch",
  disabled = false,
  fullWidth = false,
  name,
  className,
}: NumberFieldProps) {
  const bounds: CountBounds = { min, max, step };
  const generatedId = useId();
  const inputId = `${generatedId}-value`;
  const messageId = `${generatedId}-message`;
  const invalid = Boolean(error);

  const [uncontrolled, setUncontrolled] = useState(() => clampCount(defaultValue ?? min, bounds));
  const current = value === undefined ? uncontrolled : clampCount(value, bounds);

  /** Free text while the field is being typed into; null means "show `current`". */
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(current);

  const [bumping, setBumping] = useState(false);

  // The hold timer fires outside React's render, so it reads the latest value
  // and bounds from here rather than from a closure captured on mount.
  const latest = useRef({ current, bounds });
  useEffect(() => {
    latest.current = { current, bounds };
  });

  function commit(next: number) {
    const clamped = clampCount(next, latest.current.bounds);
    if (value === undefined) setUncontrolled(clamped);
    if (clamped !== latest.current.current) {
      latest.current = { ...latest.current, current: clamped };
      onValueChange?.(clamped);
      // Restart the tick even if the previous one is still mid-flight.
      setBumping(false);
      requestAnimationFrame(() => setBumping(true));
    }
  }

  function bump(direction: -1 | 1) {
    setDraft(null);
    commit(stepCount(latest.current.current, direction, latest.current.bounds));
  }

  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopHold() {
    if (holdRef.current !== null) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  }

  function startHold(direction: -1 | 1) {
    stopHold();
    bump(direction);
    let repeats = 0;
    const tick = () => {
      bump(direction);
      repeats += 1;
      holdRef.current = setTimeout(tick, repeatDelay(repeats));
    };
    holdRef.current = setTimeout(tick, repeatDelay(0));
  }

  // A thumb that slides off the button still has to stop the count.
  useEffect(() => {
    const stop = () => {
      if (holdRef.current !== null) {
        clearTimeout(holdRef.current);
        holdRef.current = null;
      }
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      stop();
    };
  }, []);

  const stepperClass = cn(
    "bg-card text-ink flex shrink-0 cursor-pointer items-center justify-center",
    "duration-120 transition-colors hover:bg-paper active:bg-line/60",
    "disabled:text-ink-soft/45 disabled:bg-paper disabled:pointer-events-none",
    "touch-manipulation select-none",
    SIZE[size].stepper,
  );

  return (
    <div className={cn("flex flex-col", fullWidth && "w-full", className)}>
      <label
        htmlFor={inputId}
        className={cn(
          "text-ink mb-1.5 text-sm font-medium",
          hideLabel && "sr-only",
          disabled && "text-ink-soft",
        )}
      >
        {label}
      </label>

      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-md border",
          "focus-within:outline-ink focus-within:outline-2 focus-within:outline-offset-2",
          invalid ? "border-stop" : "border-line focus-within:border-ink",
          fullWidth ? "w-full" : "w-fit",
        )}
      >
        <Stepper
          direction={-1}
          disabled={disabled || current <= min}
          label={`Take one off ${label}`}
          controls={inputId}
          className={cn(stepperClass, "border-line border-r")}
          onPressStart={() => startHold(-1)}
          onPressEnd={() => stopHold()}
          onStep={() => bump(-1)}
        />

        <span
          className={cn(
            "bg-card flex min-w-0 flex-1 items-center justify-center px-4",
            SIZE[size].value,
            bumping && "animate-tick",
          )}
          onAnimationEnd={() => setBumping(false)}
        >
          <input
            id={inputId}
            role="spinbutton"
            aria-valuenow={current}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-invalid={invalid || undefined}
            aria-describedby={hint || error ? messageId : undefined}
            inputMode="numeric"
            autoComplete="off"
            // Without this the intrinsic 20-character width of an input blows
            // the field past a 360px screen.
            size={4}
            disabled={disabled}
            value={text}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const parsed = parseCount(text);
              setDraft(null);
              if (parsed !== null) commit(parsed);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                bump(1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                bump(-1);
              } else if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            className={cn(
              "text-ink w-full bg-transparent text-center font-mono font-medium tabular-nums outline-none",
              "disabled:text-ink-soft disabled:cursor-not-allowed",
              SIZE[size].text,
            )}
          />
        </span>

        <Stepper
          direction={1}
          disabled={disabled || current >= max}
          label={`Add one to ${label}`}
          controls={inputId}
          className={cn(stepperClass, "border-line border-l")}
          onPressStart={() => startHold(1)}
          onPressEnd={() => stopHold()}
          onStep={() => bump(1)}
        />
      </div>

      {name ? <input type="hidden" name={name} value={current} /> : null}

      {error ? (
        <p id={messageId} className="text-stop mt-1.5 flex items-start gap-1.5 text-xs">
          <svg viewBox="0 0 8 8" aria-hidden="true" className="mt-0.5 size-2 shrink-0">
            <path d="M4 0.4 7.8 7.6H0.2z" fill="currentColor" />
          </svg>
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-ink-soft mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
