"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type InputSize = "md" | "touch";

const SIZE: Record<InputSize, { field: string; text: string; pad: string }> = {
  md: { field: "h-12", text: "text-base", pad: "px-3.5" },
  touch: { field: "h-14", text: "text-lg", pad: "px-4" },
};

// `prefix` is dropped from the DOM props: it is an RDFa string attribute there,
// and a currency mark rendered inside the field is what it means here.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  label: string;
  /** Hidden visually but still read out — for a field whose purpose is obvious. */
  hideLabel?: boolean;
  hint?: string;
  /** Sets the invalid state and replaces the hint. Say what to do, not sorry. */
  error?: string;
  size?: InputSize;
  /** Barcodes, SKUs, prices: mono with locked advance widths. */
  mono?: boolean;
  /** Sits inside the field, before the text — a currency mark, for instance. */
  prefix?: ReactNode;
  /** Sits inside the field, after the text — a unit, a clear button. */
  suffix?: ReactNode;
}

export function Input({
  label,
  hideLabel = false,
  hint,
  error,
  size = "md",
  mono = false,
  prefix,
  suffix,
  className,
  id,
  disabled,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const invalid = Boolean(error);

  return (
    <div className={cn("flex flex-col", className)}>
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
          "bg-card flex items-stretch rounded-md border transition-colors",
          "focus-within:outline-ink focus-within:outline-2 focus-within:outline-offset-2",
          SIZE[size].field,
          invalid ? "border-stop focus-within:border-stop" : "border-line focus-within:border-ink",
          disabled && "bg-paper border-line",
        )}
      >
        {prefix ? (
          <span
            aria-hidden="true"
            className={cn(
              "text-ink-soft flex items-center pl-3.5 font-mono tabular-nums select-none",
              SIZE[size].text,
            )}
          >
            {prefix}
          </span>
        ) : null}

        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={hint || error ? messageId : undefined}
          className={cn(
            "text-ink placeholder:text-ink-soft/70 min-w-0 flex-1 bg-transparent outline-none",
            "disabled:text-ink-soft disabled:cursor-not-allowed",
            SIZE[size].text,
            SIZE[size].pad,
            prefix && "pl-2",
            suffix && "pr-2",
            mono && "font-mono tabular-nums",
          )}
          {...props}
        />

        {suffix ? (
          <span
            className={cn(
              "text-ink-soft flex items-center pr-3.5 select-none",
              SIZE[size].text === "text-lg" ? "text-base" : "text-sm",
            )}
          >
            {suffix}
          </span>
        ) : null}
      </div>

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
