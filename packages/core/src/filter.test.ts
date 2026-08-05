import { describe, expect, it } from "vitest";
import { filterIssues, matchesFilter } from "./filter.js";
import type { Issue } from "./schema/issue.js";

/**
 * The shared filters.
 *
 * Written against the behaviour the three former copies already had, so that replacing them is provably a
 * refactor and not a redefinition. The one place they genuinely differed — prefix versus exact state
 * matching — is a parameter, and both halves are tested.
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
        ...overrides
    };
}

describe("matchesFilter", () => {
    it("keeps everything when nothing is asked for", () => {
        expect(matchesFilter(issue(), {})).toBe(true);
    });

    describe("state", () => {
        it("matches exactly by default, ignoring case", () => {
            expect(matchesFilter(issue({ state: "In Progress" }), { state: "in progress" })).toBe(
                true
            );
            expect(matchesFilter(issue({ state: "In Progress" }), { state: "in" })).toBe(false);
        });

        /** `motte list --state don` is the reason this mode exists — a leading fragment, not a substring. */
        it("matches a leading fragment in prefix mode, not a fragment from the middle", () => {
            const inProgress = issue({ state: "In Progress" });

            expect(matchesFilter(inProgress, { state: "in" }, { stateMatch: "prefix" })).toBe(true);
            // Worth stating: `--state prog` finds nothing, which is easy to assume otherwise.
            expect(matchesFilter(inProgress, { state: "prog" }, { stateMatch: "prefix" })).toBe(
                false
            );
            expect(
                matchesFilter(issue({ state: "Done" }), { state: "don" }, { stateMatch: "prefix" })
            ).toBe(true);
        });
    });

    describe("label", () => {
        it("matches one of many, ignoring case", () => {
            const labelled = issue({ labels: ["Core", "testing"] });

            expect(matchesFilter(labelled, { label: "core" })).toBe(true);
            expect(matchesFilter(labelled, { label: "TESTING" })).toBe(true);
            expect(matchesFilter(labelled, { label: "web" })).toBe(false);
        });

        it("matches the whole label, not part of one", () => {
            expect(matchesFilter(issue({ labels: ["core"] }), { label: "cor" })).toBe(false);
        });

        it("excludes an issue with no labels at all", () => {
            expect(matchesFilter(issue(), { label: "core" })).toBe(false);
        });
    });

    describe("assignee", () => {
        it("matches exactly, ignoring case", () => {
            expect(matchesFilter(issue({ assignee: "Atlas" }), { assignee: "atlas" })).toBe(true);
            expect(matchesFilter(issue({ assignee: "Atlas" }), { assignee: "atl" })).toBe(false);
        });

        it("excludes an unassigned issue", () => {
            expect(matchesFilter(issue(), { assignee: "atlas" })).toBe(false);
        });
    });

    describe("parent", () => {
        it("compares ids", () => {
            expect(matchesFilter(issue({ parent: 7 }), { parent: 7 })).toBe(true);
            expect(matchesFilter(issue({ parent: 7 }), { parent: 8 })).toBe(false);
            expect(matchesFilter(issue(), { parent: 7 })).toBe(false);
        });
    });

    it("requires every field asked for, not any of them", () => {
        const target = issue({ state: "Todo", labels: ["core"], assignee: "atlas" });

        expect(matchesFilter(target, { state: "todo", label: "core", assignee: "atlas" })).toBe(
            true
        );
        expect(matchesFilter(target, { state: "todo", label: "web", assignee: "atlas" })).toBe(
            false
        );
    });
});

describe("filterIssues", () => {
    const issues = [
        issue({ id: 1, state: "Todo", labels: ["core"] }),
        issue({ id: 2, state: "Done", labels: ["core"], assignee: "atlas" }),
        issue({ id: 3, state: "Done" })
    ];

    it("narrows to what matches, keeping order", () => {
        expect(filterIssues(issues, { label: "core" }).map((entry) => entry.id)).toEqual([1, 2]);
    });

    it("returns everything for an empty filter", () => {
        expect(filterIssues(issues, {})).toHaveLength(3);
    });

    it("combines fields", () => {
        expect(filterIssues(issues, { state: "done", label: "core" }).map((e) => e.id)).toEqual([
            2
        ]);
    });
});
