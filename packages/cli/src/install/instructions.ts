import type { MergeResult, RemoveResult } from "./agents.js";

/**
 * The instructions motte leaves for the agents it wires up.
 *
 * Wiring the MCP server tells an agent that motte exists; it does not tell it how the project is meant to
 * be worked. Those are different things, and the second is what stops an agent from keeping its plan in a
 * scratch list that dies with the session — the whole reason this tool exists.
 *
 * `AGENTS.md` because it is the file the supported agents already read, and because it is the project's,
 * not motte's: everything written here lives between markers, and nothing outside them is ever touched.
 * That is what makes re-running safe and `motte uninstall` exact.
 *
 * Pure, like `agents.ts`: takes the current contents and returns the new ones.
 */

export const BLOCK_START = "<!-- motte:start -->";
export const BLOCK_END = "<!-- motte:end -->";

export const AGENTS_FILENAME = "AGENTS.md";

/** The heading a created file gets, since a file that opens on `##` reads like a fragment. */
const FILE_HEADING = "# Agent instructions";

/**
 * The block itself.
 *
 * Deliberately about the loop rather than the command list — `motte --help` is better at the latter, and a
 * copy of it here would be a second copy to keep current. What an agent cannot discover from `--help` is
 * that `ready` is the question to start with, that a prerequisite belongs in `block` rather than in prose,
 * and that notes are where the reasoning goes.
 */
export function instructionBlock(): string {
    return `${BLOCK_START}

## Tracking work with motte

This project's work lives in \`.motte/issues/\` as Markdown files, committed alongside the code. Track
work there rather than in an ad-hoc TODO list, a commit message, or a pull request description.

Start with what is actually available:

\`\`\`
motte ready
\`\`\`

That is not \`motte list\`. **Ready** means unsettled with every blocker settled, so it excludes work that
cannot be started yet. \`motte ready --blocked\` shows what is waiting and on what.

The loop for an issue you pick up:

1. Read it — \`motte show <ref>\`
2. Refine its **Plan** if the plan on the file is not what you are actually going to do
3. Move it to In Progress — \`motte move <ref> "in progress"\`
4. Add notes as you go, especially for decisions and dead ends — \`motte note <ref> "..."\`
5. Move it to Done when the verification for that issue passes

A \`<ref>\` is an issue number or a fragment of the title, so \`motte show parser\` works as well as
\`motte show 12\`.

If you discover a prerequisite mid-task, record it with \`motte block <ref> <blocker>\` rather than
describing it in prose. Prose is not queryable, and \`motte ready\` is what the next agent reads.

Every read command accepts \`--json\`. The MCP server exposes the same operations, and notes written
through it are attributed to the agent rather than to the repository's git user — which is the point:
one shared record of who decided what.

${BLOCK_END}
`;
}

interface Bounds {
    start: number;
    end: number;
}

/** Where motte's block sits, if it is there at all. */
function findBlock(content: string): Bounds | undefined {
    const start = content.indexOf(BLOCK_START);
    if (start === -1) return undefined;

    const end = content.indexOf(BLOCK_END, start);
    // A start with no end means someone edited the markers. Treating that as "no block" would append a
    // second one, so it is reported instead and the file is left alone.
    if (end === -1) return undefined;

    return { start, end: end + BLOCK_END.length };
}

/** True when the file has a start marker whose end marker is missing, so it cannot be edited safely. */
export function hasBrokenMarkers(content: string): boolean {
    return content.includes(BLOCK_START) && !content.includes(BLOCK_END);
}

export function mergeAgentsMd(existing: string | undefined): MergeResult {
    const block = instructionBlock();

    if (existing === undefined) {
        return { content: `${FILE_HEADING}\n\n${block}`, created: true, unchanged: false };
    }

    const bounds = findBlock(existing);

    if (bounds === undefined) {
        // Appended, never prepended: the top of this file is where a project puts what matters most, and
        // that judgement is not motte's to overrule.
        const padded = existing.endsWith("\n\n")
            ? existing
            : existing.endsWith("\n")
              ? `${existing}\n`
              : `${existing}\n\n`;

        return { content: `${padded}${block}`, created: false, unchanged: false };
    }

    const current = existing.slice(bounds.start, bounds.end);
    if (current.trim() === block.trim()) {
        return { content: existing, created: false, unchanged: true };
    }

    // An older block is replaced in place rather than appended to, so upgrading never leaves two.
    return {
        content: `${existing.slice(0, bounds.start)}${block.trim()}${existing.slice(bounds.end)}`,
        created: false,
        unchanged: false
    };
}

export function removeFromAgentsMd(existing: string): RemoveResult {
    const bounds = findBlock(existing);

    if (bounds === undefined) return { content: existing, empty: false, absent: true };

    const content = `${existing.slice(0, bounds.start)}${existing.slice(bounds.end)}`
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();

    // "Empty" means nothing but the heading motte itself would have written is left, so the file only
    // exists because motte created it.
    const remaining = content.replace(FILE_HEADING, "").trim();

    return {
        content: content.length === 0 ? "" : `${content}\n`,
        empty: remaining.length === 0,
        absent: false
    };
}
