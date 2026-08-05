import type { Issue } from "./schema/issue.js";

/**
 * The everyday filters, in one place.
 *
 * `motte list`, `motte ready` and the MCP read tools each had their own copy of these — label and assignee
 * character for character, which fallow found as two clone groups across `commands/deps.ts` and
 * `mcp/tools/reads.ts`. Three copies of "compare lowercased" is three chances for one of them to start
 * treating a label differently from the others, and nothing would notice.
 *
 * Everything is compared case-insensitively, because these are typed by hand at least as often as they are
 * generated. An absent field filters nothing rather than matching nothing: `{}` keeps every issue.
 */

export interface IssueFilter {
    state?: string | undefined;
    label?: string | undefined;
    assignee?: string | undefined;
    /** An id, already resolved — this layer does not know how to turn a title fragment into one. */
    parent?: number | undefined;
}

export interface FilterOptions {
    /**
     * How `state` is matched.
     *
     * `prefix` for a person typing `--state don`; `exact` for a caller that has the state name in hand,
     * which is what the MCP tools pass. The difference is deliberate and predates this module — collapsing
     * the two would either break `motte list --state don` or silently widen the MCP tools' contract.
     */
    stateMatch?: "exact" | "prefix";
}

export function matchesFilter(
    issue: Issue,
    filter: IssueFilter,
    options: FilterOptions = {}
): boolean {
    if (filter.state !== undefined) {
        const needle = filter.state.toLowerCase();
        const state = issue.state.toLowerCase();
        const hit = options.stateMatch === "prefix" ? state.startsWith(needle) : state === needle;

        if (!hit) return false;
    }

    if (filter.label !== undefined) {
        const needle = filter.label.toLowerCase();
        if (!(issue.labels ?? []).some((label) => label.toLowerCase() === needle)) return false;
    }

    if (filter.assignee !== undefined) {
        if (issue.assignee?.toLowerCase() !== filter.assignee.toLowerCase()) return false;
    }

    if (filter.parent !== undefined && issue.parent !== filter.parent) return false;

    return true;
}

export function filterIssues(
    issues: readonly Issue[],
    filter: IssueFilter,
    options: FilterOptions = {}
): Issue[] {
    return issues.filter((issue) => matchesFilter(issue, filter, options));
}
