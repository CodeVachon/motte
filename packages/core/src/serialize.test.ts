import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatIssueFile, IssueParseError, parseIssueFile } from "./serialize.js";

/**
 * This repository's own backlog. These files were authored by hand before this parser existed, so
 * they are the specification for the format rather than output of it.
 */
const SEED_DIR = join(import.meta.dirname, "..", "..", "..", ".motte", "issues");

const seedFiles = readdirSync(SEED_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort();

describe("round-trip against the hand-authored backlog", () => {
    it("finds the seed files", () => {
        expect(seedFiles.length).toBeGreaterThan(30);
    });

    it.each(seedFiles)("%s parses and re-emits byte for byte", (name) => {
        const path = join(SEED_DIR, name);
        const original = readFileSync(path, "utf8");

        const issue = parseIssueFile(original, path);
        expect(formatIssueFile(issue)).toBe(original);
    });

    it("gives every seed file a positive id and a title", () => {
        for (const name of seedFiles) {
            const issue = parseIssueFile(readFileSync(join(SEED_DIR, name), "utf8"), name);
            expect(issue.id).toBeGreaterThan(0);
            expect(issue.title.length).toBeGreaterThan(0);
        }
    });

    it("keeps timestamps as strings rather than coercing them to dates", () => {
        const issue = parseIssueFile(readFileSync(join(SEED_DIR, seedFiles[0]!), "utf8"));
        expect(typeof issue.created).toBe("string");
        expect(issue.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
});

describe("sections", () => {
    it("preserves unknown sections in place", () => {
        const source = [
            "---",
            "id: 12",
            "title: Has extra sections",
            "state: Todo",
            "created: 2026-07-29T11:34:00Z",
            "updated: 2026-07-29T11:34:00Z",
            "---",
            "",
            "## Description",
            "",
            "A description.",
            "",
            "## Plan",
            "",
            "1. Step one",
            "",
            "## Acceptance",
            "",
            "- Something observable",
            "",
            "## Risks",
            "",
            "A risk.",
            "",
            "## Notes",
            "",
            "### 2026-07-29T11:34:00Z — claude (agent)",
            "",
            "A note.",
            ""
        ].join("\n");

        const issue = parseIssueFile(source);

        expect(issue.unknownSections.map((section) => section.heading)).toEqual([
            "Acceptance",
            "Risks"
        ]);
        expect(issue.unknownSections.every((section) => section.after === "plan")).toBe(true);
        expect(formatIssueFile(issue)).toBe(source);
    });

    it("tolerates a file with only a description", () => {
        const source = [
            "---",
            "id: 39",
            "title: Minimal",
            "state: Todo",
            "created: 2026-07-29T12:00:00Z",
            "updated: 2026-07-29T12:00:00Z",
            "---",
            "",
            "## Description",
            "",
            "Just this.",
            ""
        ].join("\n");

        const issue = parseIssueFile(source);

        expect(issue.plan).toBe("");
        expect(issue.notes).toEqual([]);
        expect(formatIssueFile(issue)).toBe(source);
    });

    it("drops a known section that has no content", () => {
        const source = [
            "---",
            "id: 1",
            "title: Empty plan",
            "state: Todo",
            "created: 2026-07-29T12:00:00Z",
            "updated: 2026-07-29T12:00:00Z",
            "---",
            "",
            "## Description",
            "",
            "Text.",
            "",
            "## Plan",
            ""
        ].join("\n");

        expect(formatIssueFile(parseIssueFile(source))).not.toContain("## Plan");
    });
});

describe("notes", () => {
    const withNotes = (...noteLines: string[]) =>
        [
            "---",
            "id: 1",
            "title: Notes",
            "state: Todo",
            "created: 2026-07-29T12:00:00Z",
            "updated: 2026-07-29T12:00:00Z",
            "---",
            "",
            "## Notes",
            "",
            ...noteLines,
            ""
        ].join("\n");

    it("parses author name and type from the heading", () => {
        const issue = parseIssueFile(
            withNotes("### 2026-07-29T15:31:04Z — Christopher Vachon (user)", "", "Body text.")
        );

        expect(issue.notes).toHaveLength(1);
        expect(issue.notes[0]!.author).toEqual({ name: "Christopher Vachon", type: "user" });
        expect(issue.notes[0]!.at).toBe("2026-07-29T15:31:04Z");
        expect(issue.notes[0]!.body).toBe("Body text.");
    });

    it("keeps multiple notes in order, with multi-paragraph bodies", () => {
        const issue = parseIssueFile(
            withNotes(
                "### 2026-07-29T15:31:04Z — atlas (agent)",
                "",
                "First paragraph.",
                "",
                "Second paragraph.",
                "",
                "### 2026-07-29T15:44:10Z — Christopher Vachon (user)",
                "",
                "Reply."
            )
        );

        expect(issue.notes.map((note) => note.author.name)).toEqual([
            "atlas",
            "Christopher Vachon"
        ]);
        expect(issue.notes[0]!.body).toBe("First paragraph.\n\nSecond paragraph.");
    });

    it("rejects stray content before the first note heading", () => {
        expect(() => parseIssueFile(withNotes("loose text with no heading"))).toThrow(
            IssueParseError
        );
    });

    it("keeps a level-2 heading inside a note body instead of reclassifying it", () => {
        // Regression: agents write Markdown into notes, and a `## ` line used to be torn out of the
        // note and turned into an unknown section — byte-identical on disk, but a truncated note.
        const source = withNotes(
            "### 2026-07-29T12:00:00Z — claude (agent)",
            "",
            "Here is a heading in my note:",
            "",
            "## Design notes",
            "",
            "Still part of the note."
        );

        const issue = parseIssueFile(source);

        expect(issue.notes).toHaveLength(1);
        expect(issue.unknownSections).toEqual([]);
        expect(issue.notes[0]!.body).toContain("## Design notes");
        expect(issue.notes[0]!.body).toContain("Still part of the note.");
        expect(formatIssueFile(issue)).toBe(source);
    });

    it("still splits a section that follows an empty Notes heading", () => {
        const source = [
            "---",
            "id: 1",
            "title: Empty notes",
            "state: Todo",
            "created: 2026-07-29T12:00:00Z",
            "updated: 2026-07-29T12:00:00Z",
            "---",
            "",
            "## Notes",
            "",
            "## Risks",
            "",
            "A risk.",
            ""
        ].join("\n");

        const issue = parseIssueFile(source);

        expect(issue.notes).toEqual([]);
        expect(issue.unknownSections.map((section) => section.heading)).toEqual(["Risks"]);
    });

    it("keeps a heading inside the second note, not just the first", () => {
        const issue = parseIssueFile(
            withNotes(
                "### 2026-07-29T12:00:00Z — claude (agent)",
                "",
                "First.",
                "",
                "### 2026-07-29T13:00:00Z — claude (agent)",
                "",
                "## Nested",
                "",
                "Second."
            )
        );

        expect(issue.notes).toHaveLength(2);
        expect(issue.notes[0]!.body).toBe("First.");
        expect(issue.notes[1]!.body).toContain("## Nested");
    });
});

describe("frontmatter", () => {
    const build = (...fields: string[]) =>
        ["---", ...fields, "---", "", "## Description", "", "Body.", ""].join("\n");

    it("rejects a file with no frontmatter", () => {
        expect(() => parseIssueFile("## Description\n\nNo frontmatter.\n")).toThrow(
            IssueParseError
        );
    });

    it("rejects a missing id", () => {
        expect(() =>
            parseIssueFile(
                build(
                    "title: No id",
                    "state: Todo",
                    "created: 2026-07-29T12:00:00Z",
                    "updated: 2026-07-29T12:00:00Z"
                )
            )
        ).toThrow(/id/);
    });

    it("normalises field order on write", () => {
        const issue = parseIssueFile(
            build(
                "updated: 2026-07-29T12:00:00Z",
                "state: Todo",
                "title: Out of order",
                "created: 2026-07-29T12:00:00Z",
                "id: 4"
            )
        );

        const emitted = formatIssueFile(issue).split("\n");
        expect(emitted.slice(1, 6)).toEqual([
            "id: 4",
            "title: Out of order",
            "state: Todo",
            "created: 2026-07-29T12:00:00Z",
            "updated: 2026-07-29T12:00:00Z"
        ]);
    });

    it("quotes a title that would otherwise change meaning", () => {
        const issue = parseIssueFile(
            build(
                "id: 5",
                'title: "config: discovery and validation"',
                "state: Todo",
                "created: 2026-07-29T12:00:00Z",
                "updated: 2026-07-29T12:00:00Z"
            )
        );

        expect(issue.title).toBe("config: discovery and validation");
        expect(formatIssueFile(issue)).toContain('title: "config: discovery and validation"');
        expect(parseIssueFile(formatIssueFile(issue)).title).toBe(issue.title);
    });

    /**
     * A regression. `isPlainScalarSafe` rejected a *leading* comma but not an interior one — correct
     * for a block scalar like a title, wrong inside `labels: [...]` where a comma separates items. A
     * label containing one was emitted bare and read back as several labels, so the file no longer
     * round-tripped. Interior commas in a title must stay unquoted, which is why the two cases need
     * different rules rather than one stricter one.
     */
    it("quotes a label containing a comma, but not a title containing one", () => {
        const issue = parseIssueFile(
            build(
                "id: 7",
                'title: "First, second"',
                "state: Todo",
                'labels: ["cli,testing", plain]',
                "created: 2026-07-29T12:00:00Z",
                "updated: 2026-07-29T12:00:00Z"
            )
        );

        expect(issue.labels).toEqual(["cli,testing", "plain"]);

        const formatted = formatIssueFile(issue);
        expect(formatted).toContain('labels: ["cli,testing", plain]');
        expect(formatted).toContain("title: First, second");

        const reparsed = parseIssueFile(formatted);
        expect(reparsed.labels).toEqual(issue.labels);
        expect(reparsed.title).toBe(issue.title);
        expect(formatIssueFile(reparsed)).toBe(formatted);
    });

    it("round-trips a title that looks like a number", () => {
        const issue = parseIssueFile(
            build(
                "id: 6",
                'title: "2026"',
                "state: Todo",
                "created: 2026-07-29T12:00:00Z",
                "updated: 2026-07-29T12:00:00Z"
            )
        );

        expect(issue.title).toBe("2026");
        expect(parseIssueFile(formatIssueFile(issue)).title).toBe("2026");
    });
});
