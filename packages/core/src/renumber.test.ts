import { describe, expect, it } from "vitest";
import { duplicateIds, planRenumber } from "./renumber.js";
import type { Issue } from "./schema/issue.js";

/**
 * Planning a renumber.
 *
 * The rules that matter are which file keeps the number and what the losers get. Both have to be stable:
 * two people repairing the same merge on different machines must arrive at the same backlog, or the next
 * merge collides again.
 */

function issue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 1,
        title: "An issue",
        state: "Todo",
        created: "2026-07-01T00:00:00Z",
        updated: "2026-07-01T00:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        filePath: "/nowhere/0001-an-issue.md",
        ...overrides
    };
}

const first = issue({
    id: 7,
    title: "Filed first",
    created: "2026-08-01T09:00:00Z",
    filePath: "/p/0007-filed-first.md"
});
const second = issue({
    id: 7,
    title: "Filed second",
    created: "2026-08-02T09:00:00Z",
    filePath: "/p/0007-filed-second.md"
});

describe("duplicateIds", () => {
    it("finds nothing when every id is unique", () => {
        expect(duplicateIds([issue({ id: 1 }), issue({ id: 2 })])).toEqual([]);
    });

    it("orders a group so the issue that had the number first comes first", () => {
        const group = duplicateIds([second, first])[0]!;

        expect(group.id).toBe(7);
        expect(group.issues.map((entry) => entry.title)).toEqual(["Filed first", "Filed second"]);
    });

    /** Same second, two machines: the filename is what makes the outcome the same on both. */
    it("breaks a tie on the filename rather than on directory order", () => {
        const at = "2026-08-01T09:00:00Z";
        const b = issue({ id: 7, title: "B", created: at, filePath: "/p/0007-b.md" });
        const a = issue({ id: 7, title: "A", created: at, filePath: "/p/0007-a.md" });

        expect(duplicateIds([b, a])[0]!.issues.map((entry) => entry.title)).toEqual(["A", "B"]);
        expect(duplicateIds([a, b])[0]!.issues.map((entry) => entry.title)).toEqual(["A", "B"]);
    });

    it("reports several collisions at once, in id order", () => {
        const groups = duplicateIds([
            issue({ id: 9, filePath: "/p/a.md" }),
            issue({ id: 9, filePath: "/p/b.md" }),
            first,
            second
        ]);

        expect(groups.map((group) => group.id)).toEqual([7, 9]);
    });
});

describe("planRenumber", () => {
    it("plans nothing when there is nothing wrong", () => {
        expect(planRenumber([issue({ id: 1 }), issue({ id: 2 })])).toEqual({
            reassignments: [],
            ambiguous: []
        });
    });

    it("moves the later file and leaves the earlier one alone", () => {
        const plan = planRenumber([first, second]);

        expect(plan.reassignments).toHaveLength(1);
        expect(plan.reassignments[0]!.issue.title).toBe("Filed second");
        expect(plan.reassignments[0]!.from).toBe(7);
    });

    /** Above everything in use, so a renumber never re-uses a number from a branch name or a commit. */
    it("hands out ids above the highest in use, never filling a gap", () => {
        const plan = planRenumber([first, second, issue({ id: 40, filePath: "/p/0040.md" })]);

        expect(plan.reassignments[0]!.to).toBe(41);
    });

    it("keeps handing out fresh ids across several collisions", () => {
        const plan = planRenumber([
            first,
            second,
            issue({ id: 9, title: "Nine A", filePath: "/p/0009-a.md" }),
            issue({ id: 9, title: "Nine B", created: "2026-08-09T00:00:00Z", filePath: "/p/b.md" })
        ]);

        expect(plan.reassignments.map((entry) => entry.to)).toEqual([10, 11]);
    });

    it("renames each file to match its new id", () => {
        const plan = planRenumber([first, second]);

        expect(plan.reassignments[0]!.filename).toBe("0008-filed-second.md");
    });

    it("moves every extra file when three claim one id", () => {
        const third = issue({
            id: 7,
            title: "Filed third",
            created: "2026-08-03T09:00:00Z",
            filePath: "/p/0007-third.md"
        });

        const plan = planRenumber([first, second, third]);

        expect(plan.reassignments.map((entry) => entry.issue.title)).toEqual([
            "Filed second",
            "Filed third"
        ]);
        expect(plan.reassignments.map((entry) => entry.to)).toEqual([8, 9]);
    });

    /**
     * The part that cannot be automated. A child saying `parent: 7` meant one of the two files and nothing
     * on disk records which, so guessing would silently reshape somebody's backlog.
     */
    describe("references to a duplicated id", () => {
        it("reports a parent reference rather than rewriting it", () => {
            const child = issue({ id: 9, title: "A child", parent: 7, filePath: "/p/0009.md" });

            const plan = planRenumber([first, second, child]);

            expect(plan.ambiguous).toEqual([{ issue: child, via: "parent" }]);
            // And nothing in the plan touches the child.
            expect(plan.reassignments.map((entry) => entry.issue.id)).not.toContain(9);
        });

        it("reports a blocker reference too", () => {
            const waiting = issue({ id: 9, blockedBy: [7], filePath: "/p/0009.md" });

            expect(planRenumber([first, second, waiting]).ambiguous).toEqual([
                { issue: waiting, via: "blockedBy" }
            ]);
        });

        it("says nothing about references to ids that were never duplicated", () => {
            const child = issue({ id: 9, parent: 40, filePath: "/p/0009.md" });

            expect(planRenumber([first, second, child, issue({ id: 40 })]).ambiguous).toEqual([]);
        });
    });
});
