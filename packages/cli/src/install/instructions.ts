import type { MergeResult, RemoveResult } from "./agents.js";
import { hasBrokenMarkers as brokenMarkers, mergeBlock, removeBlock } from "./markedBlock.js";

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

/** Everything between these is motte's; everything outside them is the project's. */
export const AGENTS_MARKERS = { start: "<!-- motte:start -->", end: "<!-- motte:end -->" };

const BLOCK_START = AGENTS_MARKERS.start;
const BLOCK_END = AGENTS_MARKERS.end;

export const AGENTS_FILENAME = "AGENTS.md";

/** The heading a created file gets, since a file that opens on `##` reads like a fragment. */
const FILE_HEADING = "# Agent instructions";

/**
 * The block itself.
 *
 * Deliberately about the loop rather than the command list — `motte --help` is better at the latter, and a
 * copy of it here would be a second copy to keep current. What an agent cannot discover from `--help` is
 * that `next` is the question to start with, that claiming comes before working and a refusal means take
 * something else, that a prerequisite belongs in `block` rather than in prose, and that notes are where the
 * reasoning goes.
 */
export function instructionBlock(): string {
    return `${BLOCK_START}

## Tracking work with motte

This project's work lives in \`.motte/issues/\` as Markdown files, committed alongside the code. Track
work there rather than in an ad-hoc TODO list, a commit message, or a pull request description.

Start by asking what to do:

\`\`\`
motte next --why
\`\`\`

That is not \`motte list\`, and not quite \`motte ready\` either. **Ready** means unsettled with every
blocker settled; \`next\` orders that set by what a piece of work would unblock, how close it is to a leaf,
and how long it has waited — and it leaves out anything somebody else holds. \`motte ready --blocked\` shows
what is waiting and on what.

The loop for an issue you pick up:

1. Claim it — \`motte claim <ref>\`. If that fails, somebody else is on it: ask \`motte next\` again.
2. Read it — \`motte show <ref>\`
3. Refine its **Plan** if the plan on the file is not what you are actually going to do
4. Add notes as you go, especially for decisions and dead ends — \`motte note <ref> "..."\`
5. Move it to Done when the verification for that issue passes, or \`motte release <ref>\` if you stop

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

/** The markers, exported because `install` and `uninstall` both look for them. */
const OPTIONS = { preamble: FILE_HEADING };

export function mergeAgentsMd(existing: string | undefined): MergeResult {
    return mergeBlock(existing, instructionBlock(), AGENTS_MARKERS, OPTIONS);
}

export function removeFromAgentsMd(existing: string): RemoveResult {
    return removeBlock(existing, AGENTS_MARKERS, OPTIONS);
}
