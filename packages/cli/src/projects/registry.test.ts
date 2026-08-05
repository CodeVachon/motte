import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_STATES, type Config, type Issue } from "@motte/core";
import {
    forgetMissing,
    forgetProject,
    listProjects,
    readProjects,
    registryPath,
    rememberProject,
    summarise
} from "./registry.js";

/**
 * The per-machine project registry.
 *
 * Driven through an explicit path rather than the real one, because the real one is in the home directory
 * and a test that writes there is a test that edits the machine it runs on.
 */

let registry: string;
let home: string;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "motte-registry-"));
    registry = join(home, "projects.json");
});

function project(root: string, name = "Test"): Config {
    return {
        name,
        issuesDir: ".motte/issues",
        states: [...DEFAULT_STATES, { name: "Cancelled", category: "cancelled" }],
        defaultState: "Todo",
        root,
        configPath: join(root, ".motte.config.json"),
        issuesPath: join(root, ".motte/issues"),
        events: { enabled: true }
    };
}

/** A directory that looks like a project, so `listProjects` does not call it missing. */
function realProject(name = "Test"): Config {
    const root = mkdtempSync(join(tmpdir(), "motte-project-"));
    writeFileSync(join(root, ".motte.config.json"), "{}", "utf8");
    mkdirSync(join(root, ".motte", "issues"), { recursive: true });
    return project(root, name);
}

function issue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 1,
        title: "Write the parser",
        state: "Todo",
        created: "2026-08-01T09:00:00Z",
        updated: "2026-08-01T09:00:00Z",
        description: "",
        plan: "",
        notes: [],
        unknownSections: [],
        ...overrides
    };
}

describe("registryPath", () => {
    it("sits under the install root, beside the wiring record", () => {
        expect(registryPath({ MOTTE_INSTALL_DIR: "/opt/motte" })).toBe("/opt/motte/projects.json");
    });

    it("falls back to ~/.motte", () => {
        expect(registryPath({ HOME: "/home/someone" })).toBe("/home/someone/.motte/projects.json");
    });
});

describe("summarise", () => {
    it("counts the backlog and keeps only what is in flight", () => {
        const config = project("/p");
        const summary = summarise(
            config,
            [
                issue({ id: 1, state: "Done" }),
                issue({ id: 2, state: "In Progress", assignee: "atlas" }),
                issue({ id: 3, state: "Todo" }),
                issue({ id: 4, state: "Cancelled" })
            ],
            "2026-08-05T10:00:00Z"
        );

        expect(summary).toMatchObject({
            root: "/p",
            name: "Test",
            issues: 4,
            done: 1,
            // Cancelled work leaves the denominator, the same as everywhere else in the tool.
            counted: 3,
            seen: "2026-08-05T10:00:00Z"
        });
        expect(summary.inFlight).toEqual([
            { id: 2, title: "Write the parser", state: "In Progress", assignee: "atlas" }
        ]);
    });

    it("counts what is ready, which needs the whole backlog rather than one issue", () => {
        const config = project("/p");
        const summary = summarise(config, [
            issue({ id: 1 }),
            issue({ id: 2, blockedBy: [1] }),
            issue({ id: 3, state: "Done" })
        ]);

        expect(summary.ready).toBe(1);
    });

    it("holds no issue bodies, only the summary the registry is for", () => {
        const summary = summarise(project("/p"), [issue({ description: "secret", plan: "plans" })]);

        expect(JSON.stringify(summary)).not.toContain("secret");
        expect(JSON.stringify(summary)).not.toContain("plans");
    });
});

