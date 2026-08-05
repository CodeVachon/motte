/**
 * A block motte owns inside a file somebody else owns.
 *
 * Two of these exist — motte's section of `AGENTS.md` and its part of the `prepare-commit-msg` hook — and
 * they had the same three functions each, down to identically named exports, which is how fallow found them.
 * The mechanics are the same in both cases and worth stating once: everything between the markers is
 * motte's, everything outside them is not, and that boundary is what makes re-running safe and `uninstall`
 * exact.
 */

export interface BlockMarkers {
    start: string;
    end: string;
}

export interface MergeOutcome {
    content: string;
    /** True when the file did not exist and is being created wholesale. */
    created: boolean;
    /** True when it already held exactly this block. */
    unchanged: boolean;
}

export interface RemoveOutcome {
    content: string;
    /** True when nothing but motte's own preamble is left, so the file only exists because of motte. */
    empty: boolean;
    /** True when there was no block to remove. */
    absent: boolean;
}

interface Bounds {
    start: number;
    end: number;
}

function findBlock(content: string, markers: BlockMarkers): Bounds | undefined {
    const start = content.indexOf(markers.start);
    if (start === -1) return undefined;

    const end = content.indexOf(markers.end, start);
    // A start with no end means somebody edited the markers. Treating that as "no block" would append a
    // second one, and rewriting from the start marker onwards would eat whatever followed it.
    if (end === -1) return undefined;

    return { start, end: end + markers.end.length };
}

export function hasBrokenMarkers(content: string, markers: BlockMarkers): boolean {
    return content.includes(markers.start) && !content.includes(markers.end);
}

export interface MergeOptions {
    /**
     * The first line a created file gets: a heading for a Markdown file, a shebang for a script.
     *
     * Only used when creating. Appending to a file that exists must never touch its opening.
     */
    preamble: string;
}

export function mergeBlock(
    existing: string | undefined,
    block: string,
    markers: BlockMarkers,
    options: MergeOptions
): MergeOutcome {
    if (existing === undefined) {
        return { content: `${options.preamble}\n\n${block}`, created: true, unchanged: false };
    }

    const bounds = findBlock(existing, markers);

    if (bounds === undefined) {
        // Appended, never prepended. In a Markdown file the top is where a project puts what matters most;
        // in a hook, whatever was there first should keep running first.
        const padded = existing.endsWith("\n\n")
            ? existing
            : existing.endsWith("\n")
              ? `${existing}\n`
              : `${existing}\n\n`;

        return { content: `${padded}${block}`, created: false, unchanged: false };
    }

    if (existing.slice(bounds.start, bounds.end).trim() === block.trim()) {
        return { content: existing, created: false, unchanged: true };
    }

    // Replaced in place rather than appended to, so upgrading never leaves two.
    return {
        content: `${existing.slice(0, bounds.start)}${block.trim()}${existing.slice(bounds.end)}`,
        created: false,
        unchanged: false
    };
}

export function removeBlock(
    existing: string,
    markers: BlockMarkers,
    options: MergeOptions
): RemoveOutcome {
    const bounds = findBlock(existing, markers);

    if (bounds === undefined) return { content: existing, empty: false, absent: true };

    const content = `${existing.slice(0, bounds.start)}${existing.slice(bounds.end)}`
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();

    const remaining = content.replace(options.preamble, "").trim();

    return {
        content: content.length === 0 ? "" : `${content}\n`,
        empty: remaining.length === 0,
        absent: false
    };
}
