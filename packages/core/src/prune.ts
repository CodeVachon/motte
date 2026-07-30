import { isSettled } from "./deps.js";
import { eventsFor } from "./events.js";
import { stateCategory, type Config } from "./config.js";
import type { Event } from "./schema/event.js";
import type { Issue } from "./schema/issue.js";

/** Why an otherwise-eligible issue is being left alone. */
export type SkipReason =
    | { kind: "not-settled"; state: string }
    | { kind: "too-recent"; settledAt: string }
    | { kind: "referenced"; by: number[]; as: "parent" | "blocker" | "both" }
    | { kind: "no-file" };

export interface Skipped {
    issue: Issue;
    reason: SkipReason;
}

export interface PrunePlan {
    prunable: Issue[];
    skipped: Skipped[];
}

export function describeSkip(reason: SkipReason): string {
    switch (reason.kind) {
        case "not-settled":
            return `still in "${reason.state}"`;
        case "too-recent":
            return `settled ${reason.settledAt.slice(0, 10)}, after the cutoff`;
        case "referenced":
            return (
                `still referenced as a ${reason.as === "both" ? "parent and blocker" : reason.as} by ` +
                reason.by.map((id) => `#${id}`).join(", ")
            );
        case "no-file":
            return "has no file on disk";
    }
}

/**
 * When an issue became settled, from the event log.
 *
 * Not `updated`, which moves on any edit — a completed issue that later gets a note would look freshly
 * settled and never become eligible. Falls back to `updated` for issues that predate the log, which is
 * the best available answer for them.
 */
export function settledAt(config: Config, events: Event[], issue: Issue): string | undefined {
    if (!isSettled(config, issue)) return undefined;

    const transitions = eventsFor(events, issue.id).filter(
        (event) => event.type === "state" || event.type === "created"
    );

    const landedIn = (index: number): string | undefined => {
        const event = transitions[index];
        if (event === undefined) return undefined;
        return event.type === "state" ? event.to : event.state;
    };

    const isSettledState = (state: string | undefined): boolean => {
        if (state === undefined) return false;
        const category = stateCategory(config, state);
        return category === "completed" || category === "cancelled";
    };

    // The last transition into any settled state.
    let index = -1;
    for (let i = transitions.length - 1; i >= 0; i -= 1) {
        if (isSettledState(landedIn(i))) {
            index = i;
            break;
        }
    }

    if (index === -1) return issue.updated;

    /**
     * Walk back to the start of the current unbroken run of settled states.
     *
     * A Done → Cancelled move should report when the work actually stopped, not when its label last
     * changed. Reopening breaks the run, so work that was finished, reopened and finished again reports
     * the second finish.
     */
    while (index > 0 && isSettledState(landedIn(index - 1))) index -= 1;

    return transitions[index]!.at;
}

/**
 * Decide what a prune would remove.
 *
 * Pure, so the eligibility rules can be tested without a git repository or a filesystem. `cutoff` is an
 * ISO timestamp; anything settled at or before it is a candidate.
 */
export function planPrune(
    config: Config,
    issues: Issue[],
    events: Event[],
    cutoff: string
): PrunePlan {
    const prunable: Issue[] = [];
    const skipped: Skipped[] = [];

    // Candidates first, so references between two prunable issues do not keep each other alive.
    const candidates = new Set<number>();

    for (const issue of issues) {
        if (!isSettled(config, issue)) continue;
        const when = settledAt(config, events, issue);
        if (when !== undefined && when <= cutoff) candidates.add(issue.id);
    }

    for (const issue of issues) {
        if (!isSettled(config, issue)) {
            skipped.push({
                issue,
                reason: { kind: "not-settled", state: issue.state }
            });
            continue;
        }

        const when = settledAt(config, events, issue) ?? issue.updated;
        if (when > cutoff) {
            skipped.push({ issue, reason: { kind: "too-recent", settledAt: when } });
            continue;
        }

        if (issue.filePath === undefined) {
            skipped.push({ issue, reason: { kind: "no-file" } });
            continue;
        }

        /**
         * Anything still referenced by a survivor stays.
         *
         * Removing it would leave a dangling `parent` or `blockedBy`, which `doctor` reports as an
         * error — so an unrestricted prune would trade disk space for a permanently broken backlog.
         * Rewriting the survivor's references instead would destroy information in the survivor to
         * save space elsewhere. Refusing means a settled subtree goes whole or not at all, and
         * `doctor` stays clean by construction.
         */
        const parentedBy = issues
            .filter((other) => other.parent === issue.id && !candidates.has(other.id))
            .map((other) => other.id);

        const blockedBy = issues
            .filter(
                (other) => (other.blockedBy ?? []).includes(issue.id) && !candidates.has(other.id)
            )
            .map((other) => other.id);

        if (parentedBy.length > 0 || blockedBy.length > 0) {
            skipped.push({
                issue,
                reason: {
                    kind: "referenced",
                    by: [...new Set([...parentedBy, ...blockedBy])].sort((a, b) => a - b),
                    as:
                        parentedBy.length > 0 && blockedBy.length > 0
                            ? "both"
                            : parentedBy.length > 0
                              ? "parent"
                              : "blocker"
                }
            });
            continue;
        }

        prunable.push(issue);
    }

    return { prunable, skipped: skipped.sort((a, b) => a.issue.id - b.issue.id) };
}

/**
 * Remove the pruned issues' events from a shard's lines, keeping everything else.
 *
 * Pure so it is testable. This is the one operation that breaks the append-only property the shards
 * rely on to stay merge-conflict-free, which is the strongest reason pruning must never run
 * automatically.
 */
export function stripEventsFor(lines: string[], ids: Set<number>): string[] {
    return lines.filter((line) => {
        if (line.trim().length === 0) return false;

        try {
            const parsed = JSON.parse(line) as { id?: unknown; type?: unknown };
            // Tombstones are kept: they are the record that the issue existed and how to get it back.
            if (parsed.type === "pruned" || parsed.type === "restored") return true;
            return typeof parsed.id !== "number" || !ids.has(parsed.id);
        } catch {
            // An unreadable line is left alone rather than silently dropped by a maintenance command.
            return true;
        }
    });
}

/** Resolve `--before` into an ISO cutoff. Accepts `YYYY-MM`, `YYYY-MM-DD`, or a span like `90d`. */
export function parseCutoff(input: string, now: Date = new Date()): string {
    const trimmed = input.trim();

    const span = /^(\d+)([dw])$/.exec(trimmed);
    if (span) {
        const amount = Number.parseInt(span[1]!, 10);
        const seconds = span[2] === "w" ? 604800 : 86400;
        return `${new Date(now.getTime() - amount * seconds * 1000).toISOString().slice(0, 19)}Z`;
    }

    if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01T00:00:00Z`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00Z`;

    if (/^\d+$/.test(trimmed)) {
        throw new Error(`"${input}" has no unit. Did you mean ${trimmed}d?`);
    }

    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
        throw new Error(
            `could not read "${input}" as a cutoff. Use 2026-01, 2026-01-15, or a span like 90d.`
        );
    }

    return `${new Date(parsed).toISOString().slice(0, 19)}Z`;
}
