import { describe, expect, it } from "vitest";
import { rankReady } from "./next.js";
import { DEFAULT_STATES } from "./schema/config.js";
import type { Config } from "./schema/config.js";
import type { Issue } from "./schema/issue.js";

/**
 * Ordering the ready set.
 *
 * Hand-built graphs, because the cases that matter are shapes rather than data: a chain where one issue
 * gates everything behind it, a wide fan-out, and the ties that decide what happens when the graph says
 * nothing useful.
 */

const config: Config = {
    name: "Test",
    issuesDir: ".motte/issues",
    states: [...DEFAULT_STATES, { name: "Cancelled", category: "cancelled" }],
    defaultState: "Todo",
    root: "/nowhere",
    configPath: "/nowhere/.motte.config.json",
    issuesPath: "/nowhere/.motte/issues",
    events: { enabled: true }
};

function issue(id: number, overrides: Partial<Issue> = {}): Issue {
    return {
        id,
        title: `Issue ${id}`,
        state: "Todo",
        created: `2026-08-0${Math.min(9, id)}T09:00:00Z`,
        updated: "2026-08-01T09:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        ...overrides
    };
}

const ids = (issues: Issue[], options = {}) =>
    rankReady(config, issues, options).map((entry) => entry.issue.id);

describe("what gets considered at all", () => {
    it("offers nothing when everything is blocked", () => {
        const issues = [issue(1, { blockedBy: [2] }), issue(2, { blockedBy: [1] })];

        // A cycle blocks both ends of itself; `doctor` is what reports it.
        expect(ids(issues)).toEqual([]);
    });

    it("leaves out settled work", () => {
        expect(ids([issue(1, { state: "Done" }), issue(2)])).toEqual([2]);
    });

    it("leaves out anything blocked by unsettled work", () => {
        expect(ids([issue(1), issue(2, { blockedBy: [1] })])).toEqual([1]);
    });

    /**
     * The multi-agent case this exists for: an issue with another name on it is spoken for, and handing it
     * to a second agent is how two of them write the same code.
     */
    it("leaves out work assigned to somebody else", () => {
        const issues = [issue(1, { assignee: "atlas" }), issue(2)];

        expect(ids(issues, { assignee: "chris" })).toEqual([2]);
    });

    it("keeps unassigned work, which is fair game for anyone", () => {
        expect(ids([issue(1)], { assignee: "chris" })).toEqual([1]);
    });

    /**
     * Without a caller, every assigned issue is somebody else's. The alternative — treating assignment as
     * meaningless when the asker is anonymous — would hand an agent work with another name on it, which is
     * the one outcome this ordering exists to avoid.
     */
    it("treats all assigned work as somebody else's when nobody says who is asking", () => {
        expect(ids([issue(1, { assignee: "atlas" }), issue(2)])).toEqual([2]);
    });

    /**
     * You do not "do" an epic, you do its children — but only when a child can actually be started. The
     * first attempt at this excluded every parent with open children, which took out a parent that held the
     * work while its only child was a follow-on blocked by it.
     */
    describe("parents", () => {
        it("leaves out a parent whose child could be started right now", () => {
            const issues = [issue(1), issue(2, { parent: 1 }), issue(3, { parent: 1 })];

            expect(ids(issues)).toEqual([2, 3]);
        });

        it("keeps a parent whose only child is blocked by it, since the work is the parent's", () => {
            const issues = [issue(1), issue(2, { parent: 1, blockedBy: [1] })];

            expect(ids(issues)).toEqual([1]);
        });

        it("keeps a parent whose children are all settled", () => {
            const issues = [issue(1), issue(2, { parent: 1, state: "Done" })];

            expect(ids(issues)).toEqual([1]);
        });

        it("keeps a childless issue, obviously", () => {
            expect(ids([issue(1)])).toEqual([1]);
        });
    });

    it("narrows to the caller's own work on request", () => {
        const issues = [issue(1), issue(2, { assignee: "chris" })];

        expect(ids(issues, { assignee: "chris", mineOnly: true })).toEqual([2]);
    });
});

