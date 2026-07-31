import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names, letting a later Tailwind utility win over an earlier one in the same group.
 *
 * The convention every shadcn component is written against: `clsx` handles conditionals, `twMerge` makes
 * `cn("p-2", "p-4")` resolve to `p-4` rather than emitting both and depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
