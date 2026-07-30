import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAll, committedProject, initialised, motte } from "../testing/cli.js";

/**
 * `prune` and `restore`, which deletes committed files and promises the deletion is recoverable.
 *
 * These two handlers held the highest CRAP scores in the project at 420 and 110, both at 0% coverage.
 * That mattered more here than anywhere else in the CLI, because the guarantee is the whole feature: a
 * prune writes a `pruned` tombstone recording the last commit the file appeared in, and `restore` reads
 * the file back out of that commit. If tombstones stop being written, prune silently becomes destructive.
 *
 * I checked that by hand once, in a throwaway temp repo. This is that check, kept.
 */

/** Rewrite every timestamp in the backlog and the log so a cutoff can see the work as old. */
function backdate(root: string, to = "2026-01-05"): void {
    const events = join(root, ".motte", "events");
    for (const name of readdirSync(events)) {
        const path = join(events, name);
        writeFileSync(
            path,
            readFileSync(path, "utf8").replace(/"at":"\d{4}-\d\d-\d\d/g, `"at":"${to}`),
            "utf8"
        );
    }

    const issues = join(root, ".motte", "issues");
    for (const name of readdirSync(issues)) {
        const path = join(issues, name);
        writeFileSync(
            path,
            readFileSync(path, "utf8").replace(/(created|updated): \d{4}-\d\d-\d\d/g, `$1: ${to}`),
            "utf8"
        );
    }
}

/** A committed project with `count` settled issues, all backdated past any sane cutoff. */
async function settled(count = 2): Promise<string> {
    const root = await committedProject();

    for (let i = 1; i <= count; i += 1) {
        await motte(root, ["add", `Finished ${i}`, "-d", "Done and dusted."]);
        await motte(root, ["move", String(i), "done"]);
    }

    backdate(root);
    commitAll(root);
    return root;
}

function issueFiles(root: string): string[] {
    return readdirSync(join(root, ".motte", "issues"));
}

function tombstoneCount(root: string): number {
    const dir = join(root, ".motte", "events");
    let found = 0;

    for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (!name.isFile()) continue;
        for (const line of readFileSync(join(dir, name.name), "utf8").split("\n")) {
            if (line.includes('"type":"pruned"')) found += 1;
        }
    }

    return found;
}

describe("prune --dry-run", () => {
    it("reports what would go and what would stay, with reasons", async () => {
        const root = await settled(2);
        await motte(root, ["add", "Still open", "-d", "Not done."]);
        commitAll(root);

        const plan = await motte(root, ["prune", "--before", "2026-06", "--dry-run", "--json"]);
        const json = plan.json<{
            cutoff: string;
            prunable: { id: number }[];
            skipped: { id: number; reason: { kind: string } }[];
        }>();

        expect(json.prunable.map((issue) => issue.id)).toEqual([1, 2]);
        expect(json.skipped.find((entry) => entry.id === 3)?.reason.kind).toBe("not-settled");
    });

    it("changes nothing on disk", async () => {
        const root = await settled(2);
        const before = issueFiles(root);

        await motte(root, ["prune", "--before", "2026-06", "--dry-run"]);

        expect(issueFiles(root)).toEqual(before);
        expect(tombstoneCount(root)).toBe(0);
    });

    it("keeps an issue something else still points at, and says why", async () => {
        const root = await committedProject();
        await motte(root, ["add", "Blocker", "-d", "x"]);
        await motte(root, ["add", "Open dependent", "-d", "y"]);
        await motte(root, ["block", "2", "1"]);
        await motte(root, ["move", "1", "done"]);
        backdate(root);
        commitAll(root);

        const json = (
            await motte(root, ["prune", "--before", "2026-06", "--dry-run", "--json"])
        ).json<{
            prunable: { id: number }[];
            skipped: { id: number; reason: { kind: string; as?: string } }[];
        }>();

        // #1 is settled and old, but #2 still lists it as a blocker — pruning it would dangle.
        expect(json.prunable).toEqual([]);
        const kept = json.skipped.find((entry) => entry.id === 1);
        expect(kept?.reason.kind).toBe("referenced");
        expect(kept?.reason.as).toBe("blocker");
    });
});

describe("prune, and restoring what it removed", () => {
    it("removes the issues and leaves a tombstone for each", async () => {
        const root = await settled(2);

        const run = await motte(root, ["prune", "--before", "2026-06", "-y"]);

        expect(run.code).toBe(0);
        expect(issueFiles(root)).toEqual([]);
        expect(tombstoneCount(root)).toBe(2);
        // The tombstone is only useful if it names a commit to recover from.
        expect(run.stdout).toMatch(/Recoverable from [0-9a-f]{7}/);
    });

    /** The guarantee, end to end: what prune removed, restore brings back unchanged. */
    it("restores an issue from its tombstone, with its content intact", async () => {
        const root = await settled(1);
        const original = readFileSync(join(root, ".motte", "issues", issueFiles(root)[0]!), "utf8");

        await motte(root, ["prune", "--before", "2026-06", "-y"]);
        expect(issueFiles(root)).toEqual([]);

        const restored = await motte(root, ["restore", "1"]);

        expect(restored.code).toBe(0);
        expect(issueFiles(root)).toHaveLength(1);
        expect(readFileSync(join(root, ".motte", "issues", issueFiles(root)[0]!), "utf8")).toBe(
            original
        );
    });

    it("drops the pruned issues' own events, keeping the tombstone", async () => {
        const root = await settled(1);

        const run = await motte(root, ["prune", "--before", "2026-06", "-y", "--json"]);
        const json = run.json<{ removedEvents: number; pruned: unknown[] }>();

        expect(json.pruned).toHaveLength(1);
        expect(json.removedEvents).toBeGreaterThan(0);
        expect(tombstoneCount(root)).toBe(1);
    });
});

describe("prune --events-only", () => {
    /**
     * The other half of the guarantee, and the one a careless refactor breaks. `--events-only` strips
     * history while leaving the issues on disk, so it must write no tombstones — otherwise `restore`
     * offers to bring back issues that were never removed and are still there.
     */
    it("keeps the issues, writes no tombstone, and leaves nothing to restore", async () => {
        const root = await settled(1);

        const run = await motte(root, ["prune", "--before", "2026-06", "--events-only", "-y"]);

        expect(run.code).toBe(0);
        expect(issueFiles(root)).toHaveLength(1);
        expect(tombstoneCount(root)).toBe(0);

        const restored = await motte(root, ["restore", "1"]);
        expect(restored.code).toBe(1);
        expect(restored.stderr).toMatch(/no tombstone was found/);
    });
});

describe("prune refuses rather than risking an unrecoverable delete", () => {
    /**
     * The guard runs only once something is actually eligible — prune does not demand a repository when
     * it has nothing to delete. So this needs a settled, backdated issue, which is what tripped my first
     * version of this test: with an empty backlog it exited 0 and never reached the check.
     */
    it("refuses outside a git repository", async () => {
        const root = await initialised();
        await motte(root, ["add", "Finished", "-d", "x"]);
        await motte(root, ["move", "1", "done"]);
        backdate(root);

        const run = await motte(root, ["prune", "--before", "2026-06", "-y"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/not a git repository/);
    });

    it("refuses when the backlog has uncommitted changes, naming the files", async () => {
        const root = await settled(1);
        await motte(root, ["add", "Uncommitted", "-d", "x"]);

        const run = await motte(root, ["prune", "--before", "2026-06", "-y"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/uncommitted changes/);
        // Naming the path is the point: an earlier bug printed one with its leading `.` eaten.
        expect(run.stderr).toMatch(/\.motte\/issues\//);
    });

    it("requires a cutoff rather than assuming one", async () => {
        const root = await settled(1);
        const run = await motte(root, ["prune", "-y"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/before/);
    });

    it("rejects a cutoff it cannot parse", async () => {
        const root = await settled(1);
        const run = await motte(root, ["prune", "--before", "last tuesday", "-y"]);

        expect(run.code).toBe(1);
    });

    it("prunes nothing when everything is newer than the cutoff", async () => {
        const root = await committedProject();
        await motte(root, ["add", "Recent", "-d", "x"]);
        await motte(root, ["move", "1", "done"]);
        commitAll(root);

        const run = await motte(root, ["prune", "--before", "2020-01", "-y"]);

        expect(issueFiles(root)).toHaveLength(1);
        expect(tombstoneCount(root)).toBe(0);
        expect(run.stdout + run.stderr).toMatch(/nothing/i);
    });
});

describe("restore", () => {
    it("reports an id that was never pruned", async () => {
        const root = await settled(1);
        const run = await motte(root, ["restore", "1"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/no tombstone was found for #1/);
    });

    it("reports an id that never existed", async () => {
        const root = await settled(1);
        const run = await motte(root, ["restore", "999"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/no tombstone/);
    });

    it("refuses to restore over an issue that is already there", async () => {
        const root = await settled(1);
        await motte(root, ["prune", "--before", "2026-06", "-y"]);
        commitAll(root, "pruned");

        expect((await motte(root, ["restore", "1"])).code).toBe(0);
        const second = await motte(root, ["restore", "1"]);

        expect(second.code).toBe(1);
        expect(second.stderr).toMatch(/already/);
    });
});
