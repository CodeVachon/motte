import { stateCategory, type Config } from "./config.js";
import type { Issue } from "./schema/issue.js";

export interface DependencyProblem {
    kind: "dependency-cycle" | "missing-blocker" | "self-blocked" | "started-while-blocked";
    issues: Issue[];
    message: string;
}

/** An issue is settled when no further work is expected of it. */
export function isSettled(config: Config, issue: Issue): boolean {
    const category = stateCategory(config, issue.state);
    return category === "completed" || category === "cancelled";
}

/**
 * Blockers of `issue` that are not yet settled.
 *
 * A cancelled blocker counts as settled: work that has been abandoned will never complete, so
 * treating it as blocking would deadlock everything downstream of it forever.
 */
export function openBlockers(config: Config, issues: Issue[], issue: Issue): Issue[] {
    if (issue.blockedBy === undefined || issue.blockedBy.length === 0) return [];

    const byId = new Map(issues.map((candidate) => [candidate.id, candidate]));

    return issue.blockedBy
        .map((id) => byId.get(id))
        .filter((blocker): blocker is Issue => blocker !== undefined && !isSettled(config, blocker))
        .sort((a, b) => a.id - b.id);
}

export function isBlocked(config: Config, issues: Issue[], issue: Issue): boolean {
    return openBlockers(config, issues, issue).length > 0;
}

/**
 * Ready means: still to be done, and nothing is standing in the way.
 *
 * This is the question an agent actually has at the start of a session, and it is deliberately
 * computed rather than stored — a readiness field in a hand-edited file would go stale the first
 * time someone closed a blocker without touching what it blocked.
 */
export function isReady(config: Config, issues: Issue[], issue: Issue): boolean {
    return !isSettled(config, issue) && !isBlocked(config, issues, issue);
}

export function ready(config: Config, issues: Issue[]): Issue[] {
    return issues.filter((issue) => isReady(config, issues, issue));
}

export function blocked(config: Config, issues: Issue[]): Issue[] {
    return issues.filter((issue) => !isSettled(config, issue) && isBlocked(config, issues, issue));
}

/** The derived inverse of `blockedBy`: issues that name `id` as a blocker. */
export function blocks(issues: Issue[], id: number): Issue[] {
    return issues
        .filter((issue) => (issue.blockedBy ?? []).includes(id))
        .sort((a, b) => a.id - b.id);
}

/**
 * Walk the blocker graph from `id` and return the cycle path if one exists.
 *
 * Separate from the parent-cycle check in `tree.ts` — that walks a single `parent` link, this walks
 * a fan-out of `blockedBy` edges, so it needs a depth-first search rather than a linear climb.
 */
export function findDependencyCycle(issues: Issue[], id: number): number[] | undefined {
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const path: number[] = [];
    const onPath = new Set<number>();
    const settled = new Set<number>();

    const visit = (current: number): number[] | undefined => {
        if (onPath.has(current)) return [...path.slice(path.indexOf(current)), current];
        if (settled.has(current)) return undefined;

        path.push(current);
        onPath.add(current);

        for (const blocker of byId.get(current)?.blockedBy ?? []) {
            const found = visit(blocker);
            if (found) return found;
        }

        path.pop();
        onPath.delete(current);
        settled.add(current);
        return undefined;
    };

    return visit(id);
}

/**
 * Would adding `blocker` to `issue`'s blockers close a cycle? Returns the offending path, so the
 * caller can name it in an error rather than just refusing.
 */
export function cycleIfBlocked(issues: Issue[], id: number, blocker: number): number[] | undefined {
    if (id === blocker) return [id, id];

    const hypothetical = issues.map((issue) =>
        issue.id === id ? { ...issue, blockedBy: [...(issue.blockedBy ?? []), blocker] } : issue
    );

    return findDependencyCycle(hypothetical, id);
}

/** Every dependency problem in the backlog, for `motte doctor`. */
export function dependencyProblems(config: Config, issues: Issue[]): DependencyProblem[] {
    const problems: DependencyProblem[] = [];
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const reported = new Set<string>();

    for (const issue of issues) {
        for (const blockerId of issue.blockedBy ?? []) {
            if (blockerId === issue.id) {
                problems.push({
                    kind: "self-blocked",
                    issues: [issue],
                    message: `#${issue.id} lists itself as a blocker`
                });
            } else if (!byId.has(blockerId)) {
                problems.push({
                    kind: "missing-blocker",
                    issues: [issue],
                    message: `#${issue.id} is blocked by #${blockerId}, which does not exist`
                });
            }
        }

        const cycle = findDependencyCycle(issues, issue.id);
        if (cycle !== undefined && cycle.length > 2) {
            // Normalise so the same cycle reported from each of its members collapses to one entry.
            const key = [...cycle.slice(0, -1)].sort((a, b) => a - b).join(",");
            if (!reported.has(key)) {
                reported.add(key);
                problems.push({
                    kind: "dependency-cycle",
                    issues: cycle
                        .map((cycleId) => byId.get(cycleId))
                        .filter((x): x is Issue => !!x),
                    message:
                        `dependency cycle, so nothing in it can ever be ready: ` +
                        cycle.map((cycleId) => `#${cycleId}`).join(" → ")
                });
            }
        }

        // Working on something whose prerequisites are not done is usually a mistake, but it is the
        // author's call — a warning rather than an error.
        if (stateCategory(config, issue.state) === "started") {
            const open = openBlockers(config, issues, issue);
            if (open.length > 0) {
                problems.push({
                    kind: "started-while-blocked",
                    issues: [issue, ...open],
                    message:
                        `#${issue.id} is in "${issue.state}" but is still blocked by ` +
                        open.map((blocker) => `#${blocker.id}`).join(", ")
                });
            }
        }
    }

    return problems;
}
