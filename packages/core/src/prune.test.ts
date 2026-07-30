import { describe, expect, it } from "vitest";
import { describeSkip, parseCutoff, planPrune, settledAt, stripEventsFor } from "./prune.js";
import { statusPath } from "./git.js";
import type { Config, State } from "./schema/config.js";
import type { Event } from "./schema/event.js";
import type { Issue } from "./schema/issue.js";

const STATES: State[] = [
    { name: "Todo", category: "unstarted" },
    { name: "In Progress", category: "started" },
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
    events: { enabled: true }
};

function issue(id: number, state: string, extra: Partial<Issue> = {}): Issue {
    return {
        id,
        title: `Issue ${id}`,
        state,
        created: "2026-01-01T00:00:00Z",
        updated: "2026-01-01T00:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        filePath: `/tmp/test/.motte/issues/${String(id).padStart(4, "0")}-x.md`,
        ...extra
    };
}

const stateEvent = (id: number, to: string, at: string): Event => ({
    at,
    id,
    by: "chris",
    as: "user",
    type: "state",
    from: "Todo",
    to
});

describe("parseCutoff", () => {
    const now = new Date("2026-07-30T12:00:00Z");

    it("reads a month", () => {
        expect(parseCutoff("2026-01", now)).toBe("2026-01-01T00:00:00Z");
    });

    it("reads a date", () => {
        expect(parseCutoff("2026-01-15", now)).toBe("2026-01-15T00:00:00Z");
    });

    it("reads a span in days and weeks", () => {
        expect(parseCutoff("90d", now)).toBe("2026-05-01T12:00:00Z");
        expect(parseCutoff("2w", now)).toBe("2026-07-16T12:00:00Z");
    });

    it("rejects a bare number, suggesting the unit", () => {
        expect(() => parseCutoff("90", now)).toThrow(/no unit/);
    });

    it("explains something it cannot read", () => {
        expect(() => parseCutoff("ages ago", now)).toThrow(/could not read/);
    });
});

describe("settledAt", () => {
    it("is undefined for work that is not settled", () => {
        expect(settledAt(config, [], issue(1, "In Progress"))).toBeUndefined();
    });

    /**
     * Not `updated`, which moves on any edit — otherwise a completed issue that later gets a note would
     * look freshly settled and never become eligible for pruning.
     */
    it("uses the transition that settled it, not the issue's updated stamp", () => {
        const events = [stateEvent(1, "Done", "2026-03-01T00:00:00Z")];
        const settled = issue(1, "Done", { updated: "2026-07-30T00:00:00Z" });

        expect(settledAt(config, events, settled)).toBe("2026-03-01T00:00:00Z");
    });

    it("falls back to updated for an issue that predates the log", () => {
        const settled = issue(1, "Done", { updated: "2026-02-02T00:00:00Z" });
        expect(settledAt(config, [], settled)).toBe("2026-02-02T00:00:00Z");
    });

    it("reports when work stopped, not when a settled label last changed", () => {
        // Done then Cancelled: the work stopped at the first, and that is the age that matters.
        const events = [
            stateEvent(1, "Done", "2026-03-01T00:00:00Z"),
            stateEvent(1, "Cancelled", "2026-06-01T00:00:00Z")
        ];

        expect(settledAt(config, events, issue(1, "Cancelled"))).toBe("2026-03-01T00:00:00Z");
    });

    it("uses the reopen for work that was finished, reopened, then finished again", () => {
        const events = [
            stateEvent(1, "Done", "2026-02-01T00:00:00Z"),
            stateEvent(1, "In Progress", "2026-03-01T00:00:00Z"),
            stateEvent(1, "Done", "2026-04-01T00:00:00Z")
        ];

        // The most recent settling, because the middle transition broke the run.
        expect(settledAt(config, events, issue(1, "Done"))).toBe("2026-04-01T00:00:00Z");
    });
});

