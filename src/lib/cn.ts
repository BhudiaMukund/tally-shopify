import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose class names, letting a caller's utility win over a component default. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
