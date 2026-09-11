"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export type SheetSide = "bottom" | "right";

const SIDE: Record<SheetSide, string> = {
  // Phone: rises from the thumb end of the screen.
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t data-[state=open]:animate-sheet-up data-[state=closed]:animate-sheet-down",
  // Desktop: a panel beside the list it came from, so context stays on screen.
  right:
    "inset-y-0 right-0 w-full max-w-md border-l data-[state=open]:animate-sheet-left data-[state=closed]:animate-sheet-right",
};

export interface SheetContentProps {
  /** Always required — it is the accessible name, even when not shown. */
  title: string;
  description?: string;
  /** Hides the title visually while keeping it for screen readers. */
  hideTitle?: boolean;
  side?: SheetSide;
  /** Pinned below the scroll region, clear of the Android gesture bar. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function SheetContent({
  title,
  description,
  hideTitle = false,
  side = "bottom",
  footer,
  className,
  children,
}: SheetContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay
        className={cn(
          "bg-ink/45 fixed inset-0 z-40",
          "data-[state=open]:animate-scrim-in data-[state=closed]:animate-scrim-out",
        )}
      />
      <Dialog.Content
        // Radix would otherwise focus the close button, which puts a loud focus
        // ring on the one control nobody opened the sheet to press. Focus lands
        // on the panel instead; the trap and Escape still behave the same.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        className={cn(
          "bg-card border-line shadow-float fixed z-50 flex flex-col focus:outline-none",
          SIDE[side],
          className,
        )}
      >
        {side === "bottom" ? (
          <div aria-hidden="true" className="flex justify-center pt-2.5 pb-1">
            <span className="bg-line h-1 w-9 rounded-full" />
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-start gap-4 px-5",
            side === "bottom" ? "pt-2 pb-4" : "pt-5 pb-4",
          )}
        >
          <div className="min-w-0 flex-1">
            {hideTitle ? (
              <VisuallyHidden asChild>
                <Dialog.Title>{title}</Dialog.Title>
              </VisuallyHidden>
            ) : (
              <Dialog.Title className="font-display text-ink text-xl font-bold">
                {title}
              </Dialog.Title>
            )}
            {description ? (
              <Dialog.Description className="text-ink-soft mt-1 text-sm">
                {description}
              </Dialog.Description>
            ) : null}
          </div>

          <Dialog.Close
            aria-label="Close"
            className={cn(
              "text-ink-soft -mt-1.5 -mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md",
              "hover:bg-ink/6 hover:text-ink transition-colors duration-120",
            )}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </Dialog.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>

        {footer ? (
          <div
            className="border-line bg-card border-t px-5 pt-4"
            style={{ paddingBottom: "calc(1rem + var(--safe-bottom))" }}
          >
            {footer}
          </div>
        ) : null}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