describe("what comes first", () => {
    /** The strongest signal: finishing this is what lets other work begin. */
    it("prefers the issue that unblocks the most", () => {
        const issues = [
            issue(1),
            issue(2),
            issue(3, { blockedBy: [2] }),
            issue(4, { blockedBy: [2] })
        ];

        expect(ids(issues)).toEqual([2, 1]);
    });

    it("counts what a chain would release, not just its next link", () => {
        const chain = [
            issue(1),
            issue(2, { blockedBy: [1] }),
            issue(3, { blockedBy: [2] }),
            issue(4, { blockedBy: [3] }),
            // A rival with one direct dependent, so a naive count would tie or win.
            issue(5),
            issue(6, { blockedBy: [5] })
        ];

        const ranked = rankReady(config, chain);

        expect(ranked[0]!.issue.id).toBe(1);
        expect(ranked[0]!.signals.unblocks).toBe(3);
    });

    it("does not count dependents that are already settled", () => {
        const issues = [issue(1), issue(2, { blockedBy: [1], state: "Done" }), issue(3)];

        // Finishing #1 releases nothing, so it does not outrank #3 on that basis.
        expect(rankReady(config, issues)[0]!.signals.unblocks).toBe(0);
    });

    /** Leaves are what actually close an epic, so depth breaks a tie the graph cannot. */
    it("prefers the deeper of two leaves when neither unblocks anything", () => {
        const issues = [
            // A standalone issue at the root, and a leaf one level down under its own parent.
            issue(1),
            issue(2, { parent: 3 }),
            issue(3, { state: "Done" })
        ];

        expect(ids(issues)).toEqual([2, 1]);
    });

    it("falls back to age, oldest first", () => {
        const issues = [
            issue(1, { created: "2026-08-05T09:00:00Z" }),
            issue(2, { created: "2026-08-01T09:00:00Z" })
        ];

        expect(ids(issues)).toEqual([2, 1]);
    });

    it("is stable when everything else ties", () => {
        const at = "2026-08-01T09:00:00Z";
        const issues = [
            issue(3, { created: at }),
            issue(1, { created: at }),
            issue(2, { created: at })
        ];

        expect(ids(issues)).toEqual([1, 2, 3]);
        // Same set, different reading order, same answer.
        expect(ids([...issues].reverse())).toEqual([1, 2, 3]);
    });

    /**
     * An agent that started something and then asked what to do next should be reminded of it, not handed a
     * second thing to start.
     */
    it("puts the caller's own started work first, whatever the graph says", () => {
        const issues = [
            issue(1, { assignee: "chris", state: "In Progress" }),
            issue(2),
            issue(3, { blockedBy: [2] }),
            issue(4, { blockedBy: [2] })
        ];

        expect(ids(issues, { assignee: "chris" })).toEqual([1, 2]);
    });

    it("does not do that for somebody else's started work", () => {
        const issues = [issue(1, { assignee: "atlas", state: "In Progress" }), issue(2)];

        expect(ids(issues, { assignee: "chris" })).toEqual([2]);
    });

    it("matches a name without caring about case", () => {
        const issues = [issue(1, { assignee: "Atlas", state: "In Progress" }), issue(2)];

        expect(ids(issues, { assignee: "atlas" })[0]).toBe(1);
    });
});

describe("saying why", () => {
    it("explains the graph in words rather than a score", () => {
        const issues = [issue(1), issue(2, { blockedBy: [1] }), issue(3, { blockedBy: [1] })];

        expect(rankReady(config, issues)[0]!.reasons).toContain("unblocks 2 issues");
    });

    it("gets the singular right, because a tool that says 1 issues looks unfinished", () => {
        const issues = [issue(1), issue(2, { blockedBy: [1] })];

        expect(rankReady(config, issues)[0]!.reasons).toContain("unblocks 1 issue");
    });

    it("mentions the tree only when the issue is in one", () => {
        const [root] = rankReady(config, [issue(1)]);

        expect(root!.reasons.some((reason) => reason.includes("deep"))).toBe(false);
    });

    it("says when the work is already the caller's", () => {
        const issues = [issue(1, { assignee: "chris", state: "In Progress" })];

        expect(rankReady(config, issues, { assignee: "chris" })[0]!.reasons).toContain(
            "already yours, and started"
        );
    });

    it("distinguishes assigned from started", () => {
        const issues = [issue(1, { assignee: "chris" })];

        expect(rankReady(config, issues, { assignee: "chris" })[0]!.reasons).toContain(
            "assigned to you"
        );
    });
});

describe("states the project configured itself", () => {
    /** "Started" is a category, not a name: a second unstarted state must not read as work in hand. */
    it("does not treat another unstarted state as started", () => {
        const custom: Config = {
            ...config,
            states: [
                { name: "Icebox", category: "unstarted" },
                { name: "Todo", category: "unstarted" },
                { name: "Doing", category: "started" },
                { name: "Shipped", category: "completed" }
            ],
            defaultState: "Todo"
        };

        const issues = [
            issue(1, { state: "Icebox", assignee: "chris" }),
            issue(2, { state: "Doing", assignee: "chris" })
        ];

        expect(rankReady(custom, issues, { assignee: "chris" })[0]!.issue.id).toBe(2);
    });
});
