import { describe, expect, it } from "vitest";
import { MergeError, mergedBody, mergedInto, planMerge } from "./merge.js";
import type { Event } from "./schema/event.js";
import type { Issue } from "./schema/issue.js";

/**
 * Planning a merge.
 *
 * The refusals matter more than the moves: everything this plan describes can be undone by hand from the
 * survivor's own file, but a merge that collapsed a parent into its child would have lost the shape of
 * somebody's backlog with nothing left saying what it used to be.
 */

function issue(id: number, overrides: Omit<Partial<Issue>, "unknownSections"> = {}): Issue {
    return {
        id,
        title: `Issue ${id}`,
        state: "Todo",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        created: "2026-07-01T00:00:00Z",
        updated: "2026-07-01T00:00:00Z",
        ...overrides
    };
}

function note(at: string, body: string): Issue["notes"][number] {
    return { at, author: { name: "claude", type: "agent" }, body };
}

describe("planMerge refusals", () => {
    it("refuses an issue that does not exist, on either side", () => {
        const issues = [issue(1)];

        expect(() => planMerge(issues, 9, 1)).toThrow(MergeError);
        expect(() => planMerge(issues, 1, 9)).toThrow(/no issue #9/);
    });

    it("refuses merging an issue into itself", () => {
        expect(() => planMerge([issue(1)], 1, 1)).toThrow(/into itself/);
    });

    it("refuses merging a parent into its own child", () => {
        const issues = [issue(1), issue(2, { parent: 1 })];

        expect(() => planMerge(issues, 1, 2)).toThrow(/beneath #1/);
    });

    it("refuses merging a child into its own parent", () => {
        const issues = [issue(1), issue(2, { parent: 1 })];

        expect(() => planMerge(issues, 2, 1)).toThrow(/already part of it/);
    });

    /** One level is the obvious case; the refusal has to hold all the way up. */
    it("refuses a grandparent and a grandchild, in either direction", () => {
        const issues = [issue(1), issue(2, { parent: 1 }), issue(3, { parent: 2 })];

        expect(() => planMerge(issues, 1, 3)).toThrow(MergeError);
        expect(() => planMerge(issues, 3, 1)).toThrow(MergeError);
    });

    it("allows two siblings under one epic, which is the common duplicate", () => {
        const issues = [issue(1), issue(2, { parent: 1 }), issue(3, { parent: 1 })];

        expect(planMerge(issues, 3, 2).into.id).toBe(2);
    });

    /**
     * Found by working through what happens to the issues that pointed at the duplicate. `update` catches
     * this too, but only halfway through the merge — with the survivor written and the duplicate still on
     * disk. Refusing here is what keeps a merge all-or-nothing.
     */
    it("refuses when rewriting a dependent would close a dependency loop", () => {
        // #3 waits on the duplicate; the survivor waits on #3. Acyclic now, a loop after the merge.
        const issues = [issue(1), issue(2, { blockedBy: [3] }), issue(3, { blockedBy: [1] })];

        expect(() => planMerge(issues, 1, 2)).toThrow(/waiting on each other/);
    });

    /** A backlog that already has a loop is `doctor`'s problem; it must not block an unrelated merge. */
    it("does not refuse over a cycle that was already there", () => {
        const issues = [
            issue(1),
            issue(2),
            issue(3, { blockedBy: [4] }),
            issue(4, { blockedBy: [3] })
        ];

        expect(planMerge(issues, 1, 2).into.id).toBe(2);
    });
});

describe("planMerge moves", () => {
    it("lists the children and the issues waiting on the source", () => {
        const issues = [
            issue(1, { notes: [note("2026-07-02T00:00:00Z", "a")] }),
            issue(2),
            issue(3, { parent: 1 }),
            issue(4, { blockedBy: [1] })
        ];

        const plan = planMerge(issues, 1, 2);

        expect(plan.children.map((child) => child.id)).toEqual([3]);
        expect(plan.dependents.map((dependent) => dependent.id)).toEqual([4]);
        expect(plan.notes).toBe(1);
    });

    it("merges blockers and labels without duplicating what the survivor already has", () => {
        const issues = [
            issue(1, { blockedBy: [5, 6], labels: ["core", "cli"] }),
            issue(2, { blockedBy: [6], labels: ["cli"] }),
            issue(5),
            issue(6)
        ];

        const plan = planMerge(issues, 1, 2);

        expect(plan.blockers).toEqual([5]);
        expect(plan.blockedByAfter).toEqual([6, 5]);
        expect(plan.labels).toEqual(["core"]);
    });

    /**
     * The case that would otherwise produce a self-block. Two duplicates often name each other — somebody
     * marks the second as waiting on the first — and rewriting that relation onto the survivor would leave
     * it blocked by itself, which no report can interpret.
     */
    it("drops a blocker relation between the two, in either direction", () => {
        const forward = planMerge([issue(1, { blockedBy: [2] }), issue(2)], 1, 2);
        expect(forward.blockedByAfter).toEqual([]);

        const backward = planMerge([issue(1), issue(2, { blockedBy: [1] })], 1, 2);
        expect(backward.blockedByAfter).toEqual([]);
        // Not listed as a dependent either: it is the survivor, and it cannot wait on itself.
        expect(backward.dependents).toEqual([]);
    });

    it("gives the survivor the source's parent only when it has none of its own", () => {
        const orphan = planMerge([issue(1, { parent: 7 }), issue(2), issue(7)], 1, 2);
        expect(orphan.parent).toBe(7);

        const placed = planMerge(
            [issue(1, { parent: 7 }), issue(2, { parent: 8 }), issue(7), issue(8)],
            1,
            2
        );
        expect(placed.parent).toBeUndefined();
    });

    it("says whether the source had anything of its own to keep", () => {
        expect(planMerge([issue(1), issue(2)], 1, 2).keepsBody).toBe(false);
        expect(planMerge([issue(1, { description: "why" }), issue(2)], 1, 2).keepsBody).toBe(true);
        expect(planMerge([issue(1, { plan: "1. do it" }), issue(2)], 1, 2).keepsBody).toBe(true);
    });
});

describe("mergedBody", () => {
    it("keeps the source's description and plan verbatim", () => {
        const body = mergedBody(
            issue(90, { title: "Duplicate", description: "The why.", plan: "1. First" })
        );

        expect(body).toContain("Merged from #0090");
        expect(body).toContain("Duplicate");
        expect(body).toContain("The why.");
        expect(body).toContain("1. First");
    });

    it("says nothing about a description or plan that was empty", () => {
        const body = mergedBody(issue(90));

        expect(body).toBe("Merged from #0090 — “Issue 90”.");
    });

    /** Because the moved notes sort in by date rather than arriving in a block after this one. */
    it("accounts for the notes that came with it", () => {
        expect(mergedBody(issue(90, { notes: [note("2026-07-02T00:00:00Z", "a")] }))).toContain(
            "Its 1 note moved here too"
        );
    });
});

describe("mergedInto", () => {
    const merged = (id: number, into: number, at: string): Event => ({
        at,
        by: "claude",
        as: "agent",
        id,
        type: "merged",
        into,
        title: `Issue ${id}`
    });

    it("finds where an id went", () => {
        expect(mergedInto([merged(90, 42, "2026-08-01T00:00:00Z")], 90)?.into).toBe(42);
    });

    it("returns nothing for an id that was never merged", () => {
        expect(mergedInto([merged(90, 42, "2026-08-01T00:00:00Z")], 41)).toBeUndefined();
    });

    /** A restore can put a number back into use, so only the most recent tombstone is current. */
    it("takes the last tombstone when an id was merged more than once", () => {
        const events = [
            merged(90, 42, "2026-08-01T00:00:00Z"),
            merged(90, 7, "2026-08-02T00:00:00Z")
        ];

        expect(mergedInto(events, 90)?.into).toBe(7);
    });
});
