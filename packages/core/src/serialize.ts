import { parse as parseYaml } from "yaml";
import {
    FrontmatterSchema,
    validateIssueFields,
    type Frontmatter,
    type Issue,
    type Note,
    type UnknownSection
} from "./schema/issue.js";
import type { IssueField } from "./schema/config.js";

/** Em dash (U+2014) — the delimiter in a note heading. Not a hyphen. */
const NOTE_DELIMITER = "—";

const FRONTMATTER_FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const SECTION_HEADING = /^## +(.+?)[ \t]*$/;
const NOTE_HEADING = new RegExp(
    `^### +(\\S+) +${NOTE_DELIMITER} +(.+?) +\\((user|agent)\\)[ \\t]*$`
);

/**
 * Field order in emitted frontmatter. Parsing accepts any order; writing always normalises to this
 * one so a file rewritten by motte has a stable, reviewable shape.
 */
const FIELD_ORDER = [
    "id",
    "title",
    "state",
    "parent",
    "assignee",
    "labels",
    "blockedBy",
    "created",
    "updated"
] as const satisfies readonly (keyof Frontmatter)[];

export class IssueParseError extends Error {
    constructor(
        message: string,
        readonly filePath?: string
    ) {
        super(filePath === undefined ? message : `${filePath}: ${message}`);
        this.name = "IssueParseError";
    }
}

/**
 * True when a string can be written as a bare YAML scalar. Deliberately conservative: anything
 * ambiguous gets quoted rather than risking a value that reads back as a different type.
 *
 * `flow` must be set for values written inside an inline `[...]` list, where `,` and the bracket
 * characters are structural rather than ordinary text. Without it a label containing a comma is
 * emitted bare into the list and reads back as several labels — the file stops round-tripping, which
 * is the one property the format guarantees.
 */
function isPlainScalarSafe(value: string, flow = false): boolean {
    if (value.length === 0) return false;
    if (value !== value.trim()) return false;
    // Leading YAML indicator characters.
    if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return false;
    // `: ` opens a mapping; ` #` opens a comment.
    if (value.includes(": ") || value.includes(" #")) return false;
    if (value.endsWith(":")) return false;
    if (/[\r\n]/.test(value)) return false;
    // Interior flow indicators are harmless in a block scalar but structural inside `[...]`.
    if (flow && /[,[\]{}]/.test(value)) return false;
    // Would read back as a non-string in the YAML 1.2 core schema.
    if (/^(true|false|null|~|-?\d+(\.\d+)?([eE][-+]?\d+)?)$/i.test(value)) return false;
    return true;
}

function emitScalar(value: string): string {
    return isPlainScalarSafe(value) ? value : JSON.stringify(value);
}

/** As `emitScalar`, for a value written inside an inline `[...]` list. */
function emitFlowScalar(value: string): string {
    return isPlainScalarSafe(value, true) ? value : JSON.stringify(value);
}

function emitFrontmatter(issue: Issue, issueFields: readonly IssueField[]): string {
    const lines: string[] = [];

    for (const field of FIELD_ORDER) {
        const value = issue[field];
        if (value === undefined) continue;

        if (field === "labels") {
            const labels = value as string[];
            if (labels.length === 0) continue;
            lines.push(`labels: [${labels.map(emitFlowScalar).join(", ")}]`);
        } else if (field === "blockedBy") {
            const blockers = value as number[];
            if (blockers.length === 0) continue;
            // Sorted and de-duplicated on write so a merge that appends the same blocker twice, or
            // in a different order, converges on one canonical form instead of churning the diff.
            const canonical = [...new Set(blockers)].sort((a, b) => a - b);
            lines.push(`blockedBy: [${canonical.join(", ")}]`);
        } else if (typeof value === "number") {
            lines.push(`${field}: ${value}`);
        } else {
            lines.push(`${field}: ${emitScalar(String(value))}`);
        }
    }

    for (const field of issueFields) {
        const value = issue.fields?.[field.key];
        if (value === undefined) continue;

        if (typeof value === "boolean" || typeof value === "number") {
            lines.push(`${field.key}: ${value}`);
        } else {
            lines.push(`${field.key}: ${emitScalar(value)}`);
        }
    }

    return lines.join("\n");
}

