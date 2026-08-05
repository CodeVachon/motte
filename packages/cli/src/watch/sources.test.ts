import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LIMIT, collectAll } from "./sources.js";
import { registryPath, type ProjectSummary } from "../projects/registry.js";

/**
 * Choosing which projects `--all` watches.
 *
 * Against a real registry file and real project directories, because the interesting cases are all about
 * disagreement between the two: an entry whose project has been deleted, one whose config no longer parses,
 * and more projects than anybody wants watchers open for.
 */

let home: string;
let previous: string | undefined;

/** A real project on disk, and the registry row that points at it. */
function project(name: string, options: { config?: string } = {}): ProjectSummary {
    const root = join(home, name);
    mkdirSync(join(root, ".motte", "issues"), { recursive: true });
    writeFileSync(
        join(root, ".motte.config.json"),
        options.config ?? JSON.stringify({ name, issuesDir: ".motte/issues" }),
        "utf8"
    );

    return {
        root,
        name,
        issues: 0,
        done: 0,
        counted: 0,
        percent: 0,
        ready: 0,
        inFlight: [],
        seen: "2026-08-01T00:00:00Z"
    };
}

/**
 * Written as a file rather than through the registry's own writer.
 *
 * The writer summarises a live project; these tests need rows that disagree with what is on disk — an entry
 * pointing at a deleted project, one whose config will not parse — which only hand-written rows can express.
 */
function register(projects: ProjectSummary[]): void {
    const path = registryPath();
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({ projects }, null, 2), "utf8");
}

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "motte-sources-"));
    previous = process.env.MOTTE_INSTALL_DIR;
    // The registry lives under the install dir, which is where `registryPath` looks.
    process.env.MOTTE_INSTALL_DIR = join(home, ".motte");
});

afterEach(() => {
    if (previous === undefined) delete process.env.MOTTE_INSTALL_DIR;
    else process.env.MOTTE_INSTALL_DIR = previous;
    rmSync(home, { recursive: true, force: true });
});

describe("collectAll", () => {
    it("makes a source for every registered project", () => {
        register([project("alpha"), project("beta")]);

        const collected = collectAll({ watching: true });

        expect(collected.sources.map((source) => source.name).sort()).toEqual(["alpha", "beta"]);
        expect(collected.omitted).toBe(0);
        expect(collected.unreadable).toEqual([]);
    });

    it("reads each project through its own config", () => {
        register([project("alpha"), project("beta")]);

        const collected = collectAll({ watching: true });

        // Each source reads its own directory, which is what keeps two projects' issues apart.
        for (const source of collected.sources) {
            expect(source.config.root).toContain(source.name);
            expect(source.read().issues).toEqual([]);
        }
    });

    /** The registry is a convenience over the files; a stale row must not stop the others being watched. */
    it("reports a project whose config has gone rather than failing", () => {
        const gone = project("gone");
        rmSync(join(gone.root, ".motte.config.json"));
        register([project("alpha"), gone]);

        const collected = collectAll({ watching: true });

        expect(collected.sources.map((source) => source.name)).toEqual(["alpha"]);
        expect(collected.unreadable).toHaveLength(1);
        expect(collected.unreadable[0]!.name).toBe("gone");
    });

    it("reports a config it cannot parse, and keeps the rest", () => {
        register([project("alpha"), project("broken", { config: "{ not json" })]);

        const collected = collectAll({ watching: true });

        expect(collected.sources.map((source) => source.name)).toEqual(["alpha"]);
        expect(collected.unreadable[0]!.name).toBe("broken");
        // Counted as unreadable, not as omitted — it is not something a bigger limit would have included.
        expect(collected.omitted).toBe(0);
    });

    /**
     * Each source opens watchers and re-parses a backlog on every write. A machine with forty registered
     * projects mostly has projects nobody has touched in months, so the newest are kept — and the count of
     * what was left is what stops the subset being silent.
     */
    describe("the limit", () => {
        it("keeps the most recently seen", () => {
            register([
                { ...project("old"), seen: "2026-01-01T00:00:00Z" },
                { ...project("newest"), seen: "2026-08-05T00:00:00Z" },
                { ...project("middle"), seen: "2026-06-01T00:00:00Z" }
            ]);

            const collected = collectAll({ watching: true, limit: 2 });

            expect(collected.sources.map((source) => source.name)).toEqual(["newest", "middle"]);
            expect(collected.omitted).toBe(1);
        });

        it("defaults to a bound rather than to everything", () => {
            register(Array.from({ length: DEFAULT_LIMIT + 3 }, (_, index) => project(`p${index}`)));

            const collected = collectAll({ watching: true });

            expect(collected.sources).toHaveLength(DEFAULT_LIMIT);
            expect(collected.omitted).toBe(3);
        });

        /** A project that is gone was never a candidate, so it must not inflate the omitted count. */
        it("does not count a missing project as one it chose to leave out", () => {
            const gone = project("gone");
            rmSync(join(gone.root, ".motte.config.json"));
            register([project("alpha"), gone]);

            expect(collectAll({ watching: true, limit: 1 }).omitted).toBe(0);
        });
    });

    it("gives a source no watcher when polling, since the two are alternatives", () => {
        register([project("alpha")]);

        expect(collectAll({ watching: false }).sources[0]!.watch).toBeUndefined();
        expect(collectAll({ watching: true }).sources[0]!.watch).toBeDefined();
    });

    it("returns nothing when the registry is empty, rather than throwing", () => {
        expect(collectAll({ watching: true }).sources).toEqual([]);
    });
});