describe("planPrune", () => {
    const cutoff = "2026-06-01T00:00:00Z";
    const old = "2026-01-01T00:00:00Z";
    const recent = "2026-07-01T00:00:00Z";

    it("prunes settled work older than the cutoff", () => {
        const issues = [issue(1, "Done")];
        const plan = planPrune(config, issues, [stateEvent(1, "Done", old)], cutoff);

        expect(plan.prunable.map((i) => i.id)).toEqual([1]);
    });

    it("keeps unsettled work whatever its age", () => {
        const issues = [
            issue(1, "Todo", { updated: old }),
            issue(2, "In Progress", { updated: old })
        ];
        const plan = planPrune(config, issues, [], cutoff);

        expect(plan.prunable).toEqual([]);
        expect(plan.skipped.map((s) => s.reason.kind)).toEqual(["not-settled", "not-settled"]);
    });

    it("keeps settled work newer than the cutoff", () => {
        const plan = planPrune(config, [issue(1, "Done")], [stateEvent(1, "Done", recent)], cutoff);

        expect(plan.prunable).toEqual([]);
        expect(plan.skipped[0]!.reason.kind).toBe("too-recent");
    });

    it("prunes cancelled work too", () => {
        const plan = planPrune(
            config,
            [issue(1, "Cancelled")],
            [stateEvent(1, "Cancelled", old)],
            cutoff
        );

        expect(plan.prunable.map((i) => i.id)).toEqual([1]);
    });

    /**
     * The rule that keeps `doctor` clean by construction: removing something a survivor points at
     * would leave a dangling reference, which doctor reports as an error.
     */
    it("keeps an issue a surviving issue still has as its parent", () => {
        const issues = [issue(1, "Done"), issue(2, "Todo", { parent: 1 })];
        const plan = planPrune(config, issues, [stateEvent(1, "Done", old)], cutoff);

        expect(plan.prunable).toEqual([]);
        const skip = plan.skipped.find((s) => s.issue.id === 1)!;
        expect(skip.reason).toEqual({ kind: "referenced", by: [2], as: "parent" });
    });

    it("keeps an issue a surviving issue still lists as a blocker", () => {
        const issues = [issue(1, "Done"), issue(2, "Todo", { blockedBy: [1] })];
        const plan = planPrune(config, issues, [stateEvent(1, "Done", old)], cutoff);

        expect(plan.prunable).toEqual([]);
        expect(plan.skipped.find((s) => s.issue.id === 1)!.reason).toMatchObject({ as: "blocker" });
    });

    it("reports both when it is referenced each way", () => {
        const issues = [
            issue(1, "Done"),
            issue(2, "Todo", { parent: 1 }),
            issue(3, "Todo", { blockedBy: [1] })
        ];
        const plan = planPrune(config, issues, [stateEvent(1, "Done", old)], cutoff);

        expect(plan.skipped.find((s) => s.issue.id === 1)!.reason).toMatchObject({
            as: "both",
            by: [2, 3]
        });
    });

    /**
     * Two prunable issues referencing each other must not keep each other alive, or a settled subtree
     * could never be removed.
     */
    it("prunes a whole settled subtree together", () => {
        const issues = [issue(1, "Done"), issue(2, "Done", { parent: 1 })];
        const events = [stateEvent(1, "Done", old), stateEvent(2, "Done", old)];

        const plan = planPrune(config, issues, events, cutoff);
        expect(plan.prunable.map((i) => i.id)).toEqual([1, 2]);
    });

    it("keeps a settled parent whose child is still open", () => {
        const issues = [
            issue(1, "Done"),
            issue(2, "Done", { parent: 1 }),
            issue(3, "Todo", { parent: 1 })
        ];
        const events = [stateEvent(1, "Done", old), stateEvent(2, "Done", old)];

        const plan = planPrune(config, issues, events, cutoff);

        // #2 goes; #1 stays because #3 survives and points at it.
        expect(plan.prunable.map((i) => i.id)).toEqual([2]);
    });

    it("skips an issue with no file on disk", () => {
        const orphan = { ...issue(1, "Done") };
        delete orphan.filePath;

        const plan = planPrune(config, [orphan], [stateEvent(1, "Done", old)], cutoff);
        expect(plan.skipped[0]!.reason.kind).toBe("no-file");
    });
});

describe("describeSkip", () => {
    it("explains each reason in a way that says what to do", () => {
        expect(describeSkip({ kind: "not-settled", state: "In Progress" })).toContain(
            "In Progress"
        );
        expect(describeSkip({ kind: "too-recent", settledAt: "2026-07-01T00:00:00Z" })).toContain(
            "2026-07-01"
        );
        expect(describeSkip({ kind: "referenced", by: [2, 3], as: "both" })).toContain("#2, #3");
        expect(describeSkip({ kind: "no-file" })).toContain("no file");
    });
});

describe("stripEventsFor", () => {
    const line = (id: number, type = "state") =>
        JSON.stringify({ at: "2026-01-01T00:00:00Z", id, by: "x", as: "user", type });

    it("removes the given ids and keeps the rest", () => {
        const kept = stripEventsFor([line(1), line(2), line(3)], new Set([2]));

        expect(kept).toHaveLength(2);
        expect(kept.join()).not.toContain('"id":2');
    });

    it("keeps tombstones, which are the only record a pruned issue leaves", () => {
        const tombstone = JSON.stringify({
            at: "2026-01-01T00:00:00Z",
            id: 2,
            by: "x",
            as: "user",
            type: "pruned"
        });

        expect(stripEventsFor([line(2), tombstone], new Set([2]))).toEqual([tombstone]);
    });

    it("keeps a restored event for a pruned id", () => {
        const restored = JSON.stringify({
            at: "2026-01-01T00:00:00Z",
            id: 2,
            by: "x",
            as: "user",
            type: "restored"
        });

        expect(stripEventsFor([restored], new Set([2]))).toEqual([restored]);
    });

    it("leaves an unreadable line alone rather than silently dropping it", () => {
        // A maintenance command should not quietly discard something it cannot understand.
        expect(stripEventsFor(["not json", line(1)], new Set([1]))).toEqual(["not json"]);
    });

    it("drops blank lines", () => {
        expect(stripEventsFor(["", "  ", line(1)], new Set([9]))).toEqual([line(1)]);
    });
});

/**
 * Regression: slicing a fixed three characters ate the leading dot off `.motte/...` when the status
 * column ran differently, so the "commit these first" message named a file that did not exist.
 */
describe("statusPath", () => {
    it("reads the path whatever the status columns look like", () => {
        expect(statusPath(" M .motte/issues/x.md")).toBe(".motte/issues/x.md");
        expect(statusPath("M  .motte/issues/x.md")).toBe(".motte/issues/x.md");
        expect(statusPath("?? .motte/events/y.ndjson")).toBe(".motte/events/y.ndjson");
        expect(statusPath(" D .motte/issues/z.md")).toBe(".motte/issues/z.md");
        expect(statusPath("M .motte/issues/odd.md")).toBe(".motte/issues/odd.md");
    });

    it("keeps the leading dot, which is the whole point", () => {
        expect(statusPath(" M .motte/x")).toMatch(/^\.motte/);
    });
});