/** Split a body into `## ` sections, preserving the text before any heading as the preamble. */
function splitSections(body: string): {
    preamble: string;
    sections: { heading: string; body: string }[];
} {
    const lines = body.split("\n");
    const sections: { heading: string; body: string }[] = [];
    const preamble: string[] = [];
    let current: { heading: string; body: string[] } | undefined;

    // Once a note heading has been seen, the rest of the file belongs to that note. Agents write
    // Markdown into notes routinely, and without this a note containing a `## ` line would be
    // silently truncated with its tail reclassified as a section. Scoped to *after* the first note
    // heading so an empty `## Notes` followed by another section still parses.
    let inNoteBody = false;

    for (const line of lines) {
        if (current?.heading.toLowerCase() === "notes" && NOTE_HEADING.test(line)) {
            inNoteBody = true;
        }

        const match = inNoteBody ? null : SECTION_HEADING.exec(line);

        if (match) {
            if (current) sections.push({ heading: current.heading, body: current.body.join("\n") });
            current = { heading: match[1]!, body: [] };
        } else if (current) {
            current.body.push(line);
        } else {
            preamble.push(line);
        }
    }

    if (current) sections.push({ heading: current.heading, body: current.body.join("\n") });

    return { preamble: preamble.join("\n").trim(), sections };
}

function parseNotes(body: string, filePath?: string): Note[] {
    const lines = body.split("\n");
    const notes: Note[] = [];
    let current: { at: string; author: Note["author"]; body: string[] } | undefined;

    for (const line of lines) {
        const match = NOTE_HEADING.exec(line);
        if (match) {
            if (current) notes.push({ ...current, body: current.body.join("\n").trim() });
            current = {
                at: match[1]!,
                author: { name: match[2]!, type: match[3] as "user" | "agent" },
                body: []
            };
        } else if (current) {
            current.body.push(line);
        } else if (line.trim().length > 0) {
            throw new IssueParseError(
                `content in the Notes section before the first note heading: ${JSON.stringify(line.trim())}`,
                filePath
            );
        }
    }

    if (current) notes.push({ ...current, body: current.body.join("\n").trim() });

    return notes;
}

/**
 * Split the frontmatter off the body and validate it.
 *
 * The single implementation behind both `parseFrontmatter` and `parseIssueFile`, so the two can
 * never disagree about what a valid header is.
 */
