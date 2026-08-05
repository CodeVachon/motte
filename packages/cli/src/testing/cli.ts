import { expect } from "vitest";
import chalk from "chalk";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../index.js";

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
export // `..` because this helper lives in testing/, one level below the entry point it spawns.
const ENTRY = join(import.meta.dirname, "..", "index.ts");

/**
 * Colour is disabled by assignment rather than by `NO_COLOR`, which chalk reads once at import. In-process
 * the module is already loaded by the time a test sets an env var, so the env route silently does nothing.
 */
chalk.level = 0;

export interface Run {
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
export async function motte(
    cwd: string,
    args: string[],
    env: Record<string, string> = {}
): Promise<Run> {
    const previousCwd = process.cwd();
    const previousExit = process.exit;
    const previousStdout = process.stdout.write;
    const previousStderr = process.stderr.write;
    const previousLog = console.log;
    const previousError = console.error;
    const previousExitCode = process.exitCode;
    const previousEnv = new Map<string, string | undefined>();
    /**
     * `run` attaches an EPIPE listener to each stream every call. Harmless in the binary, which calls it
     * once, but in-process they accumulate — 60 calls tripped Node's MaxListenersExceededWarning. Snapshot
     * what was there so only the listeners this call added get removed, leaving vitest's own alone.
     */
    const previousListeners = new Map<NodeJS.WriteStream, Function[]>([
        [process.stdout, process.stdout.listeners("error")],
        [process.stderr, process.stderr.listeners("error")]
    ]);

    let stdout = "";
    let stderr = "";
    let code = 0;

    /**
     * Deterministic authorship, and a home directory that is not the developer's.
     *
     * `init` and `install` write agent configuration: `~/.codex/config.toml` and the wiring record under
     * `~/.motte/`. Without this, running the suite would edit the real files of whoever ran it — and
     * detection reads `~/.claude`, so the same test would behave differently on two machines.
     */
    const sandboxHome = join(cwd, ".test-home");
    mkdirSync(sandboxHome, { recursive: true });

    for (const [key, value] of Object.entries({
        MOTTE_AUTHOR: "Test User",
        HOME: sandboxHome,
        USERPROFILE: sandboxHome,
        MOTTE_INSTALL_DIR: join(sandboxHome, ".motte"),
        ...env
    })) {
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
        // yargs prints help and usage through the console rather than the streams directly, and defaults
        // to console.error for both. Capturing only console.log made that output invisible to tests.
        console.log = (...parts: unknown[]) => {
            stdout += `${parts.map(String).join(" ")}\n`;
        };
        console.error = (...parts: unknown[]) => {
            stderr += `${parts.map(String).join(" ")}\n`;
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
        console.error = previousError;

        for (const [key, value] of previousEnv) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }

        for (const [stream, kept] of previousListeners) {
            for (const listener of stream.listeners("error")) {
                if (!kept.includes(listener)) {
                    stream.removeListener("error", listener as (...args: unknown[]) => void);
                }
            }
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
export const SPAWN_TIMEOUT_MS = 20_000;

/** Applied to the `wiring` describe, the only one that still spawns. See `SPAWN_TIMEOUT_MS`. */
export const RETRY = { retry: 2 };

export function spawnMotte(cwd: string, args: string[], env: Record<string, string> = {}): Run {
    // Sandboxed the same way as the in-process runner: a spawned `init` wires up agents too, and would
    // otherwise write into the home directory of whoever ran the suite.
    const sandboxHome = join(cwd, ".test-home");
    mkdirSync(sandboxHome, { recursive: true });

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
            HOME: sandboxHome,
            USERPROFILE: sandboxHome,
            MOTTE_INSTALL_DIR: join(sandboxHome, ".motte"),
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
 * Make agent detection fire, deterministically.
 *
 * Detection also checks `command -v claude`, so on a developer machine with Claude Code installed it fires
 * and in CI it does not — the same test would then assert different things in the two places. Creating the
 * directory it looks for inside the sandbox home settles it either way.
 */
export function pretendClaudeCodeInstalled(root: string): void {
    mkdirSync(join(root, ".test-home", ".claude"), { recursive: true });
}

/**
 * A bare temp directory.
 *
 * No git repo: this used to run `git init` plus two `git config` calls per test, on the assumption that
 * prune and restore need one, but neither is exercised here — they appear in this file only as names in
 * the help-registration list. That was 105 process spawns per run for nothing, and spawns are the thing
 * #0072 made expensive.
 */
export function project(): string {
    return mkdtempSync(join(tmpdir(), "motte-cli-"));
}

/**
 * A project in a git repository with the backlog committed.
 *
 * `prune` refuses to run outside a repository, without commits, or with the backlog dirty, because a
 * tombstone that points at a commit not containing the issue is not recoverable. Anything testing prune
 * or restore needs all three conditions satisfied.
 */
export async function committedProject(): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), "motte-cli-"));

    spawnSync("git", ["init", "-q", "."], { cwd: root });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Test User"], { cwd: root });

    expect((await motte(root, ["init", "--name", "Test"])).code).toBe(0);
    return root;
}

/** Stage and commit everything, so the backlog is clean again after a mutation. */
export function commitAll(root: string, message = "backlog"): void {
    spawnSync("git", ["add", "-A"], { cwd: root });
    spawnSync("git", ["commit", "-q", "-m", message], { cwd: root });
}

export async function initialised(): Promise<string> {
    const root = project();
    expect((await motte(root, ["init", "--name", "Test"])).code).toBe(0);
    return root;
}
