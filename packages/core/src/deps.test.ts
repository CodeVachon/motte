import { describe, expect, it } from "vitest";
import {
    blocked,
    blocks,
    cycleIfBlocked,
    dependencyProblems,
    findDependencyCycle,
    isBlocked,
    isReady,
    isSettled,
    openBlockers,
    ready
} from "./deps.js";
import type { Config, State } from "./schema/config.js";
import type { Issue } from "./schema/issue.js";

const STATES: State[] = [
    { name: "Todo", category: "unstarted" },
    { name: "In Progress", category: "started" },
    { name: "Blocked", category: "started" },
    { name: "Done", category: "completed" },
    { name: "Cancelled", category: "cancelled" }
];

const config: Config = {
    name: "test",
    issuesDir: ".motte/issues",
    states: STATES,
    defaultState: "Todo",
    root: "/tmp/test",
    configPath: "/tmp/test/.motte.config.json",
    issuesPath: "/tmp/test/.motte/issues",
    events: { enabled: false }
};

function issue(id: number, state: string, blockedBy?: number[]): Issue {
    return {
        id,
        title: `Issue ${id}`,
        state,
        ...(blockedBy === undefined ? {} : { blockedBy }),
        created: "2026-07-29T12:00:00Z",
        updated: "2026-07-29T12:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        filePath: `/tmp/test/.motte/issues/${String(id).padStart(4, "0")}-issue.md`
    };
}

describe("isSettled", () => {
    it("treats completed and cancelled as settled", () => {
        expect(isSettled(config, issue(1, "Done"))).toBe(true);
        expect(isSettled(config, issue(1, "Cancelled"))).toBe(true);
    });

    it("treats unstarted and started as unsettled", () => {
        expect(isSettled(config, issue(1, "Todo"))).toBe(false);
        expect(isSettled(config, issue(1, "In Progress"))).toBe(false);
    });
});

describe("openBlockers", () => {
    it("returns nothing when there are no blockers", () => {
        expect(openBlockers(config, [issue(1, "Todo")], issue(1, "Todo"))).toEqual([]);
    });

    it("returns a blocker that is not done", () => {
        const issues = [issue(1, "Todo"), issue(2, "Todo", [1])];
        expect(openBlockers(config, issues, issues[1]!).map((x) => x.id)).toEqual([1]);
    });

    it("ignores a completed blocker", () => {
        const issues = [issue(1, "Done"), issue(2, "Todo", [1])];
        expect(openBlockers(config, issues, issues[1]!)).toEqual([]);
    });

    it("treats a cancelled blocker as settled, so it does not deadlock what it blocked", () => {
        // Abandoned work will never complete. Counting it as blocking would strand everything
        // downstream of it forever.
        const issues = [issue(1, "Cancelled"), issue(2, "Todo", [1])];
        expect(openBlockers(config, issues, issues[1]!)).toEqual([]);
        expect(isReady(config, issues, issues[1]!)).toBe(true);
    });

    it("ignores a blocker that does not exist, leaving it to doctor", () => {
        const issues = [issue(2, "Todo", [99])];
        expect(openBlockers(config, issues, issues[0]!)).toEqual([]);
    });

    it("returns multiple open blockers in id order", () => {
        const issues = [
            issue(1, "Todo"),
            issue(2, "Done"),
            issue(3, "Todo"),
            issue(4, "Todo", [3, 1, 2])
        ];
        expect(openBlockers(config, issues, issues[3]!).map((x) => x.id)).toEqual([1, 3]);
    });
});

describe("isReady", () => {
    it("is true for unblocked, unsettled work", () => {
        const issues = [issue(1, "Todo")];
        expect(isReady(config, issues, issues[0]!)).toBe(true);
    });

    it("is false while a blocker is open", () => {
        const issues = [issue(1, "Todo"), issue(2, "Todo", [1])];
        expect(isReady(config, issues, issues[1]!)).toBe(false);
    });

    it("becomes true once the blocker completes", () => {
        const issues = [issue(1, "Done"), issue(2, "Todo", [1])];
        expect(isReady(config, issues, issues[1]!)).toBe(true);
    });

    it("is false for work that is already settled", () => {
        const issues = [issue(1, "Done"), issue(2, "Cancelled")];
        expect(isReady(config, issues, issues[0]!)).toBe(false);
        expect(isReady(config, issues, issues[1]!)).toBe(false);
    });

    it("is true for started work — in progress still counts as pickupable", () => {
        const issues = [issue(1, "In Progress")];
        expect(isReady(config, issues, issues[0]!)).toBe(true);
    });
});

describe("ready and blocked partition the unsettled work", () => {
    const issues = [
        issue(1, "Done"),
        issue(2, "Todo"),
        issue(3, "Todo", [2]),
        issue(4, "Todo", [1]),
        issue(5, "Cancelled")
    ];

    it("splits correctly", () => {
        expect(ready(config, issues).map((x) => x.id)).toEqual([2, 4]);
        expect(blocked(config, issues).map((x) => x.id)).toEqual([3]);
    });

    it("covers every unsettled issue exactly once", () => {
        const unsettled = issues.filter((x) => !isSettled(config, x)).map((x) => x.id);
        const partitioned = [...ready(config, issues), ...blocked(config, issues)]
            .map((x) => x.id)
            .sort((a, b) => a - b);

        expect(partitioned).toEqual(unsettled.sort((a, b) => a - b));
    });
});

