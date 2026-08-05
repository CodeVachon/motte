import { beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    ENTRY,
    RETRY,
    SPAWN_TIMEOUT_MS,
    committedProject,
    commitAll,
    initialised,
    motte,
    pretendClaudeCodeInstalled,
    project,
    sandboxEnv,
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

    /**
     * Wiring belongs to init, not to a hint about a second command.
     *
     * #0020 always said init would offer this, and until it did, a new project needed two commands and
     * nobody learned the second one until they read the output of the first.
     */
    describe("the agent wiring", () => {
        it("writes .mcp.json for a detected agent", async () => {
            const root = project();
            pretendClaudeCodeInstalled(root);

            const run = await motte(root, ["init", "--name", "Test"]);

            expect(run.code).toBe(0);
            const wiring = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")) as {
                mcpServers: Record<string, { command: string; args: string[] }>;
            };
            expect(wiring.mcpServers.motte).toEqual({ command: "motte", args: ["mcp"] });
        });

        /** The instructions go in whether or not an agent is configured here: a clone may have one. */
        it("writes the motte section of AGENTS.md", async () => {
            const root = project();
            const run = await motte(root, ["init", "--name", "Test"]);

            const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
            expect(run.stdout).toMatch(/AGENTS\.md/);
            expect(agents).toContain("motte ready");
            expect(agents).toContain("<!-- motte:start -->");
        });

        it("appends to an AGENTS.md that is already there, keeping every word of it", async () => {
            const root = project();
            writeFileSync(join(root, "AGENTS.md"), "# Ours\n\nRun the linter.\n", "utf8");

            await motte(root, ["init", "--name", "Test"]);

            const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
            expect(agents).toContain("Run the linter.");
            expect(agents.indexOf("# Ours")).toBeLessThan(agents.indexOf("<!-- motte:start -->"));
        });

        it("leaves one block behind, however many times it runs", async () => {
            const root = project();
            await motte(root, ["init", "--name", "Test"]);
            await motte(root, ["init", "--name", "Test", "--force"]);
            await motte(root, ["install"]);

            const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
            expect(agents.split("<!-- motte:start -->")).toHaveLength(2);
        });

        it("writes neither with --no-agents", async () => {
            const root = project();
            pretendClaudeCodeInstalled(root);

            const run = await motte(root, ["init", "--name", "Test", "--no-agents"]);

            expect(run.code).toBe(0);
            expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
            expect(existsSync(join(root, ".mcp.json"))).toBe(false);
            // The project itself is still there — --no-agents is about the wiring only.
            expect(existsSync(join(root, ".motte.config.json"))).toBe(true);
        });

        /**
         * `init <dir>` scaffolds somewhere other than the working directory, and the wiring used to find
         * its project by walking up from the working directory — so it would have wired up whichever
         * project the shell was sitting in.
         */
        it("wires the directory it was given, not the one it was run from", async () => {
            // The outer project is created without wiring, so an AGENTS.md appearing there afterwards can
            // only have come from the nested init.
            const outer = project();
            expect((await motte(outer, ["init", "--name", "Outer", "--no-agents"])).code).toBe(0);

            const inner = join(outer, "nested");
            mkdirSync(inner, { recursive: true });

            await motte(outer, ["init", inner, "--name", "Nested"]);

            expect(existsSync(join(inner, "AGENTS.md"))).toBe(true);
            expect(existsSync(join(outer, "AGENTS.md"))).toBe(false);
        });

        it("still creates the project when the wiring cannot be written", async () => {
            const root = project();
            // A start marker with no end means someone edited them by hand; rewriting from there would
            // eat whatever followed, so the file is left alone and the command says so.
            writeFileSync(
                join(root, "AGENTS.md"),
                "# Ours\n\n<!-- motte:start -->\nhalf\n",
                "utf8"
            );

            const run = await motte(root, ["init", "--name", "Test"]);

            expect(run.code).toBe(0);
            expect(existsSync(join(root, ".motte.config.json"))).toBe(true);
            expect(run.stderr).toMatch(/end marker/);
            expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("half");
        });
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

        // A shell pipeline, so it cannot go through `spawnMotte` — but it still needs that helper's
        // sandbox. Without it this one test wrote a project into the home directory of whoever ran the
        // suite, which is how the registry from #0045 came to know about temp directories.
        const piped = spawnSync("sh", ["-c", `bun ${ENTRY} list | head -2`], {
            cwd: root,
            encoding: "utf8",
            timeout: SPAWN_TIMEOUT_MS,
            killSignal: "SIGKILL",
            env: {
                ...process.env,
                ...sandboxEnv(root),
                MOTTE_AUTHOR: "Test User",
                NO_COLOR: "1"
            }
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
            "next",
            "find",
            "import",
            "claim",
            "current",
            "release",
            "status",
            "tree",
            "log",
            "merge",
            "prune",
            "restore",
            "serve",
            "watch",
            "doctor",
            "projects",
            "renumber",
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

/**
 * `motte renumber`.
 *
 * The repair half of deriving ids from a directory scan. The ReadMe had promised this command since 0.1.0
 * while `motte renumber` answered "Unknown argument", so `doctor` could report a duplicate id that nothing
 * could clear.
 */
describe("renumber", RETRY, () => {
    /** Two files claiming #7 and a child pointing at it, the way merging two branches leaves things. */
    async function collided(): Promise<string> {
        const root = await initialised();
        const dir = join(root, ".motte", "issues");

        writeFileSync(
            join(dir, "0007-filed-first.md"),
            "---\nid: 7\ntitle: Filed first\nstate: Todo\ncreated: 2026-08-01T09:00:00Z\n" +
                "updated: 2026-08-01T09:00:00Z\n---\n\n## Description\n\nBranch A.\n",
            "utf8"
        );
        writeFileSync(
            join(dir, "0007-filed-second.md"),
            "---\nid: 7\ntitle: Filed second\nstate: Todo\ncreated: 2026-08-02T09:00:00Z\n" +
                "updated: 2026-08-02T09:00:00Z\n---\n\n## Description\n\nBranch B.\n",
            "utf8"
        );
        writeFileSync(
            join(dir, "0009-a-child.md"),
            "---\nid: 9\ntitle: A child\nstate: Todo\nparent: 7\ncreated: 2026-08-03T09:00:00Z\n" +
                "updated: 2026-08-03T09:00:00Z\n---\n\n## Description\n\nWhose child?\n",
            "utf8"
        );

        return root;
    }

    it("clears the duplicate that doctor reports", async () => {
        const root = await collided();
        expect((await motte(root, ["doctor"])).code).toBe(1);

        const run = await motte(root, ["renumber"]);

        expect(run.code).toBe(0);
        // The whole point: the error doctor could not clear is cleared.
        expect((await motte(root, ["doctor"])).code).toBe(0);
    });

    it("leaves the earlier issue's number alone and renames the later file", async () => {
        const root = await collided();

        await motte(root, ["renumber"]);

        const files = readdirSync(join(root, ".motte", "issues")).sort();
        expect(files).toContain("0007-filed-first.md");
        expect(files).toContain("0010-filed-second.md");
        expect(files).not.toContain("0007-filed-second.md");
    });

    it("says which references it could not settle", async () => {
        const root = await collided();

        const run = await motte(root, ["renumber"]);

        // #0009 said `parent: 7` and nothing on disk records which of the two it meant.
        expect(run.stdout + run.stderr).toMatch(/#0009/);
        expect(run.stdout + run.stderr).toMatch(/parent/);
    });

    it("changes nothing with --dry-run", async () => {
        const root = await collided();
        const before = readdirSync(join(root, ".motte", "issues")).sort();

        const run = await motte(root, ["renumber", "--dry-run"]);

        expect(run.stdout).toMatch(/would renumber/);
        expect(readdirSync(join(root, ".motte", "issues")).sort()).toEqual(before);
        expect((await motte(root, ["doctor"])).code).toBe(1);
    });

    it("reports the reassignments as JSON", async () => {
        const root = await collided();

        const run = await motte(root, ["renumber", "--json"]);
        const body = run.json<{
            renumbered: { from: number; to: number; file: string }[];
            ambiguousReferences: { id: number; via: string }[];
        }>();

        expect(body.renumbered).toHaveLength(1);
        expect(body.renumbered[0]!.from).toBe(7);
        expect(body.renumbered[0]!.to).toBe(10);
        expect(body.ambiguousReferences).toEqual([{ id: 9, via: "parent" }]);
    });

    it("says so when there is nothing to repair", async () => {
        const root = await initialised();
        await motte(root, ["add", "Only issue"]);

        const run = await motte(root, ["renumber"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toMatch(/no duplicate ids/);
    });
});

/**
 * `motte completion <shell>`.
 *
 * bash and zsh come from yargs, which picks between them by reading SHELL; fish and PowerShell are motte's
 * own templates. Naming the shell is the only way to ask for the latter two, and it also means an installer
 * can generate the right script without depending on what SHELL happens to say.
 */
describe("completion", RETRY, () => {
    it("prints the fish script", async () => {
        const run = await motte(project(), ["completion", "fish"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toContain("complete -c motte");
        expect(run.stdout).toContain("MOTTE_COMPLETION_SHELL=fish");
    });

    it("prints the PowerShell script", async () => {
        const run = await motte(project(), ["completion", "powershell"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toContain("Register-ArgumentCompleter");
    });

    /** The point of naming them: the answer must not depend on the shell that happens to be running. */
    it("gives bash the bash script and zsh the zsh one, whatever SHELL says", async () => {
        const root = project();

        const asBash = await motte(root, ["completion", "bash"], { SHELL: "/bin/zsh" });
        const asZsh = await motte(root, ["completion", "zsh"], { SHELL: "/bin/bash" });

        expect(asBash.stdout).not.toContain("#compdef");
        expect(asZsh.stdout).toContain("#compdef motte");
        expect(asBash.stdout).toContain("###-begin-motte-completions-###");
    });

    it("puts SHELL back, since steering yargs meant changing it", async () => {
        const root = project();
        const before = process.env.SHELL;

        await motte(root, ["completion", "bash"], { SHELL: "/bin/zsh" });

        expect(process.env.SHELL).toBe(before);
    });

    it("refuses a shell it has no template for, naming the ones it has", async () => {
        const run = await motte(project(), ["completion", "nushell"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/unknown shell/);
        expect(run.stderr).toMatch(/bash, zsh, fish, powershell/);
    });

    /**
     * Spawned, because yargs' own completion command calls `process.exit(0)` when it has printed. The
     * in-process runner turns that into a thrown signal, which `main` then reports as a failure — so this
     * is one of the few things that needs a real exit status to observe.
     */
    it("still prints a script with no shell named, which is what yargs registered", () => {
        const run = spawnMotte(project(), ["completion"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toContain("###-begin-motte-completions-###");
    });

    /**
     * The candidate format has to follow the shell that asked, not the one motte is running under. fish
     * splits on a tab; a colon-joined pair arrives as one literal word.
     */
    describe("the candidate format", () => {
        /**
         * Spawned, and it has to be: the completion hook reads the raw `process.argv` rather than yargs'
         * parsed argv, because a parsed argv has already swallowed the flag being completed. In-process
         * there is no such argv to read, so the request would fall through to yargs' flag completion.
         */
        function candidates(root: string, words: string[], env: Record<string, string>): string {
            return spawnMotte(root, ["--get-yargs-completions", "motte", ...words], env).stdout;
        }

        it("uses tabs for fish and colons for zsh", async () => {
            const root = await initialised();
            await motte(root, ["add", "Parser rewrite"]);

            const asFish = candidates(root, ["show", ""], { MOTTE_COMPLETION_SHELL: "fish" });
            const asZsh = candidates(root, ["show", ""], { SHELL: "/bin/zsh" });

            // Same candidate, different separator: fish reads a tab, zsh reads a colon.
            expect(asFish).toMatch(/^1\tParser rewrite/m);
            expect(asZsh).toMatch(/^1:Parser rewrite/m);
            expect(asFish).not.toMatch(/^1:/m);
        });

        /**
         * yargs formats its own command names as `name:description` for zsh. fish would insert that whole
         * string, so a request declaring fish must not get it — `motte ren<TAB>` gave
         * `renumber:Give a fresh id…` until this was handled.
         */
        it("does not hand fish a colon-joined command name", async () => {
            const root = await initialised();

            const replies = candidates(root, ["ren"], {
                MOTTE_COMPLETION_SHELL: "fish",
                SHELL: "/bin/zsh"
            });

            expect(replies).toContain("renumber");
            expect(replies).not.toContain("renumber:");
        });
    });
});

/**
 * `motte next` and `motte claim`.
 *
 * Together they are the loop the tool exists for: ask what to do, take it, and be refused if somebody else
 * already has it. Driven through the CLI because the interesting part is what two callers with different
 * identities see.
 */
describe("choosing and taking work", RETRY, () => {
    async function backlog(): Promise<string> {
        const root = await initialised();
        await motte(root, ["add", "Gate everything"]);
        await motte(root, ["add", "Behind the gate"]);
        await motte(root, ["add", "Also behind it"]);
        await motte(root, ["add", "Unrelated"]);
        await motte(root, ["block", "2", "1"]);
        await motte(root, ["block", "3", "1"]);

        return root;
    }

    describe("next", () => {
        it("picks the issue that unblocks the most, not the lowest id", async () => {
            const root = await backlog();

            const chosen = (await motte(root, ["next", "--json"])).json<{
                issues: { id: number; why: string[] }[];
            }>();

            expect(chosen.issues[0]!.id).toBe(1);
            expect(chosen.issues[0]!.why).toContain("unblocks 2 issues");
        });

        it("explains itself when asked", async () => {
            const root = await backlog();

            const run = await motte(root, ["next", "--why"]);

            expect(run.stdout).toContain("#0001");
            expect(run.stdout).toContain("unblocks 2 issues");
        });

        it("shows one by default and says how many others are ready", async () => {
            // Two candidates: #0001 and #0004. #0002 and #0003 are blocked behind #0001.
            const root = await backlog();

            const one = await motte(root, ["next"]);
            expect(one.stdout).toContain("#0001");
            expect(one.stdout).toMatch(/1 more ready/);

            const both = await motte(root, ["next", "--limit", "2"]);
            expect(both.stdout).toContain("#0004");
            expect(both.stdout).not.toMatch(/more ready/);
        });

        it("leaves out work another agent holds", async () => {
            const root = await backlog();
            await motte(root, ["claim", "1"], { MOTTE_AGENT: "atlas" });

            const chosen = (await motte(root, ["next", "--json"], { MOTTE_AGENT: "nova" })).json<{
                issues: { id: number }[];
            }>();

            // #0001 is atlas's now, and #0002 and #0003 are still blocked by it.
            expect(chosen.issues[0]!.id).toBe(4);
        });

        it("reminds an agent of the work it already started", async () => {
            const root = await backlog();
            await motte(root, ["claim", "4"], { MOTTE_AGENT: "atlas" });

            const chosen = (await motte(root, ["next", "--json"], { MOTTE_AGENT: "atlas" })).json<{
                issues: { id: number; why: string[] }[];
            }>();

            expect(chosen.issues[0]!.id).toBe(4);
            expect(chosen.issues[0]!.why).toContain("already yours, and started");
        });

        /**
         * Everything settled, rather than a cycle: `motte block` rejects a cycle at write time, so a
         * backlog where every issue blocks another cannot be built through the CLI at all.
         */
        it("says so when nothing is ready, and points at what is waiting", async () => {
            const root = await initialised();
            await motte(root, ["add", "First"]);
            await motte(root, ["move", "1", "done"]);

            const run = await motte(root, ["next"]);

            expect(run.stdout).toMatch(/nothing is ready/);
            expect(run.stdout).toContain("--blocked");
        });
    });

    describe("claim", () => {
        it("assigns and starts in one step", async () => {
            const root = await backlog();

            const claimed = (
                await motte(root, ["claim", "1", "--json"], { MOTTE_AGENT: "atlas" })
            ).json<IssueJson>();

            expect(claimed).toMatchObject({ assignee: "atlas", state: "In Progress" });
        });

        /** The refusal is the feature: without it both agents write and the second one wins silently. */
        it("refuses a second agent, and exits non-zero so a script notices", async () => {
            const root = await backlog();
            await motte(root, ["claim", "1"], { MOTTE_AGENT: "atlas" });

            const run = await motte(root, ["claim", "1"], { MOTTE_AGENT: "nova" });

            expect(run.code).toBe(1);
            expect(run.stderr).toMatch(/already claimed by atlas/);
        });

        it("takes it anyway with --force", async () => {
            const root = await backlog();
            await motte(root, ["claim", "1"], { MOTTE_AGENT: "atlas" });

            const run = await motte(root, ["claim", "1", "--force"], { MOTTE_AGENT: "nova" });

            expect(run.code).toBe(0);
        });

        it("refuses settled work", async () => {
            const root = await backlog();
            await motte(root, ["move", "4", "done"]);

            expect((await motte(root, ["claim", "4"], { MOTTE_AGENT: "atlas" })).code).toBe(1);
        });

        it("takes a title fragment, like every other command", async () => {
            const root = await backlog();

            const run = await motte(root, ["claim", "unrelated"], { MOTTE_AGENT: "atlas" });

            expect(run.code).toBe(0);
            expect(run.stdout).toContain("#0004");
        });
    });

    describe("release", () => {
        it("puts the work back for somebody else", async () => {
            const root = await backlog();
            await motte(root, ["claim", "1"], { MOTTE_AGENT: "atlas" });

            const freed = (
                await motte(root, ["release", "1", "--json"], { MOTTE_AGENT: "atlas" })
            ).json<IssueJson>();

            expect(freed).toMatchObject({ assignee: null, state: "Todo" });
            expect((await motte(root, ["claim", "1"], { MOTTE_AGENT: "nova" })).code).toBe(0);
        });

        it("refuses to release what somebody else holds", async () => {
            const root = await backlog();
            await motte(root, ["claim", "1"], { MOTTE_AGENT: "atlas" });

            expect((await motte(root, ["release", "1"], { MOTTE_AGENT: "nova" })).code).toBe(1);
        });
    });
});

/**
 * `motte find`.
 *
 * The bodies were reachable only with grep, which is a strange gap in a tool whose argument is that the
 * notes are the valuable part.
 */
describe("find", RETRY, () => {
    async function backlog(): Promise<string> {
        const root = await initialised();
        await motte(root, [
            "add",
            "Serve the API",
            "-d",
            "Checks the Host header.\nRejects a foreign host."
        ]);
        await motte(root, ["add", "Unrelated work", "-d", "Nothing to see.", "-l", "core"]);
        await motte(root, ["note", "1", "Chose frontmatter over JSON for diff quality."]);

        return root;
    }

    it("finds a phrase in a description and says where", async () => {
        const root = await backlog();

        const run = await motte(root, ["find", "host header"]);

        expect(run.stdout).toContain("#0001");
        expect(run.stdout).toContain("description:1");
        expect(run.stdout).toContain("1 issue, 1 match");
    });

    /** The notes are the half with the reasoning in them, and the reason this command exists. */
    it("finds a phrase in a note, and says whose note it was", async () => {
        const root = await backlog();

        const run = await motte(root, ["find", "diff quality"]);

        expect(run.stdout).toMatch(/note \d{4}-\d{2}-\d{2}/);
        expect(run.stdout).toContain("Test User");
    });

    it("reports every hit as JSON, with where each one was", async () => {
        const root = await backlog();

        const found = (await motte(root, ["find", "host", "--json"])).json<{
            query: string;
            count: number;
            issues: { id: number; hits: { field: string; line: string }[]; totalHits: number }[];
        }>();

        expect(found.query).toBe("host");
        expect(found.count).toBe(1);
        expect(found.issues[0]!.totalHits).toBe(2);
        expect(found.issues[0]!.hits.map((hit) => hit.field)).toEqual([
            "description",
            "description"
        ]);
    });

    it("composes with the ordinary filters", async () => {
        const root = await backlog();

        const both = (await motte(root, ["find", "o", "--json"])).json<{ count: number }>();
        const narrowed = (await motte(root, ["find", "o", "--label", "core", "--json"])).json<{
            count: number;
        }>();

        expect(both.count).toBeGreaterThan(narrowed.count);
        expect(narrowed.count).toBe(1);
    });

    it("caps the lines shown per issue and says how many were left", async () => {
        const root = await initialised();
        const description = Array.from({ length: 6 }, (_, i) => `line ${i} mentions header`).join(
            "\n"
        );
        await motte(root, ["add", "Long one", "-d", description]);

        const run = await motte(root, ["find", "header", "--hits", "2"]);

        expect(run.stdout).toContain("and 4 more in this issue");
    });

    it("says so when nothing matches, quoting what was asked for", async () => {
        const root = await backlog();

        const run = await motte(root, ["find", "quantum"]);

        expect(run.stdout).toMatch(/nothing matches/);
        expect(run.stdout).toContain("quantum");
    });

    it("searches every project with --all", async () => {
        const shared = mkdtempSync(join(tmpdir(), "motte-find-"));
        const first = project();
        await motte(first, ["init", "--name", "First", "--no-agents"], {
            MOTTE_INSTALL_DIR: shared
        });
        await motte(first, ["add", "Alpha", "-d", "mentions widgets"], {
            MOTTE_INSTALL_DIR: shared
        });

        const second = project();
        await motte(second, ["init", "--name", "Second", "--no-agents"], {
            MOTTE_INSTALL_DIR: shared
        });
        await motte(second, ["add", "Beta", "-d", "also mentions widgets"], {
            MOTTE_INSTALL_DIR: shared
        });

        const found = (
            await motte(first, ["find", "widgets", "--all", "--json"], {
                MOTTE_INSTALL_DIR: shared
            })
        ).json<{ count: number; projects: { name: string }[] }>();

        expect(found.count).toBe(2);
        expect(found.projects.map((entry) => entry.name).sort()).toEqual(["First", "Second"]);
    });
});

/**
 * Linking issues to the commits that came from them.
 *
 * Against a real repository with real commits, including one made through the installed hook. The hook is a
 * shell script git executes — nothing short of running it proves it works, and a hook that fails blocks a
 * commit, which is the failure mode worth being sure about.
 */
describe("issues and commits", RETRY, () => {
    it("lists the commits that mention an issue", async () => {
        const root = await committedProject();
        await motte(root, ["add", "Write the parser"]);
        commitAll(root, "Start the parser (#0001)");

        const shown = (await motte(root, ["show", "1", "--json"])).json<{
            commits: { subject: string; shortSha: string }[];
        }>();

        expect(shown.commits.map((commit) => commit.subject)).toContain("Start the parser (#0001)");
    });

    it("interleaves them with the transitions in the log", async () => {
        const root = await committedProject();
        await motte(root, ["add", "Write the parser"]);
        commitAll(root, "Start the parser (#0001)");
        await motte(root, ["move", "1", "in progress"]);

        const run = await motte(root, ["log", "1"]);

        expect(run.stdout).toContain("git ");
        expect(run.stdout).toContain("Start the parser");
        expect(run.stdout).toContain("Todo → In Progress");
    });

    it("can be told to leave the commits out", async () => {
        const root = await committedProject();
        await motte(root, ["add", "Write the parser"]);
        commitAll(root, "Start the parser (#0001)");

        const run = await motte(root, ["log", "1", "--no-commits"]);

        expect(run.stdout).not.toContain("Start the parser");
    });

    it("says nothing about commits in a project that is not a repository", async () => {
        const root = await initialised();
        await motte(root, ["add", "No git here"]);

        const shown = (await motte(root, ["show", "1", "--json"])).json<{ commits: unknown[] }>();

        expect(shown.commits).toEqual([]);
    });

    describe("motte current", () => {
        it("names the one issue you have claimed", async () => {
            const root = await initialised();
            await motte(root, ["add", "Mine"]);
            await motte(root, ["claim", "1"]);

            expect((await motte(root, ["current"])).stdout.trim()).toBe("#0001");
        });

        /** Two claimed issues means the hook cannot know which a commit is for, so it says nothing. */
        it("says nothing when two are claimed, rather than guessing", async () => {
            const root = await initialised();
            await motte(root, ["add", "One"]);
            await motte(root, ["add", "Two"]);
            await motte(root, ["claim", "1"]);
            await motte(root, ["claim", "2"]);

            const run = await motte(root, ["current"]);

            expect(run.stdout.trim()).toBe("");
            // But a caller that wants the ambiguity can see it.
            expect((await motte(root, ["current", "--json"])).json<{ count: number }>().count).toBe(
                2
            );
        });

        it("says nothing when nothing is claimed", async () => {
            const root = await initialised();
            await motte(root, ["add", "Unclaimed"]);

            expect((await motte(root, ["current"])).stdout.trim()).toBe("");
        });

        it("ignores work claimed by somebody else", async () => {
            const root = await initialised();
            await motte(root, ["add", "Theirs"]);
            await motte(root, ["claim", "1"], { MOTTE_AGENT: "atlas" });

            expect((await motte(root, ["current"])).stdout.trim()).toBe("");
        });
    });

    describe("the commit hook", () => {
        it("stamps a real commit with the claimed issue", async () => {
            const root = await committedProject();
            await motte(root, ["add", "Wire the hook"]);
            await motte(root, ["claim", "1"]);
            expect((await motte(root, ["install", "--hooks", "--agent", "claude-code"])).code).toBe(
                0
            );

            // A `motte` the hook can call by name, since it runs as a plain shell script.
            const bin = join(root, "hookbin");
            mkdirSync(bin, { recursive: true });
            const shim = join(bin, "motte");
            writeFileSync(shim, `#!/bin/sh\nexec bun ${ENTRY} "$@"\n`, "utf8");
            spawnSync("chmod", ["+x", shim]);

            writeFileSync(join(root, "code.txt"), "content", "utf8");
            spawnSync("git", ["add", "-A"], { cwd: root });
            const committed = spawnSync("git", ["commit", "-m", "Add some code"], {
                cwd: root,
                encoding: "utf8",
                timeout: SPAWN_TIMEOUT_MS,
                env: {
                    ...process.env,
                    ...sandboxEnv(root),
                    PATH: `${bin}:${process.env.PATH ?? ""}`,
                    MOTTE_AUTHOR: "Test User"
                }
            });

            // A hook that fails blocks the commit, so the exit status is half of what is being asserted.
            expect(committed.status).toBe(0);

            const message = spawnSync("git", ["log", "-1", "--format=%B"], {
                cwd: root,
                encoding: "utf8"
            }).stdout;
            expect(message).toContain("Refs: #0001");
        });

        it("leaves a message that already names an issue alone", async () => {
            const root = await committedProject();
            await motte(root, ["add", "Wire the hook"]);
            await motte(root, ["claim", "1"]);
            await motte(root, ["install", "--hooks", "--agent", "claude-code"]);

            writeFileSync(join(root, "code.txt"), "content", "utf8");
            spawnSync("git", ["add", "-A"], { cwd: root });
            spawnSync("git", ["commit", "-m", "Fix it for #0001"], {
                cwd: root,
                encoding: "utf8",
                timeout: SPAWN_TIMEOUT_MS,
                env: { ...process.env, ...sandboxEnv(root) }
            });

            const message = spawnSync("git", ["log", "-1", "--format=%B"], {
                cwd: root,
                encoding: "utf8"
            }).stdout;
            expect(message.match(/#0001/g)).toHaveLength(1);
        });

        it("is removed by uninstall, and only motte's part of it", async () => {
            const root = await committedProject();
            const hook = join(root, ".git", "hooks", "prepare-commit-msg");
            writeFileSync(hook, "#!/bin/sh\necho theirs\n", "utf8");

            await motte(root, ["install", "--hooks", "--agent", "claude-code"]);
            expect(readFileSync(hook, "utf8")).toContain("motte:start");

            await motte(root, ["uninstall", "--keep-cli", "--yes"]);

            const left = readFileSync(hook, "utf8");
            expect(left).toContain("echo theirs");
            expect(left).not.toContain("motte:start");
        });
    });
});

/**
 * `motte doctor --fix`.
 *
 * Three findings have one obvious repair each; everything else `doctor` reports is a judgement call. The
 * distinction is the feature, so the tests check both halves — what it repairs, and that it leaves the rest
 * alone and says so.
 */
describe("doctor --fix", RETRY, () => {
    /** A backlog with every mechanical problem, plus one nobody can fix for you. */
    async function broken(): Promise<string> {
        const root = await initialised();
        const dir = join(root, ".motte", "issues");

        const write = (name: string, body: string) => writeFileSync(join(dir, name), body, "utf8");

        write(
            "0007-first.md",
            "---\nid: 7\ntitle: Filed first\nstate: Todo\ncreated: 2026-08-01T09:00:00Z\n" +
                "updated: 2026-08-01T09:00:00Z\n---\n\n## Description\n\nBranch A.\n"
        );
        write(
            "0007-second.md",
            "---\nid: 7\ntitle: Filed second\nstate: Todo\ncreated: 2026-08-02T09:00:00Z\n" +
                "updated: 2026-08-02T09:00:00Z\n---\n\n## Description\n\nBranch B.\n"
        );
        write(
            "0009-stale-name.md",
            "---\nid: 9\ntitle: The title changed\nstate: Todo\ncreated: 2026-08-03T09:00:00Z\n" +
                "updated: 2026-08-03T09:00:00Z\n---\n\n## Description\n\nRenamed by hand.\n"
        );
        // Trailing whitespace and no final newline: parses, but would be rewritten.
        write(
            "0011-needs-reformatting.md",
            "---\nid: 11\ntitle: Needs reformatting\nstate: Todo\ncreated: 2026-08-04T09:00:00Z\n" +
                "updated: 2026-08-04T09:00:00Z\n---\n\n## Description\n\nText.   "
        );
        write(
            "0012-orphan.md",
            "---\nid: 12\ntitle: Points at nothing\nstate: Todo\nparent: 999\n" +
                "created: 2026-08-05T09:00:00Z\nupdated: 2026-08-05T09:00:00Z\n---\n\n" +
                "## Description\n\nIts parent does not exist.\n"
        );

        return root;
    }

    it("repairs a duplicate id, a stale filename and a file that would be rewritten", async () => {
        const root = await broken();
        expect((await motte(root, ["doctor"])).code).toBe(1);

        const fixed = (await motte(root, ["doctor", "--fix", "--json"])).json<{
            repaired: { kind: string; message: string }[];
            errors: { kind: string }[];
        }>();

        expect(fixed.repaired.map((entry) => entry.kind).sort()).toEqual(
            ["renamed", "renamed", "renamed", "renumbered", "reformatted"].sort()
        );

        const names = readdirSync(join(root, ".motte", "issues")).sort();
        expect(names).toContain("0009-the-title-changed.md");
        expect(names).not.toContain("0009-stale-name.md");
        // The duplicate moved to a fresh id above everything in use.
        expect(names.some((name) => name.startsWith("0013-"))).toBe(true);
    });

    /** The other half: a missing parent is a judgement call and must survive --fix untouched. */
    it("leaves what it cannot decide, and says that it did", async () => {
        const root = await broken();

        const run = await motte(root, ["doctor", "--fix"]);

        expect(run.stdout).toMatch(/left alone/);
        expect(run.stdout + run.stderr).toMatch(/#12 has parent #999/);
        // Which means the command still fails, because the backlog is still broken.
        expect(run.code).toBe(1);
    });

    it("reports the backlog as it stands after repairing, not before", async () => {
        const root = await initialised();
        writeFileSync(
            join(root, ".motte", "issues", "0004-stale-name.md"),
            "---\nid: 4\ntitle: Renamed\nstate: Todo\ncreated: 2026-08-01T09:00:00Z\n" +
                "updated: 2026-08-01T09:00:00Z\n---\n\n## Description\n\nText.\n",
            "utf8"
        );

        const run = await motte(root, ["doctor", "--fix"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toContain("no problems found");
    });

    describe("--dry-run", () => {
        it("says exactly what it would do, and changes nothing", async () => {
            const root = await broken();
            const before = readdirSync(join(root, ".motte", "issues")).sort();

            const run = await motte(root, ["doctor", "--fix", "--dry-run"]);

            expect(run.stdout).toContain(
                "would rename: 0009-stale-name.md → 0009-the-title-changed.md"
            );
            expect(run.stdout).toContain("would reformat:");
            expect(run.stdout).toMatch(/Nothing was changed/);
            expect(readdirSync(join(root, ".motte", "issues")).sort()).toEqual(before);
        });

        /**
         * The dry run and the real run must agree. They used to disagree: the dry run reported every
         * candidate as "renamed to what its id and title imply", including files the renumber pass was
         * about to move anyway.
         */
        it("matches what the real run then does", async () => {
            const root = await broken();

            const planned = (await motte(root, ["doctor", "--fix", "--dry-run", "--json"])).json<{
                wouldRepair: { kind: string; message: string }[];
            }>();
            const applied = (await motte(root, ["doctor", "--fix", "--json"])).json<{
                repaired: { kind: string; message: string }[];
            }>();

            expect(planned.wouldRepair).toEqual(applied.repaired);
        });
    });

    it("says so when there is nothing mechanical to repair", async () => {
        const root = await initialised();
        await motte(root, ["add", "Perfectly fine", "-d", "Nothing wrong."]);

        expect((await motte(root, ["doctor", "--fix"])).stdout).toMatch(/nothing to repair/);
    });

    /**
     * A formatting repair is not an edit. Bumping `updated` would make it look like one in every report
     * that reads the timestamp — including the stale-work check.
     */
    it("does not touch updated when it only reformats", async () => {
        const root = await initialised();
        writeFileSync(
            join(root, ".motte", "issues", "0004-untidy.md"),
            "---\nid: 4\ntitle: Untidy\nstate: Todo\ncreated: 2026-08-01T09:00:00Z\n" +
                "updated: 2026-08-01T09:00:00Z\n---\n\n## Description\n\nText.   ",
            "utf8"
        );

        await motte(root, ["doctor", "--fix"]);

        const shown = (await motte(root, ["show", "4", "--json"])).json<{ updated: string }>();
        expect(shown.updated).toBe("2026-08-01T09:00:00Z");
    });
});
