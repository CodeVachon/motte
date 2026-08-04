import { beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    ENTRY,
    RETRY,
    SPAWN_TIMEOUT_MS,
    initialised,
    motte,
    project,
    spawnMotte
} from "./testing/cli.js";

interface IssueJson {
    id: number;
    title: string;
    state: string;
    parent: number | null;
    assignee: string | null;
    labels: string[];
    blockedBy: number[];
}

describe("init", RETRY, () => {
    it("writes a config and an issues directory", async () => {
        const root = project();
        const run = await motte(root, ["init", "--name", "Test"]);

        expect(run.code).toBe(0);
        expect(existsSync(join(root, ".motte.config.json"))).toBe(true);
        expect(existsSync(join(root, ".motte", "issues"))).toBe(true);

        const config = JSON.parse(readFileSync(join(root, ".motte.config.json"), "utf8")) as {
            name: string;
            states: { name: string }[];
        };
        expect(config.name).toBe("Test");
        expect(config.states.map((state) => state.name)).toEqual(["Todo", "In Progress", "Done"]);
    });

    it("refuses to overwrite an existing config", async () => {
        const root = await initialised();
        const run = await motte(root, ["init", "--name", "Other"]);

        expect(run.code).toBe(1);
        expect(run.stderr + run.stdout).toMatch(/already exists/);
    });

    it("overwrites with --force", async () => {
        const root = await initialised();
        expect((await motte(root, ["init", "--name", "Other", "--force"])).code).toBe(0);
    });
});

describe("the everyday sequence", RETRY, () => {
    let root: string;

    beforeEach(async () => {
        root = await initialised();
    });

    it("creates an issue and reports it as JSON", async () => {
        const issue = (
            await motte(root, ["add", "Build the parser", "-d", "First.", "--json"])
        ).json<IssueJson>();

        expect(issue).toMatchObject({
            id: 1,
            title: "Build the parser",
            state: "Todo",
            parent: null,
            assignee: null,
            labels: [],
            blockedBy: []
        });
    });

    it("creates a child, and lists the hierarchy", async () => {
        await motte(root, ["add", "Parent"]);
        const child = (await motte(root, ["add", "Child", "-p", "1", "--json"])).json<IssueJson>();

        expect(child.parent).toBe(1);

        const tree = (await motte(root, ["tree", "--json"])).json<{
            roots: { id: number; children: { id: number }[] }[];
        }>();
        expect(tree.roots).toHaveLength(1);
        expect(tree.roots[0]!.children.map((node) => node.id)).toEqual([2]);
    });

    it("moves state by prefix, case-insensitively", async () => {
        await motte(root, ["add", "A thing"]);
        const moved = (await motte(root, ["move", "1", "in prog", "--json"])).json<IssueJson>();

        expect(moved.state).toBe("In Progress");
    });

    it("resolves an issue by a fragment of its title", async () => {
        await motte(root, ["add", "Build the parser"]);
        const shown = (await motte(root, ["show", "parser", "--json"])).json<IssueJson>();

        expect(shown.id).toBe(1);
    });

    it("records a note with its author", async () => {
        await motte(root, ["add", "Noted"]);
        expect((await motte(root, ["note", "1", "A decision."])).code).toBe(0);

        const file = readdirSync(join(root, ".motte", "issues"))[0]!;
        const contents = readFileSync(join(root, ".motte", "issues", file), "utf8");

        expect(contents).toContain("— Test User (user)");
        expect(contents).toContain("A decision.");
    });

    it("assigns and unassigns", async () => {
        await motte(root, ["add", "Assign me"]);
        expect(
            (await motte(root, ["assign", "1", "atlas", "--json"])).json<IssueJson>().assignee
        ).toBe("atlas");
        expect(
            (await motte(root, ["assign", "1", "none", "--json"])).json<IssueJson>().assignee
        ).toBeNull();
    });

    it("filters list by state, label and assignee", async () => {
        await motte(root, ["add", "One", "-l", "core", "-a", "atlas"]);
        await motte(root, ["add", "Two", "-l", "cli"]);
        await motte(root, ["move", "2", "done"]);

        expect(
            (await motte(root, ["list", "--label", "core", "--json"])).json<{ count: number }>()
                .count
        ).toBe(1);
        expect(
            (await motte(root, ["list", "--assignee", "atlas", "--json"])).json<{ count: number }>()
                .count
        ).toBe(1);
        expect(
            (await motte(root, ["list", "--state", "Done", "--json"])).json<{ count: number }>()
                .count
        ).toBe(1);
        expect(
            (await motte(root, ["list", "--open", "--json"])).json<{ count: number }>().count
        ).toBe(1);
    });

    /**
     * `-l a,b` reads as two labels. Taking it literally produced one label containing a comma, which
     * the writer then emitted bare into the inline list, and the file stopped round-tripping.
     */
    it("splits comma-separated labels", async () => {
        const created = (
            await motte(root, ["add", "Multi", "-l", "cli,testing", "-l", "core", "--json"])
        ).json<IssueJson>();

        expect(created.labels).toEqual(["cli", "testing", "core"]);
        expect((await motte(root, ["doctor"])).code).toBe(0);
    });

    it("drops blank labels and collapses duplicates", async () => {
        const created = (
            await motte(root, ["add", "Messy", "-l", "core, ,core", "--json"])
        ).json<IssueJson>();

        expect(created.labels).toEqual(["core"]);
    });

    it("edits fields without touching the others", async () => {
        await motte(root, ["add", "Original", "-d", "Keep me."]);
        const edited = (await motte(root, ["edit", "1", "--plan", "1. Do it", "--json"])).json<
            IssueJson & { description: string; plan: string }
        >();

        expect(edited.plan).toBe("1. Do it");
        expect(edited.description).toBe("Keep me.");
        expect(edited.title).toBe("Original");
    });
});

