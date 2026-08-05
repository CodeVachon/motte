import { filterIssues, type IssueFilter } from "./filter.js";
import type { Author, Issue } from "./schema/issue.js";

/**
 * Searching the half of the record that queries cannot reach.
 *
 * `list` filters frontmatter and a ref matches a title fragment. Everything else — the reasoning, the dead
 * ends, the decision somebody wrote down three weeks ago — can only be found with `grep -r .motte/issues`,
 * which is a strange gap in a tool whose whole argument is that the notes are worth keeping.
 *
 * Plain case-insensitive substring, not a regular expression. The question this answers is "where did we
 * discuss the Host header", and a phrase is what somebody types. Nothing stops a caller from grepping the
 * files directly for anything cleverer, and the format is designed to make that possible.
 */

export type SearchField = "title" | "description" | "plan" | "note";

export interface Hit {
    field: SearchField;
    /** The matching line, trimmed. */
    line: string;
    /** 1-based, within that field, so a caller can point at where it was. */
    lineNumber: number;
    /** Which note the hit was in, for a note hit. */
    note?: { at: string; author: Author };
}

export interface SearchResult {
    issue: Issue;
    /** Capped for display; `total` is how many there really were. */
    hits: Hit[];
    total: number;
}

export interface SearchOptions {
    /** The same filters `list` uses, so a search composes with state, label and assignee. */
    filter?: IssueFilter;
    /** Which fields to look in. All of them by default. */
    fields?: readonly SearchField[];
    /** How many hits to keep per issue. */
    maxHits?: number;
}

const ALL_FIELDS: readonly SearchField[] = ["title", "description", "plan", "note"];

function linesMatching(text: string, needle: string): { line: string; lineNumber: number }[] {
    const found: { line: string; lineNumber: number }[] = [];

    text.split("\n").forEach((line, index) => {
        if (line.toLowerCase().includes(needle)) {
            found.push({ line: line.trim(), lineNumber: index + 1 });
        }
    });

    return found;
}

function hitsIn(issue: Issue, needle: string, fields: readonly SearchField[]): Hit[] {
    const hits: Hit[] = [];

    if (fields.includes("title")) {
        for (const found of linesMatching(issue.title, needle)) {
            hits.push({ field: "title", ...found });
        }
    }

    for (const field of ["description", "plan"] as const) {
        if (!fields.includes(field)) continue;
        for (const found of linesMatching(issue[field], needle)) {
            hits.push({ field, ...found });
        }
    }

    if (fields.includes("note")) {
        for (const note of issue.notes) {
            for (const found of linesMatching(note.body, needle)) {
                hits.push({ field: "note", ...found, note: { at: note.at, author: note.author } });
            }
        }
    }

    return hits;
}

/**
 * Issues matching `query`, best first.
 *
 * A title match ranks above a body match, then more matches above fewer, then the lowest id — which is
 * explainable in a sentence, unlike a relevance score, and the same reasoning `next` follows.
 */
export function searchIssues(
    issues: readonly Issue[],
    query: string,
    options: SearchOptions = {}
): SearchResult[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];

    const fields = options.fields ?? ALL_FIELDS;
    const maxHits = options.maxHits ?? 3;
    const candidates = filterIssues(issues, options.filter ?? {}, { stateMatch: "prefix" });

    const results: SearchResult[] = [];

    for (const issue of candidates) {
        const hits = hitsIn(issue, needle, fields);
        if (hits.length === 0) continue;

        results.push({ issue, hits: hits.slice(0, maxHits), total: hits.length });
    }

    return results.sort((a, b) => {
        const titled = Number(inTitle(b)) - Number(inTitle(a));
        if (titled !== 0) return titled;

        if (a.total !== b.total) return b.total - a.total;
        return a.issue.id - b.issue.id;
    });
}

function inTitle(result: SearchResult): boolean {
    return result.hits.some((hit) => hit.field === "title");
}
