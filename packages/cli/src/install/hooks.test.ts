import { describe, expect, it } from "vitest";
import { HOOK_MARKERS, hookBlock, mergeHook, removeFromHook } from "./hooks.js";
import { hasBrokenMarkers } from "./markedBlock.js";

/**
 * The commit hook.
 *
 * A hook runs on every commit somebody makes in the repository, so the two things that matter are that it
 * cannot break a commit and that it leaves a hook they already had working. Both are checked here; that the
 * stamping itself works is checked against a real repository and a real `git commit`.
 */

const THEIRS = `#!/bin/sh
# Their hook, which was here first.
./scripts/lint-commit-message.sh "$1" || exit 1
`;

describe("the block", () => {
    /**
     * The detail that matters most. git strips lines starting with `#` from a commit message, so a bare
     * `#0042` appended to an interactive commit would silently vanish and the hook would look broken.
     */
    it("writes a trailer that git will not strip as a comment", () => {
        const block = hookBlock();

        expect(block).toContain("Refs: %s");
        expect(block).not.toMatch(/printf '\\n#/);
    });

    it("never fails the commit, whatever goes wrong", () => {
        const block = hookBlock();

        // No `exit 1` anywhere, and the lookup tolerates its own failure.
        expect(block).not.toContain("exit 1");
        expect(block).toContain("|| true");
    });

    it("does nothing when motte is not on the PATH", () => {
        expect(hookBlock()).toContain("command -v motte >/dev/null 2>&1");
    });

    it("leaves a merge or a squash alone", () => {
        const block = hookBlock();

        expect(block).toContain('"$2" != "merge"');
        expect(block).toContain('"$2" != "squash"');
    });

    /** The template's own comments mention numbers, so only the surviving lines are searched. */
    it("looks for an existing reference in the message rather than the comments", () => {
        expect(hookBlock()).toContain("grep -v '^#'");
    });
});

describe("mergeHook", () => {
    it("creates the file with a shebang, since git executes it directly", () => {
        const merged = mergeHook(undefined);

        expect(merged.created).toBe(true);
        expect(merged.content.startsWith("#!/bin/sh")).toBe(true);
    });

    it("appends to a hook that was already there, after what it already did", () => {
        const merged = mergeHook(THEIRS);

        expect(merged.content.startsWith(THEIRS)).toBe(true);
        expect(merged.content).toContain(HOOK_MARKERS.start);
        // Theirs runs first, because it was there before motte was.
        expect(merged.content.indexOf("lint-commit-message")).toBeLessThan(
            merged.content.indexOf(HOOK_MARKERS.start)
        );
    });

    it("changes nothing the second time", () => {
        const once = mergeHook(THEIRS);

        expect(mergeHook(once.content)).toMatchObject({ unchanged: true, content: once.content });
    });

    it("replaces an older block rather than stacking a second one", () => {
        const stale = `${THEIRS}\n${HOOK_MARKERS.start}\nsomething older\n${HOOK_MARKERS.end}\n`;

        const merged = mergeHook(stale);

        expect(merged.content.split(HOOK_MARKERS.start)).toHaveLength(2);
        expect(merged.content).not.toContain("something older");
        expect(merged.content).toContain("lint-commit-message");
    });
});

describe("removeFromHook", () => {
    it("takes motte's block out and leaves theirs", () => {
        const removed = removeFromHook(mergeHook(THEIRS).content);

        expect(removed.absent).toBe(false);
        expect(removed.empty).toBe(false);
        expect(removed.content).toContain("lint-commit-message");
        expect(removed.content).not.toContain(HOOK_MARKERS.start);
    });

    it("reports a hook that only ever held motte's block as empty, so it can be deleted", () => {
        expect(removeFromHook(mergeHook(undefined).content).empty).toBe(true);
    });

    it("says so when there is nothing of motte's in it", () => {
        expect(removeFromHook(THEIRS)).toMatchObject({ absent: true, content: THEIRS });
    });

    it("round-trips: merge then remove restores theirs", () => {
        expect(removeFromHook(mergeHook(THEIRS).content).content.trim()).toBe(THEIRS.trim());
    });
});

describe("half-written markers", () => {
    it("are detectable, so the caller refuses rather than eating what follows", () => {
        expect(hasBrokenMarkers(`${THEIRS}\n${HOOK_MARKERS.start}\nhalf`, HOOK_MARKERS)).toBe(true);
        expect(hasBrokenMarkers(mergeHook(THEIRS).content, HOOK_MARKERS)).toBe(false);
        expect(hasBrokenMarkers(THEIRS, HOOK_MARKERS)).toBe(false);
    });
});