function splitFrontmatter(
    text: string,
    filePath?: string,
    issueFields: readonly IssueField[] = []
): { frontmatter: Frontmatter; fields: Record<string, string | number | boolean>; body: string } {
    const fence = FRONTMATTER_FENCE.exec(text);
    if (!fence) {
        throw new IssueParseError("missing YAML frontmatter delimited by `---`", filePath);
    }

    let raw: unknown;
    try {
        // The 1.2 core schema leaves `2026-07-29T11:20:00Z` as a string rather than coercing it to
        // a Date, which is what we want — timestamps round-trip as the exact text on disk.
        raw = parseYaml(fence[1]!, { schema: "core", version: "1.2" });
    } catch (error) {
        throw new IssueParseError(
            `invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
            filePath
        );
    }

    const parsed = FrontmatterSchema.safeParse(raw);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; ");
        throw new IssueParseError(`invalid frontmatter — ${detail}`, filePath);
    }

    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new IssueParseError("invalid frontmatter — (root): expected an object", filePath);
    }

    const record = raw as Record<string, unknown>;
    const known = new Set([
        ...Object.keys(FrontmatterSchema.shape),
        ...issueFields.map((field) => field.key)
    ]);
    const unknown = Object.keys(record).filter((key) => !known.has(key));
    if (unknown.length > 0) {
        throw new IssueParseError(
            `invalid frontmatter — ${unknown.map((key) => `${key}: unknown issue field`).join("; ")}`,
            filePath
        );
    }

    let fields: Record<string, string | number | boolean>;
    try {
        fields = validateIssueFields(
            issueFields,
            Object.fromEntries(issueFields.map((field) => [field.key, record[field.key]])),
            { requireRequired: true }
        );
    } catch (error) {
        throw new IssueParseError(
            `invalid frontmatter — ${error instanceof Error ? error.message : String(error)}`,
            filePath
        );
    }

    return { frontmatter: parsed.data, fields, body: text.slice(fence[0].length) };
}

/**
 * Parse just the frontmatter, doing no work on the body.
 *
 * `text` need only reach the closing `---` fence, which is what lets callers read a bounded chunk of
 * a file rather than all of it. Cost is independent of body size — that is the property the
 * completion path depends on, and there is a test pinning it.
 */
export function parseFrontmatter(
    text: string,
    filePath?: string,
    issueFields: readonly IssueField[] = []
): Frontmatter {
    return splitFrontmatter(text, filePath, issueFields).frontmatter;
}

export function parseIssueFile(
    text: string,
    filePath?: string,
    issueFields: readonly IssueField[] = []
): Issue {
    const { frontmatter, fields, body } = splitFrontmatter(text, filePath, issueFields);
    const parsed = { data: frontmatter };
    const { preamble, sections } = splitSections(body);

    let description = "";
    let plan = "";
    let notes: Note[] = [];
    const unknownSections: UnknownSection[] = [];
    let lastKnown: UnknownSection["after"] = null;
    const seen = new Set<string>();

    if (preamble.length > 0) {
        unknownSections.push({ heading: "", body: preamble, after: null });
    }

    for (const section of sections) {
        const key = section.heading.toLowerCase();
        const content = section.body.trim();

        if (key === "description" && !seen.has(key)) {
            description = content;
            lastKnown = "description";
            seen.add(key);
        } else if (key === "plan" && !seen.has(key)) {
            plan = content;
            lastKnown = "plan";
            seen.add(key);
        } else if (key === "notes" && !seen.has(key)) {
            notes = parseNotes(section.body, filePath);
            lastKnown = "notes";
            seen.add(key);
        } else {
            unknownSections.push({ heading: section.heading, body: content, after: lastKnown });
        }
    }

    return {
        ...parsed.data,
        ...(Object.keys(fields).length === 0 ? {} : { fields }),
        description,
        plan,
        notes,
        unknownSections,
        ...(filePath === undefined ? {} : { filePath })
    };
}

export function formatNote(note: Note): string {
    return `### ${note.at} ${NOTE_DELIMITER} ${note.author.name} (${note.author.type})\n\n${note.body}\n`;
}

export function formatIssueFile(issue: Issue, issueFields: readonly IssueField[] = []): string {
    const parts: string[] = [`---\n${emitFrontmatter(issue, issueFields)}\n---\n`];

    const emitUnknown = (after: UnknownSection["after"]) => {
        for (const section of issue.unknownSections) {
            if (section.after !== after) continue;
            parts.push(
                section.heading === ""
                    ? `\n${section.body}\n`
                    : `\n## ${section.heading}\n\n${section.body}\n`
            );
        }
    };

    emitUnknown(null);

    // A section with no content is omitted rather than written as an empty heading. This is the one
    // intentional normalisation in the round-trip: `## Plan` with nothing under it does not survive.
    if (issue.description.length > 0) {
        parts.push(`\n## Description\n\n${issue.description}\n`);
    }
    emitUnknown("description");

    if (issue.plan.length > 0) {
        parts.push(`\n## Plan\n\n${issue.plan}\n`);
    }
    emitUnknown("plan");

    if (issue.notes.length > 0) {
        parts.push("\n## Notes\n");
        for (const note of issue.notes) parts.push(`\n${formatNote(note)}`);
    }
    emitUnknown("notes");

    return parts.join("");
}
