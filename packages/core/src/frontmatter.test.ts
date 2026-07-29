import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRONTMATTER_CHUNK_BYTES, readFrontmatter, readIssueRef } from "./frontmatter.js";
import { IssueParseError, parseFrontmatter, parseIssueFile } from "./serialize.js";

const HEADER = [
    "---",
    "id: 42",
    "title: Design the schema",
    "state: In Progress",
    "parent: 7",
    "assignee: atlas",
    "labels: [core, testing]",
    "blockedBy: [11, 12]",
    "created: 2026-07-29T14:02:11Z",
    "updated: 2026-07-29T15:31:04Z",
    "---"
].join("\n");

function write(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "motte-fm-"));
    const path = join(dir, "0042-design-the-schema.md");
    writeFileSync(path, content, "utf8");
    return path;
}

describe("parseFrontmatter", () => {
    it("returns every header field", () => {
        const frontmatter = parseFrontmatter(`${HEADER}\n\n## Description\n\nBody.\n`);

        expect(frontmatter).toEqual({
            id: 42,
            title: "Design the schema",
            state: "In Progress",
            parent: 7,
            assignee: "atlas",
            labels: ["core", "testing"],
            blockedBy: [11, 12],
            created: "2026-07-29T14:02:11Z",
            updated: "2026-07-29T15:31:04Z"
        });
    });

    it("works on text that stops at the closing fence, with no body at all", () => {
        // This is the property that lets a caller read a bounded chunk rather than a whole file.
        expect(parseFrontmatter(`${HEADER}\n`).id).toBe(42);
    });

    /**
     * The structural guard that this does no body work. A body the full parser rejects must still
     * parse here — timing tests would be flaky, but this cannot pass if someone reintroduces body
     * parsing on this path.
     */
    it("ignores a body that parseIssueFile refuses", () => {
        const withBadBody = `${HEADER}\n\n## Notes\n\nstray text with no note heading\n`;

        expect(() => parseIssueFile(withBadBody)).toThrow(IssueParseError);
        expect(parseFrontmatter(withBadBody).id).toBe(42);
    });

    it("still validates the header", () => {
        expect(() => parseFrontmatter("---\ntitle: No id\n---\n")).toThrow(IssueParseError);
        expect(() => parseFrontmatter("no frontmatter here")).toThrow(IssueParseError);
    });

    it("agrees with parseIssueFile on the header of a real file", () => {
        const text = `${HEADER}\n\n## Description\n\nBody.\n`;
        const full = parseIssueFile(text);
        const light = parseFrontmatter(text);

        for (const key of Object.keys(light) as (keyof typeof light)[]) {
            expect(light[key]).toEqual(full[key]);
        }
    });
});

describe("readFrontmatter", () => {
    it("reads a normal file", () => {
        const path = write(`${HEADER}\n\n## Description\n\nBody.\n`);
        expect(readFrontmatter(path).title).toBe("Design the schema");
    });

    it("does not need to read the whole file", () => {
        // A body far larger than the read chunk. If this only worked by reading everything, the
        // bounded path would be pointless; if the bounded path were broken, this would throw.
        const body = "x".repeat(FRONTMATTER_CHUNK_BYTES * 20);
        const path = write(`${HEADER}\n\n## Description\n\n${body}\n`);

        expect(readFrontmatter(path).id).toBe(42);
    });

    it("falls back to the whole file when the header exceeds one chunk", () => {
        // An absurd number of labels pushes the closing fence past the chunk boundary. Correctness
        // has to win over the fast path here.
        const labels = Array.from({ length: 900 }, (_, i) => `label-number-${i}`);
        const fat = [
            "---",
            "id: 7",
            "title: Very long header",
            "state: Todo",
            `labels: [${labels.join(", ")}]`,
            "created: 2026-07-29T12:00:00Z",
            "updated: 2026-07-29T12:00:00Z",
            "---"
        ].join("\n");

        expect(fat.length).toBeGreaterThan(FRONTMATTER_CHUNK_BYTES);

        const path = write(`${fat}\n\n## Description\n\nBody.\n`);
        const frontmatter = readFrontmatter(path);

        expect(frontmatter.id).toBe(7);
        expect(frontmatter.labels).toHaveLength(900);
    });

    it("reports a file with no frontmatter", () => {
        expect(() => readFrontmatter(write("just some markdown\n"))).toThrow(IssueParseError);
    });

    it("reports a file whose header is invalid", () => {
        expect(() => readFrontmatter(write("---\ntitle: No id\n---\n\nBody.\n"))).toThrow(
            IssueParseError
        );
    });

    it("throws for a file that does not exist", () => {
        expect(() => readFrontmatter(join(tmpdir(), "motte-nope", "0001-x.md"))).toThrow();
    });

    it("handles a file that is only a header, with no trailing newline", () => {
        expect(readFrontmatter(write(HEADER)).id).toBe(42);
    });
});

describe("readIssueRef", () => {
    it("attaches the path to the header", () => {
        const path = write(`${HEADER}\n\n## Description\n\nBody.\n`);
        const ref = readIssueRef(path);

        expect(ref.filePath).toBe(path);
        expect(ref.title).toBe("Design the schema");
    });
});
