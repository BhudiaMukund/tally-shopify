import type { ButtonHTMLAttributes, Ref } from "react";

import { cn } from "@/lib/cn";

import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "touch";

const VARIANT: Record<ButtonVariant, string> = {
  // --accent is the single primary action on a screen. Nothing else uses it.
  primary: "bg-accent text-white hover:bg-accent-deep active:bg-accent-deep",
  secondary: "bg-card text-ink border-line hover:bg-paper active:bg-line/50",
  ghost: "text-ink-soft hover:bg-ink/6 hover:text-ink active:bg-ink/10",
  danger: "bg-stop text-white hover:bg-stop-deep active:bg-stop-deep",
};

/**
 * Every size clears the 44px touch floor; `touch` is the 56px bar used for the
 * one primary action on a phone screen.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: "h-11 gap-1.5 px-3.5 text-sm",
  md: "h-12 gap-2 px-4 text-base",
  touch: "h-14 gap-2.5 px-6 text-lg",
};

const SPINNER_SIZE: Record<ButtonSize, "sm" | "md"> = { sm: "sm", md: "sm", touch: "md" };

export function buttonClassName({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex cursor-pointer items-center justify-center rounded-md border border-transparent font-semibold",
    "whitespace-nowrap select-none",
    "transition-[background-color,color,translate] duration-120 ease-snap active:translate-y-px",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
    VARIANT[variant],
    SIZE[size],
    fullWidth && "w-full",
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner in place of the leading slot and blocks further presses. */
  loading?: boolean;
  /** React 19 passes ref as a plain prop; Radix `asChild` triggers rely on it. */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Buttons name the action that happens: "Update stock", "Publish 6 products".
 * Never an arrow glued to the label.
 */
export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={buttonClassName({
        variant,
        size,
        fullWidth,
        // A button that is busy is not a button that is unavailable: it keeps
        // its colour and only stops accepting presses.
        className: cn(loading && !disabled && "disabled:opacity-100", className),
      })}
      {...props}
    >
      {loading ? <Spinner size={SPINNER_SIZE[size]} tone="current" /> : null}
      {children}
    </button>
  );
}