describe("rememberProject", () => {
    it("records a project that was not there before", () => {
        expect(rememberProject(summarise(project("/a"), []), { path: registry })).toBe("written");
        expect(readProjects(registry).map((entry) => entry.root)).toEqual(["/a"]);
    });

    it("keeps one entry per project, however often a command runs there", () => {
        rememberProject(summarise(project("/a"), []), { path: registry });
        rememberProject(summarise(project("/a"), [issue()]), { path: registry });

        const stored = readProjects(registry);
        expect(stored).toHaveLength(1);
        expect(stored[0]!.issues).toBe(1);
    });

    /**
     * A read-only command should not rewrite a file in the home directory every time it runs, so a visit
     * that changed nothing and is recent is skipped.
     */
    it("skips a write when nothing changed and the entry is fresh", () => {
        const summary = summarise(project("/a"), [issue()], "2026-08-05T10:00:00Z");
        rememberProject(summary, { path: registry });

        const again = rememberProject(summary, {
            path: registry,
            now: () => Date.parse("2026-08-05T10:00:30Z")
        });

        expect(again).toBe("skipped");
    });

    it("writes when the backlog moved, however recently it was seen", () => {
        rememberProject(summarise(project("/a"), [issue()], "2026-08-05T10:00:00Z"), {
            path: registry
        });

        const result = rememberProject(
            summarise(project("/a"), [issue({ state: "Done" })], "2026-08-05T10:00:05Z"),
            { path: registry, now: () => Date.parse("2026-08-05T10:00:05Z") }
        );

        expect(result).toBe("written");
        expect(readProjects(registry)[0]!.done).toBe(1);
    });

    /** So "where did I leave off" stays true for a project somebody only reads. */
    it("refreshes the timestamp once the entry has gone stale", () => {
        const summary = summarise(project("/a"), [issue()], "2026-08-05T10:00:00Z");
        rememberProject(summary, { path: registry });

        const result = rememberProject(
            { ...summary, seen: "2026-08-05T11:00:00Z" },
            { path: registry, now: () => Date.parse("2026-08-05T11:00:00Z") }
        );

        expect(result).toBe("written");
        expect(readProjects(registry)[0]!.seen).toBe("2026-08-05T11:00:00Z");
    });
});

describe("readProjects", () => {
    it("is empty when there is no registry yet", () => {
        expect(readProjects(join(home, "nothing.json"))).toEqual([]);
    });

    /** It is a cache, not a record: starting over beats refusing to run a command. */
    it("starts over rather than throwing on a corrupt file", () => {
        writeFileSync(registry, "{not json", "utf8");

        expect(readProjects(registry)).toEqual([]);
    });
});

describe("listProjects", () => {
    it("marks a project whose config has gone, rather than dropping it", () => {
        rememberProject(summarise(project("/gone"), []), { path: registry });

        const [entry] = listProjects(registry);

        // A project on a volume that is not mounted has not stopped existing.
        expect(entry).toMatchObject({ root: "/gone", missing: true });
    });

    it("does not mark a project that is still there", () => {
        const config = realProject();
        rememberProject(summarise(config, []), { path: registry });

        expect(listProjects(registry)[0]!.missing).toBe(false);
    });

    it("puts the most recently seen first, which is where somebody left off", () => {
        rememberProject(summarise(project("/old", "Old"), [], "2026-08-01T09:00:00Z"), {
            path: registry
        });
        rememberProject(summarise(project("/new", "New"), [], "2026-08-05T09:00:00Z"), {
            path: registry
        });

        expect(listProjects(registry).map((entry) => entry.name)).toEqual(["New", "Old"]);
    });
});

describe("forgetting", () => {
    it("prunes only the projects that are gone", () => {
        const kept = realProject("Kept");
        rememberProject(summarise(kept, []), { path: registry });
        rememberProject(summarise(project("/gone", "Gone"), []), { path: registry });

        const forgotten = forgetMissing(registry);

        expect(forgotten.map((entry) => entry.name)).toEqual(["Gone"]);
        expect(readProjects(registry).map((entry) => entry.name)).toEqual(["Kept"]);
    });

    it("leaves the file alone when nothing is missing", () => {
        rememberProject(summarise(realProject(), []), { path: registry });

        expect(forgetMissing(registry)).toEqual([]);
        expect(readProjects(registry)).toHaveLength(1);
    });

    it("forgets one project by root", () => {
        rememberProject(summarise(project("/a"), []), { path: registry });

        expect(forgetProject("/a", registry)).toBe(true);
        expect(forgetProject("/a", registry)).toBe(false);
        expect(readProjects(registry)).toEqual([]);
    });
});

describe("the file itself", () => {
    it("is written atomically, leaving no temp file behind", () => {
        rememberProject(summarise(project("/a"), []), { path: registry });

        expect(existsSync(registry)).toBe(true);
        expect(existsSync(`${registry}.${process.pid}.tmp`)).toBe(false);
    });

    it("is readable JSON, since the point of not using a database is that a person can fix it", () => {
        rememberProject(summarise(project("/a", "Readable"), []), { path: registry });

        expect(readProjects(registry)[0]!.name).toBe("Readable");
    });
});
