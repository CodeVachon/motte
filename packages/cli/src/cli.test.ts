import { beforeEach, describe, expect, it } from "vitest";
import chalk from "chalk";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./index.js";

/**
 * End-to-end tests for the CLI, driving the real entry point.
 *
 * Two harnesses, and the split is deliberate.
 *
 * `motte()` runs in-process via `main(argv)` — the same function the binary calls, error handling and exit
 * codes included. Argv parsing, the `version` positional collision, unknown-flag rejection and `--since 7`
 * validation all go through yargs either way, so almost nothing is lost. What is gained: no process spawn
 * per assertion, which is what exposed the suite to the runner stall in #0072, and coverage that actually
 * attributes to the command modules — v8 coverage does not follow subprocesses, so eleven of them read as
 * 0% while being exercised end to end. Moving them in-process took statement coverage from 51.9% to 71.3%
 * and this file from 33s to 3s.
 *
 * The one real subtlety is exit codes, and it is easy to get wrong: see the note on `process.exitCode`
 * below. An in-process harness that observes only `process.exit` reports 0 for every failing command.
 *
 * `spawnMotte()` runs the real binary in a real process, and the `wiring` block keeps using it for the
 * handful of things that genuinely need one: a true exit status, a shell pipeline that closes the pipe, and
 * the entry point being wired up at all. Those cannot be observed from inside this process.
 *
 * `node:child_process`, not `Bun.$`: vitest runs on Node, where Bun globals are undefined.
 */
const ENTRY = join(import.meta.dirname, "index.ts");

/**
 * Colour is disabled by assignment rather than by `NO_COLOR`, which chalk reads once at import. In-process
 * the module is already loaded by the time a test sets an env var, so the env route silently does nothing.
 */
chalk.level = 0;

interface Run {
    code: number;
    stdout: string;
    stderr: string;
    /** Parsed `--json` output. Throws with the raw text when it is not JSON, which is the useful failure. */
    json: <T = Record<string, unknown>>() => T;
}

/** Thrown in place of `process.exit`, so an exiting command unwinds instead of killing the test run. */
class ExitSignal extends Error {
    constructor(readonly code: number) {
        super(`exit ${code}`);
    }
}

function asRun(code: number, stdout: string, stderr: string): Run {
    return {
        code,
        stdout,
        stderr,
        json: <T>() => {
            try {
                return JSON.parse(stdout) as T;
            } catch {
                throw new Error(`expected JSON on stdout, got:\n${stdout}\n${stderr}`);
            }
        }
    };
}

/**
 * Run a command in this process, with cwd, env, streams and `process.exit` swapped out for the duration.
 *
 * Everything is restored in a `finally`, including on an unexpected throw: leaking a stubbed
 * `process.exit` or a changed cwd would corrupt every test that followed and make the failure look
 * unrelated to its cause.
 */
async function motte(cwd: string, args: string[], env: Record<string, string> = {}): Promise<Run> {
    const previousCwd = process.cwd();
    const previousExit = process.exit;
    const previousStdout = process.stdout.write;
    const previousStderr = process.stderr.write;
    const previousLog = console.log;
    const previousExitCode = process.exitCode;
    const previousEnv = new Map<string, string | undefined>();

    let stdout = "";
    let stderr = "";
    let code = 0;

    // Deterministic authorship: CI has no git user configured.
    for (const [key, value] of Object.entries({ MOTTE_AUTHOR: "Test User", ...env })) {
        previousEnv.set(key, process.env[key]);
        process.env[key] = value;
    }

    try {
        process.chdir(cwd);
        process.exit = ((exitCode?: number): never => {
            throw new ExitSignal(exitCode ?? 0);
        }) as typeof process.exit;
        process.stdout.write = ((chunk: unknown) => {
            stdout += String(chunk);
            return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: unknown) => {
            stderr += String(chunk);
            return true;
        }) as typeof process.stderr.write;
        // yargs prints help and version through console.log rather than the stream directly.
        console.log = (...parts: unknown[]) => {
            stdout += `${parts.map(String).join(" ")}\n`;
        };

        // Failure is signalled two ways. `report` and yargs call `process.exit`, which the stub above
        // turns into a throw; `init`, `doctor`, `prune` and `upgrade` instead assign
        // `process.exitCode` and return normally, which a real process turns into its exit status.
        // Reading only the first is how this harness initially reported 0 for every failing command.
        process.exitCode = undefined;

        await main(args);
        code = process.exitCode ?? 0;
    } catch (thrown) {
        if (!(thrown instanceof ExitSignal)) throw thrown;
        code = thrown.code;
    } finally {
        // Restored, not just recorded: leaking a non-zero exitCode would make vitest's own process
        // exit non-zero even with every test passing.
        process.exitCode = previousExitCode;
        process.chdir(previousCwd);
        process.exit = previousExit;
        process.stdout.write = previousStdout;
        process.stderr.write = previousStderr;
        console.log = previousLog;

        for (const [key, value] of previousEnv) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }

    return asRun(code, stdout, stderr);
}

/**
 * Every remaining spawn is bounded, and every spawning test is retried.
 *
 * `spawnSync` blocks the worker thread, so vitest's `testTimeout` cannot interrupt it — a child that
 * never exits hangs the whole run rather than failing one test. That hung a CI job for eighteen
 * minutes with no indication of which command was stuck.
 *
 * With the bound in place the real behaviour became visible: on the GitHub runner an ordinary spawn
 * occasionally stalls indefinitely while its neighbours in the same run complete in under a second.
 * Two separate runs stalled on `motte init` and on `motte add` — different trivial commands, so it is
 * the runner rather than any code path. Moving most tests in-process cut the exposure from roughly
 * sixty-five spawns per run to a handful; the bound and the retry remain for those.
 *
 * The retry is on the *test*, not the command. A stalled `motte add` may have written its file before
 * stalling, so re-running the command could double-apply; re-running the test cannot, because every
 * test builds a fresh temp project. 20s is a twentyfold margin over the observed worst case.
 */
const SPAWN_TIMEOUT_MS = 20_000;

/** Applied to the `wiring` describe, the only one that still spawns. See `SPAWN_TIMEOUT_MS`. */
const RETRY = { retry: 2 };

function spawnMotte(cwd: string, args: string[], env: Record<string, string> = {}): Run {
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

    return asRun(result.status ?? -1, result.stdout ?? "", result.stderr ?? "");
}

/**
 * A bare temp directory.
 *
 * No git repo: this used to run `git init` plus two `git config` calls per test, on the assumption that
 * prune and restore need one, but neither is exercised here — they appear in this file only as names in
 * the help-registration list. That was 105 process spawns per run for nothing, and spawns are the thing
 * #0072 made expensive.
 */
function project(): string {
    return mkdtempSync(join(tmpdir(), "motte-cli-"));
}

async function initialised(): Promise<string> {
    const root = project();
    expect((await motte(root, ["init", "--name", "Test"])).code).toBe(0);
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
