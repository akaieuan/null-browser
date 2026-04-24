import { clsx, type ClassValue } from "clsx";
import { flushSync } from "react-dom";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

// Run a DOM mutation inside a View Transition when supported.
// flushSync forces React to apply the state update before the browser
// captures the post-snapshot; without it the transition sees no change.
// On browsers without the API, the mutation runs directly.
export function withViewTransition(fn: () => void) {
  const doc = document as DocumentWithViewTransition;
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(() => flushSync(fn));
  } else {
    fn();
  }
}