describe("blocks — the derived inverse", () => {
    it("finds the issues naming a blocker, in id order", () => {
        const issues = [issue(1, "Todo"), issue(5, "Todo", [1]), issue(3, "Todo", [1])];
        expect(blocks(issues, 1).map((x) => x.id)).toEqual([3, 5]);
    });

    it("returns nothing for an issue nothing waits on", () => {
        expect(blocks([issue(1, "Todo"), issue(2, "Todo")], 2)).toEqual([]);
    });
});

describe("findDependencyCycle", () => {
    it("returns undefined for an acyclic chain", () => {
        const issues = [issue(1, "Todo"), issue(2, "Todo", [1]), issue(3, "Todo", [2])];
        expect(findDependencyCycle(issues, 3)).toBeUndefined();
    });

    it("finds a two-issue cycle", () => {
        const issues = [issue(1, "Todo", [2]), issue(2, "Todo", [1])];
        expect(findDependencyCycle(issues, 1)).toBeDefined();
    });

    it("finds a longer cycle", () => {
        const issues = [issue(1, "Todo", [3]), issue(2, "Todo", [1]), issue(3, "Todo", [2])];
        const cycle = findDependencyCycle(issues, 1);

        expect(cycle).toBeDefined();
        // Closes back on where it started.
        expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    });

    it("finds a self-block", () => {
        expect(findDependencyCycle([issue(1, "Todo", [1])], 1)).toBeDefined();
    });

    it("handles a diamond without reporting a false cycle", () => {
        // 4 waits on 2 and 3; both wait on 1. Shared ancestry is not a cycle.
        const issues = [
            issue(1, "Todo"),
            issue(2, "Todo", [1]),
            issue(3, "Todo", [1]),
            issue(4, "Todo", [2, 3])
        ];
        expect(findDependencyCycle(issues, 4)).toBeUndefined();
    });

    it("terminates on a missing blocker", () => {
        expect(findDependencyCycle([issue(1, "Todo", [99])], 1)).toBeUndefined();
    });
});

describe("cycleIfBlocked", () => {
    it("rejects blocking an issue on itself", () => {
        expect(cycleIfBlocked([issue(1, "Todo")], 1, 1)).toEqual([1, 1]);
    });

    it("rejects a block that closes a loop", () => {
        const issues = [issue(1, "Todo"), issue(2, "Todo", [1])];
        // 1 waiting on 2 would close 1 → 2 → 1.
        expect(cycleIfBlocked(issues, 1, 2)).toBeDefined();
    });

    it("rejects a block that closes a longer loop", () => {
        const issues = [issue(1, "Todo"), issue(2, "Todo", [1]), issue(3, "Todo", [2])];
        expect(cycleIfBlocked(issues, 1, 3)).toBeDefined();
    });

    it("allows an unrelated block", () => {
        const issues = [issue(1, "Todo"), issue(2, "Todo"), issue(3, "Todo")];
        expect(cycleIfBlocked(issues, 3, 1)).toBeUndefined();
    });

    it("allows a second independent blocker", () => {
        const issues = [issue(1, "Todo"), issue(2, "Todo"), issue(3, "Todo", [1])];
        expect(cycleIfBlocked(issues, 3, 2)).toBeUndefined();
    });
});

describe("dependencyProblems", () => {
    it("reports nothing for a clean backlog", () => {
        const issues = [issue(1, "Done"), issue(2, "Todo", [1])];
        expect(dependencyProblems(config, issues)).toEqual([]);
    });

    it("reports a blocker that does not exist", () => {
        const problems = dependencyProblems(config, [issue(1, "Todo", [99])]);
        expect(problems.map((p) => p.kind)).toContain("missing-blocker");
        expect(problems[0]!.message).toContain("#99");
    });

    it("reports a self-block", () => {
        const problems = dependencyProblems(config, [issue(1, "Todo", [1])]);
        expect(problems.map((p) => p.kind)).toContain("self-blocked");
    });

    it("reports a cycle once, not once per member", () => {
        const issues = [issue(1, "Todo", [3]), issue(2, "Todo", [1]), issue(3, "Todo", [2])];
        const cycles = dependencyProblems(config, issues).filter(
            (p) => p.kind === "dependency-cycle"
        );

        expect(cycles).toHaveLength(1);
    });

    it("warns when started work is still blocked", () => {
        const issues = [issue(1, "Todo"), issue(2, "In Progress", [1])];
        const problems = dependencyProblems(config, issues);

        expect(problems.map((p) => p.kind)).toContain("started-while-blocked");
    });

    it("does not warn when started work has only settled blockers", () => {
        const issues = [issue(1, "Done"), issue(2, "In Progress", [1])];
        expect(dependencyProblems(config, issues)).toEqual([]);
    });
});
