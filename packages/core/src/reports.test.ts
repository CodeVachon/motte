import { describe, expect, it } from "vitest";
import { epicReports, progressBar, projectReport, subtreeReport, summarize } from "./reports.js";
import { DEFAULT_STATES, type Config, type State } from "./schema/config.js";
import type { Issue } from "./schema/issue.js";

const STATES: State[] = [
    { name: "Todo", category: "unstarted" },
    { name: "In Progress", category: "started" },
    { name: "Blocked", category: "started" },
    { name: "Done", category: "completed" },
    { name: "Cancelled", category: "cancelled" }
];

function config(states: State[] = STATES): Config {
    return {
        name: "test",
        issuesDir: ".motte/issues",
        states,
        defaultState: states[0]!.name,
        root: "/tmp/test",
        configPath: "/tmp/test/.motte.config.json",
        issuesPath: "/tmp/test/.motte/issues",
        events: { enabled: false }
    };
}

let nextId = 1;
function issue(state: string, parent?: number): Issue {
    return {
        id: nextId++,
        title: `Issue ${nextId}`,
        state,
        ...(parent === undefined ? {} : { parent }),
        created: "2026-07-29T12:00:00Z",
        updated: "2026-07-29T12:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: []
    };
}

describe("summarize", () => {
    it("counts every category", () => {
        nextId = 1;
        const progress = summarize(config(), [
            issue("Todo"),
            issue("Todo"),
            issue("In Progress"),
            issue("Blocked"),
            issue("Done"),
            issue("Cancelled")
        ]);

        expect(progress.total).toBe(6);
        expect(progress.unstarted).toBe(2);
        // Both "In Progress" and "Blocked" are the started category.
        expect(progress.started).toBe(2);
        expect(progress.completed).toBe(1);
        expect(progress.cancelled).toBe(1);
    });

    it("excludes cancelled work from the denominator", () => {
        nextId = 1;
        // 1 of 2 real issues done — cancelled work must not cap this below 50%.
        const progress = summarize(config(), [issue("Done"), issue("Todo"), issue("Cancelled")]);

        expect(progress.counted).toBe(2);
        expect(progress.percentComplete).toBe(50);
    });

    it("reports 100% when everything is done", () => {
        nextId = 1;
        expect(summarize(config(), [issue("Done"), issue("Done")]).percentComplete).toBe(100);
    });

    it("reports 100% when everything is cancelled, rather than dividing by zero", () => {
        nextId = 1;
        const progress = summarize(config(), [issue("Cancelled")]);

        expect(progress.counted).toBe(0);
        expect(progress.percentComplete).toBe(100);
    });

    it("reports 100% for an empty project", () => {
        expect(summarize(config(), []).percentComplete).toBe(100);
    });

    it("counts a state missing from the config as unstarted rather than dropping it", () => {
        nextId = 1;
        const progress = summarize(config(), [issue("Todo"), issue("Bogus")]);

        expect(progress.total).toBe(2);
        expect(progress.unstarted).toBe(2);
    });

    it("works with a renamed state list", () => {
        nextId = 1;
        const renamed = config([
            { name: "Backlog", category: "unstarted" },
            { name: "Shipped", category: "completed" }
        ]);

        expect(summarize(renamed, [issue("Shipped"), issue("Backlog")]).percentComplete).toBe(50);
    });
});

describe("projectReport", () => {
    it("lists states in configured order and surfaces started work", () => {
        nextId = 1;
        const report = projectReport(config(), [
            issue("Done"),
            issue("In Progress"),
            issue("Todo")
        ]);

        expect(report.byState.map((entry) => entry.state)).toEqual([
            "Todo",
            "In Progress",
            "Blocked",
            "Done",
            "Cancelled"
        ]);
        expect(report.inProgress).toHaveLength(1);
        expect(report.inProgress[0]!.state).toBe("In Progress");
    });

    it("appends states found on disk but absent from the config", () => {
        nextId = 1;
        const report = projectReport(config(), [issue("Mystery"), issue("Mystery")]);
        const mystery = report.byState.find((entry) => entry.state === "Mystery");

        expect(mystery).toBeDefined();
        expect(mystery!.count).toBe(2);
    });
});

describe("subtreeReport", () => {
    it("counts the issue itself alongside its descendants", () => {
        nextId = 1;
        const epic = issue("In Progress");
        const child = issue("Done", epic.id);
        const grandchild = issue("Done", child.id);
        const unrelated = issue("Todo");

        const report = subtreeReport(config(), [epic, child, grandchild, unrelated], epic.id);

        // epic + 2 descendants, and the unrelated issue is excluded.
        expect(report.total).toBe(3);
        expect(report.completed).toBe(2);
        expect(report.percentComplete).toBe(67);
    });

    it("throws for an unknown id", () => {
        expect(() => subtreeReport(config(), [], 1)).toThrow();
    });
});

describe("epicReports", () => {
    it("reports every issue that has children, in id order", () => {
        nextId = 1;
        const first = issue("Todo");
        const second = issue("Todo");
        const childOfSecond = issue("Done", second.id);
        const childOfFirst = issue("Done", first.id);

        const reports = epicReports(config(), [first, second, childOfSecond, childOfFirst]);

        expect(reports.map((report) => report.issue.id)).toEqual([first.id, second.id]);
    });

    it("ignores parents that do not exist", () => {
        nextId = 1;
        expect(epicReports(config(), [issue("Todo", 999)])).toEqual([]);
    });
});

describe("progressBar", () => {
    it("fills proportionally", () => {
        expect(progressBar(0, 4)).toBe("░░░░");
        expect(progressBar(50, 4)).toBe("██░░");
        expect(progressBar(100, 4)).toBe("████");
    });

    it("clamps out-of-range input", () => {
        expect(progressBar(-10, 4)).toBe("░░░░");
        expect(progressBar(150, 4)).toBe("████");
    });

    it("uses the default state list without complaint", () => {
        nextId = 1;
        expect(summarize(config(DEFAULT_STATES), [issue("Done")]).percentComplete).toBe(100);
    });
});
