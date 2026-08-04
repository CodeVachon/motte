import type { Backlog } from "../lib/useBacklog.js";
import type { ConfigResponse, IssueResponse, StatusResponse } from "../lib/api.js";

/**
 * Fixtures for the view tests.
 *
 * The views take a `Backlog` and nothing else, so they can be rendered against a hand-built one with no
 * server, no fetch and no timers. That was the point of putting all the fetching in one hook: everything
 * downstream of it is a function from data to markup.
 */

export function issue(overrides: Partial<IssueResponse> = {}): IssueResponse {
    return {
        id: 1,
        title: "An issue",
        state: "Todo",
        parent: null,
        assignee: null,
        labels: [],
        blockedBy: [],
        openBlockers: [],
        children: [],
        created: "2026-08-04T00:00:00Z",
        updated: "2026-08-04T00:00:00Z",
        description: "Describe.",
        plan: "",
        notes: [],
        file: null,
        ...overrides
    };
}

export function config(overrides: Partial<ConfigResponse> = {}): ConfigResponse {
    return {
        name: "Test Project",
        states: [
            { name: "Todo", category: "unstarted" },
            { name: "In Progress", category: "started" },
            { name: "Done", category: "completed" }
        ],
        defaultState: "Todo",
        root: "/tmp/test",
        events: { enabled: true },
        ...overrides
    };
}

export function status(overrides: Partial<StatusResponse> = {}): StatusResponse {
    return {
        name: "Test Project",
        total: 0,
        counted: 0,
        percentComplete: 0,
        completed: 0,
        started: 0,
        unstarted: 0,
        cancelled: 0,
        byState: [],
        inProgress: [],
        epics: [],
        ready: [],
        blocked: [],
        ...overrides
    };
}

/**
 * A `Backlog` whose `mutate` records what was asked of it instead of writing anything.
 *
 * `mutate` resolves true by default. Pass `refuse` to model a write the server rejected — which is how a
 * cycle or an unknown state arrives — so the tests can check what the UI does about it.
 */
export function backlog(
    overrides: Partial<Backlog> & { refuse?: string } = {}
): Backlog & { calls: (() => Promise<unknown>)[] } {
    const calls: (() => Promise<unknown>)[] = [];
    const { refuse, ...rest } = overrides;

    return {
        config: config(),
        issues: [],
        status: status(),
        error: refuse,
        loading: false,
        reload: () => Promise.resolve(),
        mutate: async (change) => {
            calls.push(change);
            if (refuse !== undefined) return false;
            // Run it, so a test can assert on what the client asked the API for.
            await change().catch(() => undefined);
            return true;
        },
        calls,
        ...rest
    };
}
