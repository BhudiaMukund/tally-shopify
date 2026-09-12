"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  /** Repeats the verb from the button that caused it: "Stock updated". */
  title: string;
  /** What it means, or what to do next. Never an apology. */
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
}

type GlyphShape = "check" | "alert" | "rule";

const TONE: Record<ToastTone, { glyph: string; shape: GlyphShape }> = {
  success: { glyph: "text-ok", shape: "check" },
  error: { glyph: "text-stop", shape: "alert" },
  info: { glyph: "text-ink-soft", shape: "rule" },
};

function ToneGlyph({ tone }: { tone: ToastTone }) {
  const shape = TONE[tone].shape;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-4 shrink-0", TONE[tone].glyph)}>
      {shape === "check" ? (
        <>
          <circle cx="8" cy="8" r="7.2" fill="currentColor" />
          <path
            d="M4.8 8.3 7 10.4l4.2-4.5"
            fill="none"
            stroke="var(--color-card)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : shape === "alert" ? (
        <>
          <path d="M8 0.8 15.6 15H0.4z" fill="currentColor" />
          <path d="M8 5.6v4" stroke="var(--color-card)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="12.4" r="1" fill="var(--color-card)" />
        </>
      ) : (
        <rect x="0.8" y="6" width="14.4" height="4" rx="2" fill="currentColor" />
      )}
    </svg>
  );
}

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

/** Call from any client component under `<ToastProvider>`. */
export function useToast(): (options: ToastOptions) => void {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used inside <ToastProvider>");
  return toast;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    setItems((current) => [...current, { ...options, id: nextId.current }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    // Let the close animation finish before the node leaves the tree.
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 250);
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      <RadixToast.Provider swipeDirection="down" duration={4000}>
        {children}
        {items.map((item) => (
          <ToastItem key={item.id} item={item} onClosed={() => dismiss(item.id)} />
        ))}
        <RadixToast.Viewport
          className={cn(
            "fixed inset-x-0 bottom-0 z-60 m-0 flex list-none flex-col gap-2 p-4 outline-none",
            "sm:inset-x-auto sm:right-0 sm:bottom-0 sm:w-96",
          )}
          style={{ paddingBottom: "calc(1rem + var(--safe-bottom))" }}
        />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

function ToastItem({ item, onClosed }: { item: ToastRecord; onClosed: () => void }) {
  const tone = item.tone ?? "info";
  // An error has to be readable before it leaves; a confirmation does not.
  const duration = item.durationMs ?? (tone === "error" ? 8000 : 4000);

  return (
    <RadixToast.Root
      duration={duration}
      onOpenChange={(open) => {
        if (!open) onClosed();
      }}
      className={cn(
        "bg-card border-line shadow-float grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border p-3.5",
        "data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out",
        "data-[swipe=end]:animate-toast-swipe-out",
        "data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)] data-[swipe=move]:transition-none",
        "data-[swipe=cancel]:translate-y-0 data-[swipe=cancel]:transition-transform",
      )}
    >
      <span className="pt-0.5">
        <ToneGlyph tone={tone} />
      </span>

      <div className="min-w-0">
        <RadixToast.Title className="text-ink text-sm font-semibold">{item.title}</RadixToast.Title>
        {item.description ? (
          <RadixToast.Description className="text-ink-soft mt-0.5 text-sm">
            {item.description}
          </RadixToast.Description>
        ) : null}
        {item.action ? (
          <RadixToast.Action
            altText={item.action.label}
            onClick={item.action.onClick}
            className={cn(
              "text-ink mt-2 -ml-2 inline-flex h-9 cursor-pointer items-center rounded-md px-2 text-sm font-semibold",
              "hover:bg-ink/6 underline underline-offset-4 transition-colors duration-120",
            )}
          >
            {item.action.label}
          </RadixToast.Action>
        ) : null}
      </div>

      <RadixToast.Close
        aria-label="Dismiss"
        className={cn(
          "text-ink-soft -mt-1 -mr-1 flex size-8 cursor-pointer items-center justify-center rounded-md",
          "hover:bg-ink/6 hover:text-ink transition-colors duration-120",
        )}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </RadixToast.Close>
    </RadixToast.Root>
  );
}
