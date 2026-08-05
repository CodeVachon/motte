import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialised, motte, project } from "../testing/cli.js";

/**
 * The cross-project commands, driven through the CLI.
 *
 * Two real projects sharing one registry, which is the only arrangement that exercises what these commands
 * are for. The harness gives each project its own sandbox home, so the registry is pointed at a shared
 * directory explicitly — otherwise every project would keep its own and there would be nothing to cross.
 */

let shared: string;

beforeEach(() => {
    shared = mkdtempSync(join(tmpdir(), "motte-shared-"));
});

/** Run a command with the shared registry rather than the per-project sandbox one. */
function inShared(root: string, args: string[]) {
    return motte(root, args, { MOTTE_INSTALL_DIR: shared });
}

/** Two projects, each with a little work, both registered in the shared registry. */
async function twoProjects(): Promise<{ first: string; second: string }> {
    const first = project();
    await inShared(first, ["init", "--name", "Parser", "--no-agents"]);
    await inShared(first, ["add", "Write the parser"]);
    await inShared(first, ["add", "Ship it"]);
    await inShared(first, ["move", "1", "in progress"]);
    await inShared(first, ["assign", "1", "atlas"]);

    const second = project();
    await inShared(second, ["init", "--name", "Website", "--no-agents"]);
    await inShared(second, ["add", "Landing page"]);
    await inShared(second, ["move", "1", "done"]);

    return { first, second };
}

describe("registering a project", () => {
    it("remembers a project as soon as a command runs in it", async () => {
        const root = project();
        await inShared(root, ["init", "--name", "Remembered", "--no-agents"]);

        const listed = (await inShared(root, ["projects", "--json"])).json<{
            projects: { name: string; root: string }[];
        }>();

        expect(listed.projects.map((entry) => entry.name)).toEqual(["Remembered"]);
    });

    /** Anyone who would rather motte kept no record outside the repository can say so. */
    it("records nothing when MOTTE_NO_INDEX is set", async () => {
        const root = project();
        await motte(root, ["init", "--name", "Quiet", "--no-agents"], {
            MOTTE_INSTALL_DIR: shared,
            MOTTE_NO_INDEX: "1"
        });
        await motte(root, ["add", "Something"], {
            MOTTE_INSTALL_DIR: shared,
            MOTTE_NO_INDEX: "1"
        });

        const listed = (await inShared(root, ["projects", "--json"])).json<{ count: number }>();

        // The `projects` call itself does not run inside the project, so nothing registers it either.
        expect(listed.count).toBe(0);
    });

    it("keeps the summary current as work moves", async () => {
        const root = await initialised();
        await inShared(root, ["add", "First"]);
        await inShared(root, ["move", "1", "in progress"]);

        const listed = (await inShared(root, ["projects", "--json"])).json<{
            projects: { inFlight: { id: number; assignee: string | null }[] }[];
        }>();

        expect(listed.projects[0]!.inFlight.map((issue) => issue.id)).toEqual([1]);
    });
});

describe("motte projects", () => {
    it("lists every project with its progress", async () => {
        const { first } = await twoProjects();

        const run = await inShared(first, ["projects"]);

        expect(run.stdout).toContain("Parser");
        expect(run.stdout).toContain("Website");
        expect(run.stdout).toContain("2 projects");
    });

    it("shows what is in flight, and who has it", async () => {
        const { first } = await twoProjects();

        const run = await inShared(first, ["projects"]);

        expect(run.stdout).toContain("Write the parser");
        expect(run.stdout).toContain("atlas");
    });

    it("says so when it knows of no projects at all", async () => {
        const run = await inShared(project(), ["projects"]);

        expect(run.stdout).toContain("no projects registered");
    });

    describe("a project that has gone", () => {
        it("is reported rather than dropped, since it may only be unmounted", async () => {
            const { first, second } = await twoProjects();
            // Losing the config is how a moved or deleted project looks from the registry's side.
            rmSync(join(second, ".motte.config.json"));

            const run = await inShared(first, ["projects"]);

            expect(run.stdout).toContain("missing");
            expect(run.stdout).toContain("--prune");
        });

        it("is forgotten on request, and only it", async () => {
            const { first, second } = await twoProjects();
            rmSync(join(second, ".motte.config.json"));

            const pruned = (await inShared(first, ["projects", "--prune", "--json"])).json<{
                forgotten: string[];
            }>();
            expect(pruned.forgotten).toHaveLength(1);

            const after = (await inShared(first, ["projects", "--json"])).json<{
                projects: { name: string }[];
            }>();
            expect(after.projects.map((entry) => entry.name)).toEqual(["Parser"]);
        });
    });
});

describe("status --all", () => {
    it("adds up progress across projects rather than averaging them", async () => {
        const { first } = await twoProjects();

        const report = (await inShared(first, ["status", "--all", "--json"])).json<{
            total: { projects: number; counted: number; done: number; percent: number };
        }>();

        // Three issues in total, one of them done.
        expect(report.total).toMatchObject({ projects: 2, counted: 3, done: 1, percent: 33 });
    });

    it("names what is in flight in each project", async () => {
        const { first } = await twoProjects();

        const run = await inShared(first, ["status", "--all"]);

        expect(run.stdout).toContain("All projects");
        expect(run.stdout).toContain("Parser");
        expect(run.stdout).toContain("Write the parser");
    });

    /** The whole point: a question that can be asked from anywhere, including outside a project. */
    it("works from a directory that is not a project", async () => {
        await twoProjects();

        const run = await inShared(project(), ["status", "--all"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toContain("All projects");
    });
});

describe("list --all", () => {
    it("answers what is assigned to somebody everywhere", async () => {
        const { first, second } = await twoProjects();
        await inShared(second, ["add", "Also atlas"]);
        await inShared(second, ["assign", "2", "atlas"]);

        const found = (
            await inShared(first, ["list", "--all", "--assignee", "atlas", "--json"])
        ).json<{ count: number; projects: { name: string; issues: { title: string }[] }[] }>();

        expect(found.count).toBe(2);
        // Sorted, because the grouping follows which project was seen most recently — the same order
        // `motte projects` uses — and that is not what this test is about.
        expect(
            found.projects.flatMap((entry) => entry.issues.map((issue) => issue.title)).sort()
        ).toEqual(["Also atlas", "Write the parser"]);
    });

    it("groups by project, since ids only mean something inside one", async () => {
        const { first, second } = await twoProjects();
        // Website's only issue is Done, so it needs open work of its own to appear under `--open` at all.
        await inShared(second, ["add", "Still to do"]);

        const run = await inShared(first, ["list", "--all", "--open"]);

        expect(run.stdout).toContain("Parser");
        expect(run.stdout).toContain("Website");
        expect(run.stdout).toMatch(/in 2 projects/);
    });

    it("filters by state across every project", async () => {
        const { first } = await twoProjects();

        const found = (await inShared(first, ["list", "--all", "--state", "done", "--json"])).json<{
            count: number;
        }>();

        expect(found.count).toBe(1);
    });

    it("says so when nothing matches anywhere", async () => {
        const { first } = await twoProjects();

        const run = await inShared(first, ["list", "--all", "--assignee", "nobody"]);

        expect(run.stdout).toContain("no issues match in any project");
    });

    it("works from a directory that is not a project", async () => {
        await twoProjects();

        const run = await inShared(project(), ["list", "--all", "--open"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toContain("Parser");
    });
});