describe("dependencies", RETRY, () => {
    let root: string;

    beforeEach(async () => {
        root = await initialised();
        await motte(root, ["add", "First"]);
        await motte(root, ["add", "Second"]);
        await motte(root, ["block", "2", "1"]);
    });

    it("records the blocker", async () => {
        expect((await motte(root, ["show", "2", "--json"])).json<IssueJson>().blockedBy).toEqual([
            1
        ]);
    });

    it("reports only unblocked work as ready", async () => {
        const ready = (await motte(root, ["ready", "--json"])).json<{ issues: { id: number }[] }>();
        expect(ready.issues.map((issue) => issue.id)).toEqual([1]);
    });

    it("releases the dependent once the blocker is done", async () => {
        await motte(root, ["move", "1", "done"]);
        const ready = (await motte(root, ["ready", "--json"])).json<{ issues: { id: number }[] }>();

        expect(ready.issues.map((issue) => issue.id)).toEqual([2]);
    });

    it("lists what is blocked, and on what", async () => {
        const blocked = (await motte(root, ["ready", "--blocked", "--json"])).json<{
            issues: { id: number; openBlockers: { id: number }[] }[];
        }>();

        expect(blocked.issues).toHaveLength(1);
        expect(blocked.issues[0]!.openBlockers.map((b) => b.id)).toEqual([1]);
    });

    it("unblocks", async () => {
        expect(
            (await motte(root, ["unblock", "2", "1", "--json"])).json<IssueJson>().blockedBy
        ).toEqual([]);
    });
});

