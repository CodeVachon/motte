import { stateCategory, type Config } from "./config.js";
import type { StateCategory } from "./schema/config.js";
import type { Issue } from "./schema/issue.js";
import { descendants } from "./tree.js";

export interface Progress {
    total: number;
    /** `total` minus cancelled — the denominator for `percentComplete`. */
    counted: number;
    completed: number;
    started: number;
    unstarted: number;
    cancelled: number;
    /** 0–100, rounded. 100 when there is nothing left to do, including when there is nothing at all. */
    percentComplete: number;
}

export interface ProjectReport extends Progress {
    name: string;
    byState: { state: string; category: StateCategory; count: number }[];
    inProgress: Issue[];
}

export interface SubtreeReport extends Progress {
    issue: Issue;
}

export function summarize(config: Config, issues: Issue[]): Progress {
    const buckets: Record<StateCategory, number> = {
        unstarted: 0,
        started: 0,
        completed: 0,
        cancelled: 0
    };

    for (const issue of issues) {
        // A state that is not in the config is counted as unstarted rather than dropped, so the
        // totals still add up while `motte doctor` reports the mismatch separately.
        buckets[stateCategory(config, issue.state) ?? "unstarted"] += 1;
    }

    // Cancelled work leaves the denominator entirely; otherwise abandoning an issue would
    // permanently cap a project below 100%.
    const counted = issues.length - buckets.cancelled;

    return {
        total: issues.length,
        counted,
        completed: buckets.completed,
        started: buckets.started,
        unstarted: buckets.unstarted,
        cancelled: buckets.cancelled,
        percentComplete: counted === 0 ? 100 : Math.round((buckets.completed / counted) * 100)
    };
}

export function projectReport(config: Config, issues: Issue[]): ProjectReport {
    const byState = config.states.map((state) => ({
        state: state.name,
        category: state.category,
        count: issues.filter((issue) => issue.state === state.name).length
    }));

    // States present on disk but absent from the config, so `status` never silently hides work.
    for (const issue of issues) {
        if (byState.some((entry) => entry.state === issue.state)) continue;
        byState.push({ state: issue.state, category: "unstarted", count: 0 });
        byState[byState.length - 1]!.count = issues.filter((i) => i.state === issue.state).length;
    }

    return {
        ...summarize(config, issues),
        name: config.name,
        byState,
        inProgress: issues.filter((issue) => stateCategory(config, issue.state) === "started")
    };
}

/** Progress for one issue's subtree, counting the issue itself alongside its descendants. */
export function subtreeReport(config: Config, issues: Issue[], id: number): SubtreeReport {
    const issue = issues.find((candidate) => candidate.id === id);
    if (!issue) throw new Error(`no issue #${id}`);

    const scope = [issue, ...descendants(issues, id)];
    return { ...summarize(config, scope), issue };
}

/** Every issue with children, with its rollup. Drives the epic view in reports. */
export function epicReports(config: Config, issues: Issue[]): SubtreeReport[] {
    const parents = new Set(
        issues
            .map((issue) => issue.parent)
            .filter((parent): parent is number => parent !== undefined)
    );

    return [...parents]
        .sort((a, b) => a - b)
        .filter((id) => issues.some((issue) => issue.id === id))
        .map((id) => subtreeReport(config, issues, id));
}

export function progressBar(percent: number, width = 24): string {
    const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}
