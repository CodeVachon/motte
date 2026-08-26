import { describe, expect, it } from "vitest";
import { FrontmatterSchema, type Issue } from "@motte/core";
import { issueJson } from "./context.js";

/**
 * Tests for the `--json` contract.
 *
 * These exist in-process, rather than only through the CLI smoke tests, for two reasons. `issueJson` is
 * pure, so there is nothing to gain from spawning a process to reach it. And the contract had already
 * drifted once: `blockedBy` was added to the issue model but never to this function, so every `--json`
 * response omitted blockers while the MCP server's own shape included them.
 */

function issue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 1,
        title: "An issue",
        state: "Todo",
        created: "2026-07-30T00:00:00Z",
        updated: "2026-07-30T00:00:00Z",
        description: "Describe.",
        plan: "Plan.",
        notes: [],
        unknownSections: [],
        ...overrides
    };
}

describe("issueJson", () => {
    /**
     * The guard for the drift described above. Every field in the frontmatter model must appear in the
     * `--json` output, so adding a field to `FrontmatterSchema` and forgetting this function fails here
     * rather than shipping a surface that silently lacks it.
     */
    it("represents every field of the issue model", () => {
        const emitted = new Set(Object.keys(issueJson(issue())));

        for (const field of Object.keys(FrontmatterSchema.shape)) {
            expect(emitted, `frontmatter field \`${field}\` is missing from --json`).toContain(
                field
            );
        }
    });

    it("emits the documented key set and nothing more", () => {
        // Pinned so a field cannot be added to the contract by accident. `unknownSections` is
        // deliberately absent — it is a preservation detail of the file format, not data about the
        // issue — and `filePath` is renamed to `file`.
        expect(Object.keys(issueJson(issue())).sort()).toEqual([
            "assignee",
            "blockedBy",
            "created",
            "description",
            "fields",
            "file",
            "id",
            "labels",
            "notes",
            "parent",
            "plan",
            "state",
            "title",
            "updated"
        ]);
    });

    it("passes through the values it is given", () => {
        const json = issueJson(
            issue({
                parent: 7,
                assignee: "atlas",
                labels: ["core", "cli"],
                blockedBy: [2, 3],
                filePath: "/tmp/0001-an-issue.md"
            })
        );

        expect(json).toMatchObject({
            id: 1,
            title: "An issue",
            state: "Todo",
            parent: 7,
            assignee: "atlas",
            labels: ["core", "cli"],
            blockedBy: [2, 3],
            file: "/tmp/0001-an-issue.md"
        });
    });

    /**
     * Absent optionals become `null` or `[]`, never `undefined`, because `JSON.stringify` drops
     * `undefined` keys entirely — a consumer would see the field vanish rather than read as empty.
     */
    it("gives absent optionals an explicit empty value", () => {
        const json = issueJson(issue());

        expect(json.parent).toBeNull();
        expect(json.assignee).toBeNull();
        expect(json.file).toBeNull();
        expect(json.labels).toEqual([]);
        expect(json.blockedBy).toEqual([]);

        const parsed = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
        expect(Object.keys(parsed)).toContain("blockedBy");
        expect(Object.keys(parsed)).toContain("parent");
    });

    it("keeps note authorship structured", () => {
        const json = issueJson(
            issue({
                notes: [
                    {
                        at: "2026-07-30T01:00:00Z",
                        author: { name: "Test User", type: "user" },
                        body: "A decision."
                    }
                ]
            })
        );

        expect(json.notes).toEqual([
            {
                at: "2026-07-30T01:00:00Z",
                author: { name: "Test User", type: "user" },
                body: "A decision."
            }
        ]);
    });
});
