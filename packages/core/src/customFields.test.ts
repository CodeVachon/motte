import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema/config.js";
import { parseIssueFile, formatIssueFile } from "./serialize.js";

const declarations = [
    { key: "customer", description: "Who requested the work", type: "text", isRequired: true },
    { key: "referenceUrl", description: "Related request", type: "url", isRequired: false },
    { key: "estimate", description: "Estimated days", type: "number", isRequired: false },
    {
        key: "billable",
        description: "Whether this is billable",
        type: "boolean",
        isRequired: false
    },
    { key: "targetDate", description: "Target date", type: "date", isRequired: false }
] as const;

const issue = [
    "---",
    "id: 1",
    "title: Customer work",
    "state: Todo",
    "created: 2026-08-26T12:00:00Z",
    "updated: 2026-08-26T12:00:00Z",
    "customer: Sears",
    "referenceUrl: https://example.com/request/42",
    "estimate: 3",
    "billable: true",
    "targetDate: 2026-09-01",
    "---",
    "",
    "## Description",
    "",
    "Keep these typed.",
    ""
].join("\n");

describe("configured issue fields", () => {
    it("parses, types, and serializes declared top-level frontmatter values", () => {
        const parsed = parseIssueFile(issue, undefined, declarations);

        expect(parsed.fields).toEqual({
            customer: "Sears",
            referenceUrl: "https://example.com/request/42",
            estimate: 3,
            billable: true,
            targetDate: "2026-09-01"
        });
        expect(formatIssueFile(parsed, declarations)).toBe(issue);
    });

    it("identifies a missing required, unknown, or mistyped field with its key", () => {
        expect(() =>
            parseIssueFile(issue.replace("customer: Sears\n", ""), undefined, declarations)
        ).toThrow(/required issue field "customer" is missing/);
        expect(() =>
            parseIssueFile(
                `${issue.replace("customer: Sears", "customer: Sears\nclient: typo")}`,
                undefined,
                declarations
            )
        ).toThrow(/client: unknown issue field/);
        expect(() =>
            parseIssueFile(issue.replace("estimate: 3", "estimate: many"), undefined, declarations)
        ).toThrow(/issue field "estimate" must be a number/);
        expect(() =>
            parseIssueFile(
                issue.replace("targetDate: 2026-09-01", "targetDate: 2026-02-30"),
                undefined,
                declarations
            )
        ).toThrow(/issue field "targetDate" must be an ISO date/);
    });

    it("rejects invalid declarations before any issue is read", () => {
        const invalid = ConfigSchema.safeParse({
            issueFields: [
                { key: "customer", description: "One", type: "text", isRequired: true },
                { key: "customer", description: "Two", type: "url", isRequired: false },
                { key: "title", description: "Reserved", type: "text", isRequired: false }
            ]
        });

        expect(invalid.success).toBe(false);
        if (!invalid.success) {
            expect(invalid.error.issues.map((entry) => entry.message).join(" ")).toMatch(
                /duplicate issue field keys.*reserved/
            );
        }
    });
});
