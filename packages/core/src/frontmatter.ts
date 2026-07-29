import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { parseFrontmatter } from "./serialize.js";
import type { Frontmatter } from "./schema/issue.js";

/**
 * How much of a file to read looking for the closing `---`.
 *
 * Frontmatter is a handful of short scalar fields, so this is generous by orders of magnitude. The
 * point is to avoid pulling a long Description and a pile of Notes off disk when all that is wanted
 * is the header.
 */
export const FRONTMATTER_CHUNK_BYTES = 4096;

/** An issue's header plus where it came from. Everything the completion path needs. */
export type IssueRef = Frontmatter & { filePath: string };

/**
 * Read only enough of a file to parse its frontmatter.
 *
 * Falls back to reading the whole file when the closing fence is not in the first chunk, so an
 * unusually long header is still handled correctly rather than reported as malformed.
 */
export function readFrontmatter(filePath: string): Frontmatter {
    let handle: number | undefined;
    try {
        handle = openSync(filePath, "r");
        const buffer = Buffer.allocUnsafe(FRONTMATTER_CHUNK_BYTES);
        const read = readSync(handle, buffer, 0, FRONTMATTER_CHUNK_BYTES, 0);
        const head = buffer.toString("utf8", 0, read);

        // Only trust a chunk that actually contains the closing fence. A truncated read could
        // otherwise cut the header mid-field and produce a confusing validation error.
        if (hasClosingFence(head)) return parseFrontmatter(head, filePath);
    } finally {
        if (handle !== undefined) closeSync(handle);
    }

    return parseFrontmatter(readFileSync(filePath, "utf8"), filePath);
}

function hasClosingFence(text: string): boolean {
    if (!text.startsWith("---")) return false;

    // The opening fence is at index 0, so look for a `---` line after it.
    const closing = /\r?\n---[ \t]*(\r?\n|$)/.exec(text);
    return closing !== null;
}

export function readIssueRef(filePath: string): IssueRef {
    return { ...readFrontmatter(filePath), filePath };
}
