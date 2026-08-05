import { describe, expect, it } from "vitest";
import { searchIssues } from "./search.js";
import type { Issue } from "./schema/issue.js";

/**
 * Searching the bodies.
 *
 * What matters is that a hit says where it was — an issue id alone sends the reader back to opening files,
 * which is the thing this replaces — and that the ordering is the one somebody would expect.
 */

function issue(id: number, overrides: Partial<Issue> = {}): Issue {
    return {
        id,
        title: `Issue ${id}`,
        state: "Todo",
        created: "2026-08-01T09:00:00Z",
        updated: "2026-08-01T09:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        ...overrides
    };
}

const note = (body: string, at = "2026-08-02T10:00:00Z") => ({
    at,
    author: { name: "atlas", type: "agent" as const },
    body
});

describe("where it looks", () => {
    it("finds a phrase in the title", () => {
        const found = searchIssues([issue(1, { title: "Check the Host header" })], "host header");

        expect(found).toHaveLength(1);
        expect(found[0]!.hits[0]).toMatchObject({ field: "title" });
    });

    it("finds one in the description, and says which line", () => {
        const issues = [
            issue(1, { description: "First line.\nThe Host header is checked here.\nThird." })
        ];

        const [result] = searchIssues(issues, "host header");

        expect(result!.hits[0]).toMatchObject({
            field: "description",
            lineNumber: 2,
            line: "The Host header is checked here."
        });
    });

    it("finds one in the plan", () => {
        const issues = [issue(1, { plan: "1. Check the header\n2. Ship it" })];

        expect(searchIssues(issues, "check the header")[0]!.hits[0]!.field).toBe("plan");
    });

    /** The notes are the half with the reasoning in them, which is the reason this exists. */
    it("finds one in a note, and says whose note it was", () => {
        const issues = [
            issue(1, { notes: [note("Chose frontmatter over JSON for diff quality.")] })
        ];

        const [result] = searchIssues(issues, "diff quality");

        expect(result!.hits[0]).toMatchObject({
            field: "note",
            note: { at: "2026-08-02T10:00:00Z", author: { name: "atlas", type: "agent" } }
        });
    });

    it("searches every note, not just the first", () => {
        const issues = [
            issue(1, {
                notes: [note("Nothing here."), note("The answer is here.", "2026-08-03T10:00:00Z")]
            })
        ];

        expect(searchIssues(issues, "the answer")[0]!.hits[0]!.note?.at).toBe(
            "2026-08-03T10:00:00Z"
        );
    });

    it("can be told to look in fewer places", () => {
        const issues = [issue(1, { title: "Host header", description: "Host header again" })];

        const [result] = searchIssues(issues, "host header", { fields: ["description"] });

        expect(result!.hits.every((hit) => hit.field === "description")).toBe(true);
    });
});

describe("matching", () => {
    it("ignores case on both sides", () => {
        const issues = [issue(1, { description: "The HOST Header" })];

        expect(searchIssues(issues, "host header")).toHaveLength(1);
    });

    it("matches a phrase rather than separate words", () => {
        const issues = [issue(1, { description: "the header of the host" })];

        // "host header" is not in there in that order, and pretending otherwise would surprise the reader.
        expect(searchIssues(issues, "host header")).toEqual([]);
    });

    it("finds nothing for an empty query rather than everything", () => {
        expect(searchIssues([issue(1, { description: "anything" })], "   ")).toEqual([]);
    });

    it("does not match across a line break", () => {
        const issues = [issue(1, { description: "the host\nheader" })];

        expect(searchIssues(issues, "host header")).toEqual([]);
    });
});

describe("what comes back", () => {
    it("counts every hit but returns a few, so one long issue cannot flood the output", () => {
        const description = Array.from(
            { length: 10 },
            (_, i) => `line ${i} mentions the header`
        ).join("\n");

        const [result] = searchIssues([issue(1, { description })], "header", { maxHits: 3 });

        expect(result!.hits).toHaveLength(3);
        expect(result!.total).toBe(10);
    });

    it("puts a title match above a body match", () => {
        const issues = [
            issue(1, { description: "mentions the header twice: header" }),
            issue(2, { title: "The header" })
        ];

        expect(searchIssues(issues, "header").map((result) => result.issue.id)).toEqual([2, 1]);
    });

    it("then prefers more matches, then the lower id", () => {
        const issues = [
            issue(1, { description: "header" }),
            issue(2, { description: "header\nheader" }),
            issue(3, { description: "header" })
        ];

        expect(searchIssues(issues, "header").map((result) => result.issue.id)).toEqual([2, 1, 3]);
    });
});

describe("composing with the ordinary filters", () => {
    /** The payoff of sharing one filter implementation: a search narrows the same way a list does. */
    it("narrows by state, label and assignee", () => {
        const issues = [
            issue(1, { description: "header", state: "Done" }),
            issue(2, { description: "header", state: "Todo", labels: ["core"] }),
            issue(3, { description: "header", state: "Todo", assignee: "atlas" })
        ];

        expect(
            searchIssues(issues, "header", { filter: { state: "done" } }).map((r) => r.issue.id)
        ).toEqual([1]);
        expect(
            searchIssues(issues, "header", { filter: { label: "core" } }).map((r) => r.issue.id)
        ).toEqual([2]);
        expect(
            searchIssues(issues, "header", { filter: { assignee: "atlas" } }).map((r) => r.issue.id)
        ).toEqual([3]);
    });

    it("matches a state by prefix, the way list does", () => {
        const issues = [issue(1, { description: "header", state: "In Progress" })];

        expect(searchIssues(issues, "header", { filter: { state: "in" } })).toHaveLength(1);
    });
});
