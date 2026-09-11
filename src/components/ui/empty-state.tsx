import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  /** What is not here. A statement, not a question. */
  title: string;
  /** How it gets filled. This is the whole point of the component. */
  instruction: string;
  action?: ReactNode;
  className?: string;
}

/**
 * No illustration, no shrug icon, no centred grey circle. An empty screen is a
 * chance to say what to do next, so it says it.
 */
export function EmptyState({ title, instruction, action, className }: EmptyStateProps) {
  return (
    <div className={cn("border-line max-w-prose border-t pt-5", className)}>
      <p className="font-display text-ink text-xl font-bold">{title}</p>
      <p className="text-ink-soft mt-1.5 text-base">{instruction}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
