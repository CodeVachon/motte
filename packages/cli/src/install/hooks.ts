import type { MergeResult, RemoveResult } from "./agents.js";
import { mergeBlock, removeBlock } from "./markedBlock.js";

/**
 * The git hook that stamps a commit with the issue it belongs to.
 *
 * The convention already exists — commit messages here carry `#0042` — and a convention that depends on
 * remembering is one that lapses. This makes it hold by itself, which is what turns `motte show` listing an
 * issue's commits from a nice idea into something reliable.
 *
 * Opt-in, via `motte install --hooks`. A hook runs on every commit somebody makes in the repository, and
 * writing one into `.git/hooks` unasked is a larger liberty than merging a config entry.
 *
 * Pure, like the AGENTS.md block: takes the current contents and returns the new ones, between markers, so
 * a hook somebody already had keeps working and `uninstall` can remove exactly motte's part.
 */

export const HOOK_NAME = "prepare-commit-msg";

/** Everything between these is motte's; whatever else the hook does is not. */
export const HOOK_MARKERS = { start: "# motte:start", end: "# motte:end" };

const BLOCK_START = HOOK_MARKERS.start;
const BLOCK_END = HOOK_MARKERS.end;

const SHEBANG = "#!/bin/sh";

/**
 * The block itself.
 *
 * `Refs: #0042` rather than a bare `#0042`, and this is the detail that matters: git strips lines beginning
 * with `#` from a commit message, so a bare reference appended to an interactive commit would vanish and the
 * hook would look broken for no visible reason.
 *
 * Every failure path exits 0. A hook that fails blocks the commit, and no stamping is worth that.
 */
export function hookBlock(command = "motte"): string {
    return `${BLOCK_START}
# Appends the issue you have claimed to the commit message, unless it already names one.
#
# "Refs: #0042" rather than "#0042": git strips lines starting with # from a commit message, so a bare
# reference would silently disappear from an interactive commit.
if [ "$2" != "merge" ] && [ "$2" != "squash" ] && command -v ${command} >/dev/null 2>&1; then
    # Only the lines that survive into the message — the template's comments mention numbers of their own.
    if ! grep -v '^#' "$1" 2>/dev/null | grep -qE '#[0-9]+'; then
        motte_issue="$(${command} current 2>/dev/null || true)"
        if [ -n "$motte_issue" ]; then
            printf '\\nRefs: %s\\n' "$motte_issue" >> "$1"
        fi
    fi
fi
${BLOCK_END}
`;
}

const OPTIONS = { preamble: SHEBANG };

export function mergeHook(existing: string | undefined): MergeResult {
    return mergeBlock(existing, hookBlock(), HOOK_MARKERS, OPTIONS);
}

export function removeFromHook(existing: string): RemoveResult {
    return removeBlock(existing, HOOK_MARKERS, OPTIONS);
}
