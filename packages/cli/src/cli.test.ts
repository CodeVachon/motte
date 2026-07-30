import { beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end tests for the CLI, spawning the real entry point.
 *
 * Subprocess rather than in-process on purpose. Calling `run(argv)` directly would be faster and would
 * attribute coverage, but it bypasses exactly what breaks: every CLI regression this project has hit was
 * wiring or parsing — a positional named `version` colliding with yargs' own `--version`, `--since 7`
 * silently accepted because `Date.parse` takes it, an unhandled EPIPE on `| head`. None of those would
 * surface cleanly from a direct call.
 *
 * `node:child_process`, not `Bun.$`: vitest runs on Node, where Bun globals are undefined.
 */
const ENTRY = join(import.meta.dirname, "index.ts");

interface Run {
    code: number;
    stdout: string;
    stderr: string;
    /** Parsed `--json` output. Throws with the raw text when it is not JSON, which is the useful failure. */
    json: <T = Record<string, unknown>>() => T;
}

/**
 * Every spawn is bounded, and every test is retried once.
 *
 * `spawnSync` blocks the worker thread, so vitest's `testTimeout` cannot interrupt it — a child that
 * never exits hangs the whole run rather than failing one test. That hung a CI job for eighteen
 * minutes with no indication of which command was stuck.
 *
 * With the bound in place the real behaviour became visible: on the GitHub runner an ordinary spawn
 * occasionally stalls indefinitely while its neighbours in the same run complete in under a second.
 * Two separate runs stalled on `motte init` and on `motte add` — different trivial commands, so it is
 * the runner rather than any code path.
 *
 * The retry is on the *test*, not the command. A stalled `motte add` may have written its file before
 * stalling, so re-running the command could double-apply; re-running the test cannot, because every
 * test builds a fresh temp project. 20s is a twentyfold margin over the observed worst case.
 */
const SPAWN_TIMEOUT_MS = 20_000;

/**
 * Applied to every describe below. See `SPAWN_TIMEOUT_MS`.
 *
 * Two, not one, from the observed rate: about 3% of spawns stalled in the run that exposed this, so a
 * single retry would still leave roughly one run in eight red across 35 tests. Retries re-run
 * `beforeEach`, so each attempt gets its own temp project. The cost is only paid when a stall happens.
 */
const RETRY = { retry: 2 };

function motte(cwd: string, args: string[], env: Record<string, string> = {}): Run {
    // `bun <file>`, not `bun run <file>`: executing the entry point directly skips package.json script
    // resolution, which is per-spawn overhead this test pays sixty-odd times.
    const result = spawnSync("bun", [ENTRY, ...args], {
        cwd,
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: "SIGKILL",
        env: {
            ...process.env,
            // Deterministic authorship: CI has no git user configured, and NO_COLOR keeps assertions
            // free of ANSI escapes.
            MOTTE_AUTHOR: "Test User",
            NO_COLOR: "1",
            ...env
        }
    });

    if (result.error !== undefined) {
        throw new Error(`motte ${args.join(" ")} failed to run: ${result.error.message}`);
    }
    if (result.signal === "SIGKILL") {
        throw new Error(
            `motte ${args.join(" ")} stalled: no exit within ${SPAWN_TIMEOUT_MS}ms. ` +
                `Neighbouring spawns take under a second, so suspect the runner, not the command.`
        );
    }

    const stdout = result.stdout ?? "";

    return {
        code: result.status ?? -1,
        stdout,
        stderr: result.stderr ?? "",
        json: <T>() => {
            try {
                return JSON.parse(stdout) as T;
            } catch {
                throw new Error(`expected JSON on stdout, got:\n${stdout}\n${result.stderr ?? ""}`);
            }
        }
    };
}

/** A temp directory with a git repo, since prune and restore require one. */
function project(): string {
    const root = mkdtempSync(join(tmpdir(), "motte-cli-"));
    spawnSync("git", ["init", "-q", "."], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Test User"], { cwd: root });
    return root;
}

function initialised(): string {
    const root = project();
    expect(motte(root, ["init", "--name", "Test"]).code).toBe(0);
    return root;
}

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
    it("writes a config and an issues directory", () => {
        const root = project();
        const run = motte(root, ["init", "--name", "Test"]);

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

    it("refuses to overwrite an existing config", () => {
        const root = initialised();
        const run = motte(root, ["init", "--name", "Other"]);

        expect(run.code).toBe(1);
        expect(run.stderr + run.stdout).toMatch(/already exists/);
    });

    it("overwrites with --force", () => {
        const root = initialised();
        expect(motte(root, ["init", "--name", "Other", "--force"]).code).toBe(0);
    });
});

describe("the everyday sequence", RETRY, () => {
    let root: string;

    beforeEach(() => {
        root = initialised();
    });

    it("creates an issue and reports it as JSON", () => {
        const issue = motte(root, [
            "add",
            "Build the parser",
            "-d",
            "First.",
            "--json"
        ]).json<IssueJson>();

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

    it("creates a child, and lists the hierarchy", () => {
        motte(root, ["add", "Parent"]);
        const child = motte(root, ["add", "Child", "-p", "1", "--json"]).json<IssueJson>();

        expect(child.parent).toBe(1);

        const tree = motte(root, ["tree", "--json"]).json<{
            roots: { id: number; children: { id: number }[] }[];
        }>();
        expect(tree.roots).toHaveLength(1);
        expect(tree.roots[0]!.children.map((node) => node.id)).toEqual([2]);
    });

    it("moves state by prefix, case-insensitively", () => {
        motte(root, ["add", "A thing"]);
        const moved = motte(root, ["move", "1", "in prog", "--json"]).json<IssueJson>();

        expect(moved.state).toBe("In Progress");
    });

    it("resolves an issue by a fragment of its title", () => {
        motte(root, ["add", "Build the parser"]);
        const shown = motte(root, ["show", "parser", "--json"]).json<IssueJson>();

        expect(shown.id).toBe(1);
    });

    it("records a note with its author", () => {
        motte(root, ["add", "Noted"]);
        expect(motte(root, ["note", "1", "A decision."]).code).toBe(0);

        const file = readdirSync(join(root, ".motte", "issues"))[0]!;
        const contents = readFileSync(join(root, ".motte", "issues", file), "utf8");

        expect(contents).toContain("— Test User (user)");
        expect(contents).toContain("A decision.");
    });

    it("assigns and unassigns", () => {
        motte(root, ["add", "Assign me"]);
        expect(motte(root, ["assign", "1", "atlas", "--json"]).json<IssueJson>().assignee).toBe(
            "atlas"
        );
        expect(
            motte(root, ["assign", "1", "none", "--json"]).json<IssueJson>().assignee
        ).toBeNull();
    });

    it("filters list by state, label and assignee", () => {
        motte(root, ["add", "One", "-l", "core", "-a", "atlas"]);
        motte(root, ["add", "Two", "-l", "cli"]);
        motte(root, ["move", "2", "done"]);

        expect(
            motte(root, ["list", "--label", "core", "--json"]).json<{ count: number }>().count
        ).toBe(1);
        expect(
            motte(root, ["list", "--assignee", "atlas", "--json"]).json<{ count: number }>().count
        ).toBe(1);
        expect(
            motte(root, ["list", "--state", "Done", "--json"]).json<{ count: number }>().count
        ).toBe(1);
        expect(motte(root, ["list", "--open", "--json"]).json<{ count: number }>().count).toBe(1);
    });

    /**
     * `-l a,b` reads as two labels. Taking it literally produced one label containing a comma, which
     * the writer then emitted bare into the inline list, and the file stopped round-tripping.
     */
    it("splits comma-separated labels", () => {
        const created = motte(root, [
            "add",
            "Multi",
            "-l",
            "cli,testing",
            "-l",
            "core",
            "--json"
        ]).json<IssueJson>();

        expect(created.labels).toEqual(["cli", "testing", "core"]);
        expect(motte(root, ["doctor"]).code).toBe(0);
    });

    it("drops blank labels and collapses duplicates", () => {
        const created = motte(root, [
            "add",
            "Messy",
            "-l",
            "core, ,core",
            "--json"
        ]).json<IssueJson>();

        expect(created.labels).toEqual(["core"]);
    });

    it("edits fields without touching the others", () => {
        motte(root, ["add", "Original", "-d", "Keep me."]);
        const edited = motte(root, ["edit", "1", "--plan", "1. Do it", "--json"]).json<
            IssueJson & { description: string; plan: string }
        >();

        expect(edited.plan).toBe("1. Do it");
        expect(edited.description).toBe("Keep me.");
        expect(edited.title).toBe("Original");
    });
});

describe("dependencies", RETRY, () => {
    let root: string;

    beforeEach(() => {
        root = initialised();
        motte(root, ["add", "First"]);
        motte(root, ["add", "Second"]);
        motte(root, ["block", "2", "1"]);
    });

    it("records the blocker", () => {
        expect(motte(root, ["show", "2", "--json"]).json<IssueJson>().blockedBy).toEqual([1]);
    });

    it("reports only unblocked work as ready", () => {
        const ready = motte(root, ["ready", "--json"]).json<{ issues: { id: number }[] }>();
        expect(ready.issues.map((issue) => issue.id)).toEqual([1]);
    });

    it("releases the dependent once the blocker is done", () => {
        motte(root, ["move", "1", "done"]);
        const ready = motte(root, ["ready", "--json"]).json<{ issues: { id: number }[] }>();

        expect(ready.issues.map((issue) => issue.id)).toEqual([2]);
    });

    it("lists what is blocked, and on what", () => {
        const blocked = motte(root, ["ready", "--blocked", "--json"]).json<{
            issues: { id: number; openBlockers: { id: number }[] }[];
        }>();

        expect(blocked.issues).toHaveLength(1);
        expect(blocked.issues[0]!.openBlockers.map((b) => b.id)).toEqual([1]);
    });

    it("unblocks", () => {
        expect(motte(root, ["unblock", "2", "1", "--json"]).json<IssueJson>().blockedBy).toEqual(
            []
        );
    });
});

describe("reporting", RETRY, () => {
    it("reports progress and readiness counts", () => {
        const root = initialised();
        motte(root, ["add", "Done thing"]);
        motte(root, ["add", "Open thing"]);
        motte(root, ["move", "1", "done"]);

        const status = motte(root, ["status", "--json"]).json<{
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

    it("logs the transitions it recorded", () => {
        const root = initialised();
        motte(root, ["add", "Tracked"]);
        motte(root, ["move", "1", "done"]);

        const log = motte(root, ["log", "--json"]).json<{
            entries: { id: number; summary: string }[];
        }>();

        expect(log.entries.length).toBeGreaterThanOrEqual(2);
        expect(log.entries.some((entry) => entry.summary.includes("Todo → Done"))).toBe(true);
    });

    it("passes doctor on a clean backlog and fails on a broken one", () => {
        const root = initialised();
        motte(root, ["add", "Fine", "-d", "Has a description."]);

        expect(motte(root, ["doctor", "--json"]).json<{ ok: boolean }>().ok).toBe(true);
        expect(motte(root, ["doctor"]).code).toBe(0);

        // A duplicate id is the error doctor caught in CI once before.
        const first = readdirSync(join(root, ".motte", "issues"))[0]!;
        writeFileSync(
            join(root, ".motte", "issues", "0001-a-copy.md"),
            readFileSync(join(root, ".motte", "issues", first), "utf8"),
            "utf8"
        );

        const broken = motte(root, ["doctor"]);
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
    it("reports a file that does not survive a round trip", () => {
        const root = initialised();
        motte(root, ["add", "Has a label", "-l", "core"]);

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

        const run = motte(root, ["doctor"]);
        expect(run.code).toBe(1);
        expect(run.stdout + run.stderr).toMatch(/does not survive a parse\/format round trip/);
    });
});

/** The paths most likely to regress, and the ones a user actually hits by mistake. */
describe("failure paths", RETRY, () => {
    let root: string;

    beforeEach(() => {
        root = initialised();
    });

    it("reports an unknown reference and exits 1", () => {
        const run = motte(root, ["show", "9999"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/no issue matching "9999"/);
    });

    it("reports an ambiguous reference with the candidates", () => {
        motte(root, ["add", "Design the schema"]);
        motte(root, ["add", "Implement the schema"]);

        const run = motte(root, ["show", "schema"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/#1/);
        expect(run.stderr).toMatch(/#2/);
    });

    it("reports an unknown state, listing the configured ones", () => {
        motte(root, ["add", "A thing"]);
        const run = motte(root, ["move", "1", "Shipped"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/not a known state/);
        expect(run.stderr).toMatch(/Todo/);
    });

    it("rejects a parent cycle", () => {
        motte(root, ["add", "Root"]);
        motte(root, ["add", "Child", "-p", "1"]);

        const run = motte(root, ["edit", "1", "--parent", "2"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/cycle/);
    });

    it("rejects a dependency cycle", () => {
        motte(root, ["add", "First"]);
        motte(root, ["add", "Second"]);
        motte(root, ["block", "2", "1"]);

        const run = motte(root, ["block", "1", "2"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/dependency cycle/);
    });

    it("explains itself outside a project rather than crashing", () => {
        const bare = mkdtempSync(join(tmpdir(), "motte-bare-"));
        const run = motte(bare, ["list"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/motte init/);
    });

    it("rejects an unknown flag rather than ignoring it", () => {
        // yargs strict mode: a typo should fail loudly, not silently do the wrong thing.
        const run = motte(root, ["list", "--nonsense"]);
        expect(run.code).toBe(1);
    });
});

/**
 * Wiring, which is what has actually broken. Each of these corresponds to a real bug found during
 * development, so they are regression tests rather than speculation.
 */
describe("wiring", RETRY, () => {
    it("reports the version from package.json", () => {
        const pkg = JSON.parse(
            readFileSync(join(import.meta.dirname, "..", "..", "..", "package.json"), "utf8")
        ) as { version: string };

        expect(motte(project(), ["--version"]).stdout.trim()).toBe(pkg.version);
    });

    it("accepts a version positional on upgrade without the --version flag stealing it", () => {
        // Regression: the positional was named `version`, so yargs' own --version flag won and the
        // positional arrived as boolean `true`.
        const run = motte(project(), ["upgrade", "0.0.1", "--check"]);

        // Not a managed install here, so it refuses — but it must refuse for that reason, not by
        // throwing on a boolean.
        expect(run.stderr).toMatch(/managed installation/);
        expect(run.stderr).not.toMatch(/trim is not a function/);
    });

    it("rejects a bare number for --since, suggesting the unit", () => {
        // Regression: Date.parse("7") succeeds, so this was silently accepted as an arbitrary date.
        const root = initialised();
        const run = motte(root, ["log", "--since", "7"]);

        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/no unit/);
    });

    it("exits quietly when the reader closes the pipe", () => {
        // Regression: `motte status | head` died with an unhandled EPIPE and a stack trace.
        // Five issues is enough output for `head -2` to close the pipe early; forty just cost forty
        // process spawns and blew the timeout.
        const root = initialised();
        for (let i = 0; i < 5; i += 1) motte(root, ["add", `Issue ${i}`]);

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

    it("prints an MCP config snippet without needing a project", () => {
        const run = motte(project(), ["mcp", "--print-config"]);

        expect(run.code).toBe(0);
        expect(run.stdout).toMatch(/mcpServers/);
        expect(run.stdout).toMatch(/motte/);
    });

    it("registers every command in help", () => {
        const help = motte(project(), ["--help"]).stdout;

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