describe("reporting", RETRY, () => {
    it("reports progress and readiness counts", async () => {
        const root = await initialised();
        await motte(root, ["add", "Done thing"]);
        await motte(root, ["add", "Open thing"]);
        await motte(root, ["move", "1", "done"]);

        const status = (await motte(root, ["status", "--json"])).json<{
            total: number;
            completed: number;
            percentComplete: number;
            ready: unknown[];
        }>();

        expect(status.total).toBe(2);
        expect(status.completed).toBe(1);
        expect(status.percentComplete).toBe(50);
        expect(status.ready).toHaveLength(1);
    });

    it("logs the transitions it recorded", async () => {
        const root = await initialised();
        await motte(root, ["add", "Tracked"]);
        await motte(root, ["move", "1", "done"]);

        const log = (await motte(root, ["log", "--json"])).json<{
            entries: { id: number; summary: string }[];
        }>();

        expect(log.entries.length).toBeGreaterThanOrEqual(2);
        expect(log.entries.some((entry) => entry.summary.includes("Todo → Done"))).toBe(true);
    });

    it("passes doctor on a clean backlog and fails on a broken one", async () => {
        const root = await initialised();
        await motte(root, ["add", "Fine", "-d", "Has a description."]);

        expect((await motte(root, ["doctor", "--json"])).json<{ ok: boolean }>().ok).toBe(true);
        expect((await motte(root, ["doctor"])).code).toBe(0);

        // A duplicate id is the error doctor caught in CI once before.
        const first = readdirSync(join(root, ".motte", "issues"))[0]!;
        writeFileSync(
            join(root, ".motte", "issues", "0001-a-copy.md"),
            readFileSync(join(root, ".motte", "issues", first), "utf8"),
            "utf8"
        );

        const broken = await motte(root, ["doctor"]);
        expect(broken.code).toBe(1);
        expect(broken.stdout + broken.stderr).toMatch(/#1 is used by 2 files/);
    });

    /**
     * Round-trip integrity, reported against the real backlog rather than only in a unit test.
     *
     * A file that parses but does not re-serialise identically is silently corrupt: the next unrelated
     * write reformats it. This escaped to CI once — a label containing a comma — because `doctor` was
     * happy and only the round-trip test over this project's own issues noticed.
     */
    it("reports a file that does not survive a round trip", async () => {
        const root = await initialised();
        await motte(root, ["add", "Has a label", "-l", "core"]);

        const file = join(
            root,
            ".motte",
            "issues",
            readdirSync(join(root, ".motte", "issues"))[0]!
        );

        // A comma inside an unquoted inline-list item: parses as two labels, re-serialises as one
        // quoted item, so the bytes differ.
        writeFileSync(
            file,
            readFileSync(file, "utf8").replace("labels: [core]", "labels: [core,cli]"),
            "utf8"
        );

        const run = await motte(root, ["doctor"]);
        expect(run.code).toBe(1);
        expect(run.stdout + run.stderr).toMatch(/does not survive a parse\/format round trip/);
    });
});

/** The paths most likely to regress, and the ones a user actually hits by mistake. */
describe("failure paths", RETRY, () => {
    let root: string;

    beforeEach(async () => {
        root = await initialised();
    });

    it("reports an unknown reference and exits 1", async () => {
        const run = await motte(root, ["show", "9999"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/no issue matching "9999"/);
    });

    it("reports an ambiguous reference with the candidates", async () => {
        await motte(root, ["add", "Design the schema"]);
        await motte(root, ["add", "Implement the schema"]);

        const run = await motte(root, ["show", "schema"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/#1/);
        expect(run.stderr).toMatch(/#2/);
    });

    it("reports an unknown state, listing the configured ones", async () => {
        await motte(root, ["add", "A thing"]);
        const run = await motte(root, ["move", "1", "Shipped"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/not a known state/);
        expect(run.stderr).toMatch(/Todo/);
    });

    it("rejects a parent cycle", async () => {
        await motte(root, ["add", "Root"]);
        await motte(root, ["add", "Child", "-p", "1"]);

        const run = await motte(root, ["edit", "1", "--parent", "2"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/cycle/);
    });

    it("rejects a dependency cycle", async () => {
        await motte(root, ["add", "First"]);
        await motte(root, ["add", "Second"]);
        await motte(root, ["block", "2", "1"]);

        const run = await motte(root, ["block", "1", "2"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/dependency cycle/);
    });

    it("explains itself outside a project rather than crashing", async () => {
        const bare = mkdtempSync(join(tmpdir(), "motte-bare-"));
        const run = await motte(bare, ["list"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/motte init/);
    });

    it("rejects an unknown flag rather than ignoring it", async () => {
        // yargs strict mode: a typo should fail loudly, not silently do the wrong thing.
        const run = await motte(root, ["list", "--nonsense"]);
        expect(run.code).toBe(1);
    });
});

/**
 * Wiring, which is what has actually broken. Each of these corresponds to a real bug found during
 * development, so they are regression tests rather than speculation.
 */
/**
 * What bare `motte` does. It used to print `✗ null` and exit 1: `demandCommand` was given an empty message,
 * and yargs passes null to `.fail` when the message is empty.
 */
describe("the bare command", () => {
    it("shows the status report inside a project", async () => {
        const root = await initialised();
        await motte(root, ["add", "Something", "-d", "x"]);

        const run = await motte(root, []);

        expect(run.code).toBe(0);
        expect(run.stdout).toContain("Test");
        expect(run.stdout).toMatch(/1 issue|Todo/);
    });

    it("points at what to do next", async () => {
        const run = await motte(await initialised(), []);

        expect(run.stdout).toContain("motte ready");
        expect(run.stdout).toContain("motte --help");
    });

    it("never prints a bare null", async () => {
        const run = await motte(await initialised(), []);

        expect(run.stdout + run.stderr).not.toMatch(/\bnull\b/);
    });

    it("shows the help and suggests init when there is no project", async () => {
        const run = await motte(project(), []);

        expect(run.stdout).toContain("motte <command> [options]");
        expect(run.stdout).toContain("motte init");
    });

    /**
     * A flag with no command is not the bare command, so it still has to say which command is missing —
     * and say it in words rather than as a null.
     */
    it("asks which command when given only a flag", async () => {
        const run = await motte(await initialised(), ["--json"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/Which command/);
        expect(run.stderr).not.toMatch(/\bnull\b/);
    });

    /**
     * Handled before yargs rather than as a `$0` command: registering one turns every unrecognised first
     * word into an "unknown argument", which silently disables recommendCommands.
     */
    it("still suggests a near-miss command", async () => {
        const run = await motte(await initialised(), ["stauts"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/Did you mean status\?/);
    });
});

describe("wiring", RETRY, () => {
    it("reports the version from package.json", async () => {
        const pkg = JSON.parse(
            readFileSync(join(import.meta.dirname, "..", "..", "..", "package.json"), "utf8")
        ) as { version: string };

        expect(spawnMotte(project(), ["--version"]).stdout.trim()).toBe(pkg.version);
    });

    it("accepts a version positional on upgrade without the --version flag stealing it", async () => {
        // Regression: the positional was named `version`, so yargs' own --version flag won and the
        // positional arrived as boolean `true`.
        const run = spawnMotte(project(), ["upgrade", "0.0.1", "--check"]);

        // Not a managed install here, so it refuses — but it must refuse for that reason, not by
        // throwing on a boolean.
        expect(run.stderr).toMatch(/managed installation/);
        expect(run.stderr).not.toMatch(/trim is not a function/);
    });

    it("rejects a bare number for --since, suggesting the unit", async () => {
        // Regression: Date.parse("7") succeeds, so this was silently accepted as an arbitrary date.
        const root = await initialised();
        const run = spawnMotte(root, ["log", "--since", "7"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/no unit/);
    });

    it("exits quietly when the reader closes the pipe", async () => {
        // Regression: `motte status | head` died with an unhandled EPIPE and a stack trace.
        // Five issues is enough output for `head -2` to close the pipe early; forty just cost forty
        // process spawns and blew the timeout.
        const root = await initialised();
        for (let i = 0; i < 5; i += 1) spawnMotte(root, ["add", `Issue ${i}`]);

        const piped = spawnSync("sh", ["-c", `bun ${ENTRY} list | head -2`], {
            cwd: root,
            encoding: "utf8",
            timeout: SPAWN_TIMEOUT_MS,
            killSignal: "SIGKILL",
            env: { ...process.env, MOTTE_AUTHOR: "Test User", NO_COLOR: "1" }
        });

        // The point of the regression is that it exits, so assert that before inspecting the output.
        expect(piped.signal).not.toBe("SIGKILL");
        expect(piped.stderr ?? "").not.toMatch(/EPIPE|Unhandled|error:/);
    });

    it("prints an MCP config snippet without needing a project", async () => {
        const run = spawnMotte(project(), ["mcp", "--print-config"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toMatch(/mcpServers/);
        expect(run.stdout).toMatch(/motte/);
    });

    it("registers every command in help", async () => {
        const help = spawnMotte(project(), ["--help"]).stdout;

        for (const command of [
            "init",
            "add",
            "list",
            "show",
            "edit",
            "move",
            "assign",
            "note",
            "block",
            "unblock",
            "ready",
            "status",
            "tree",
            "log",
            "prune",
            "restore",
            "serve",
            "doctor",
            "mcp",
            "install",
            "upgrade",
            "uninstall",
            "completion"
        ]) {
            expect(help).toContain(`motte ${command}`);
        }
    });
});
