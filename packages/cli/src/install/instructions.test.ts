import { describe, expect, it } from "vitest";
import {
    AGENTS_MARKERS,
    instructionBlock,
    mergeAgentsMd,
    removeFromAgentsMd
} from "./instructions.js";
import { hasBrokenMarkers } from "./markedBlock.js";

/**
 * The AGENTS.md block.
 *
 * The file belongs to the project, not to motte, so what matters here is that nothing outside the markers
 * is ever touched and that re-running changes nothing. Both are tested against a file with real content in
 * it rather than an empty one, because "merges cleanly" is only interesting when there is something to
 * merge with — the same reason the `.mcp.json` tests use a file that already has another server in it.
 */

const EXISTING = `# Contributing agents

Run the test suite before you finish.

## House style

Tabs, and we will not be discussing it.
`;

describe("mergeAgentsMd", () => {
    it("creates the file with a heading, so it does not open on a subheading", () => {
        const merged = mergeAgentsMd(undefined);

        expect(merged.created).toBe(true);
        expect(merged.content.startsWith("# ")).toBe(true);
        expect(merged.content).toContain(AGENTS_MARKERS.start);
        expect(merged.content).toContain(AGENTS_MARKERS.end);
        expect(merged.content).toContain("motte ready");
    });

    it("appends to an existing file without disturbing a word of it", () => {
        const merged = mergeAgentsMd(EXISTING);

        expect(merged.created).toBe(false);
        expect(merged.unchanged).toBe(false);
        // Everything the project wrote survives, in its original order.
        expect(merged.content.startsWith(EXISTING)).toBe(true);
        expect(merged.content).toContain("Tabs, and we will not be discussing it.");
    });

    it("appends rather than prepends, because the top of the file is the project's", () => {
        const merged = mergeAgentsMd(EXISTING);

        expect(merged.content.indexOf("# Contributing agents")).toBeLessThan(
            merged.content.indexOf(AGENTS_MARKERS.start)
        );
    });

    it("is unchanged the second time, so init and install can both be re-run", () => {
        const once = mergeAgentsMd(EXISTING);
        const twice = mergeAgentsMd(once.content);

        expect(twice.unchanged).toBe(true);
        expect(twice.content).toBe(once.content);
    });

    it("replaces an older block in place rather than adding a second one", () => {
        const stale = `${EXISTING}\n${AGENTS_MARKERS.start}\n\n## Tracking work with motte\n\nSomething from an older version.\n\n${AGENTS_MARKERS.end}\n`;

        const merged = mergeAgentsMd(stale);

        expect(merged.unchanged).toBe(false);
        expect(merged.content).not.toContain("Something from an older version");
        expect(merged.content.split(AGENTS_MARKERS.start)).toHaveLength(2);
        expect(merged.content).toContain("Tabs, and we will not be discussing it.");
    });

    it("leaves whatever follows the block alone when replacing it", () => {
        const around = `Before.\n\n${AGENTS_MARKERS.start}\nold\n${AGENTS_MARKERS.end}\n\nAfter.\n`;

        const merged = mergeAgentsMd(around);

        expect(merged.content).toContain("Before.");
        expect(merged.content).toContain("After.");
        expect(merged.content).toContain("motte ready");
    });
});

describe("removeFromAgentsMd", () => {
    it("takes the block out and leaves the rest", () => {
        const removed = removeFromAgentsMd(mergeAgentsMd(EXISTING).content);

        expect(removed.absent).toBe(false);
        expect(removed.empty).toBe(false);
        expect(removed.content).not.toContain("motte ready");
        expect(removed.content).not.toContain(AGENTS_MARKERS.start);
        expect(removed.content).toContain("Tabs, and we will not be discussing it.");
    });

    it("reports a file that only ever held motte's block as empty", () => {
        // Which is how `uninstall` knows it may delete the file rather than leave an empty one behind.
        const removed = removeFromAgentsMd(mergeAgentsMd(undefined).content);

        expect(removed.empty).toBe(true);
    });

    it("says so when there is no block to remove", () => {
        const removed = removeFromAgentsMd(EXISTING);

        expect(removed.absent).toBe(true);
        expect(removed.content).toBe(EXISTING);
    });

    it("round-trips: merge then remove restores the original", () => {
        expect(removeFromAgentsMd(mergeAgentsMd(EXISTING).content).content.trim()).toBe(
            EXISTING.trim()
        );
    });
});

describe("half-written markers", () => {
    /**
     * A start marker with no end means someone edited them by hand. Appending a second block would leave
     * the file with two, and rewriting from the start marker to the end of the file would eat whatever
     * they had written after it — so this is reported and the file is left alone.
     */
    it("is detectable, so the caller can refuse instead of guessing", () => {
        const broken = `${EXISTING}\n${AGENTS_MARKERS.start}\nsomething half-deleted\n`;

        expect(hasBrokenMarkers(broken, AGENTS_MARKERS)).toBe(true);
        expect(hasBrokenMarkers(mergeAgentsMd(EXISTING).content, AGENTS_MARKERS)).toBe(false);
        expect(hasBrokenMarkers(EXISTING, AGENTS_MARKERS)).toBe(false);
    });
});

describe("the block's content", () => {
    /** The parts an agent cannot get from `--help`, which is the only reason the block exists. */
    it("teaches next, claiming, the loop, notes and block", () => {
        const block = instructionBlock();

        expect(block).toMatch(/motte next/);
        expect(block).toMatch(/motte claim <ref>/);
        expect(block).toMatch(/motte release <ref>/);
        expect(block).toMatch(/motte note <ref>/);
        expect(block).toMatch(/motte block <ref> <blocker>/);
        expect(block).toMatch(/\.motte\/issues\//);
    });

    /**
     * The claim step is the one an agent will skip if the instructions merely mention it, and skipping it
     * is what puts two agents on one issue.
     */
    it("says what to do when a claim fails, since that is the whole point of claiming", () => {
        expect(instructionBlock()).toMatch(/If that fails/);
    });
});
