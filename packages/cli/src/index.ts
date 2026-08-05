import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
    AmbiguousRefError,
    ConfigError,
    ConfigNotFoundError,
    CycleError,
    DependencyCycleError,
    IssueNotFoundError,
    IssueParseError
} from "@motte/core";
import { blockCommand, readyCommand, unblockCommand } from "./commands/deps.js";
import { doctorCommand } from "./commands/doctor.js";
import { renumberCommand } from "./commands/renumber.js";
import { serveCommand } from "./commands/serve.js";
import { completionCandidates, formatCandidates, isZshShell, wordsFromArgv } from "./completion.js";
import { context } from "./context.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { mcpCommand } from "./commands/mcp.js";
import { listCommand } from "./commands/list.js";
import { logCommand } from "./commands/log.js";
import { PruneError, pruneCommand, restoreCommand } from "./commands/prune.js";
import {
    addCommand,
    assignCommand,
    editCommand,
    moveCommand,
    noteCommand
} from "./commands/mutate.js";
import { showCommand } from "./commands/show.js";
import { AgentConfigError } from "./install/agents.js";
import { EditorError } from "./ui/editor.js";
import { renderStatus, statusCommand, treeCommand } from "./commands/status.js";
import { uninstallCommand, upgradeCommand } from "./commands/upgrade.js";
import { VERSION as CLI_VERSION } from "./version.js";
import { dim, error } from "./ui/format.js";

export { VERSION } from "./version.js";

/**
 * Errors that represent a normal "you asked for something that isn't there" outcome. These print a
 * single clean line rather than a stack trace, because they are the user's problem to fix, not a bug.
 */
const EXPECTED_ERRORS = [
    AgentConfigError,
    PruneError,
    AmbiguousRefError,
    ConfigError,
    CycleError,
    DependencyCycleError,
    EditorError,
    IssueNotFoundError,
    IssueParseError
];

/**
 * `motte status | head` closes the pipe as soon as it has what it wants. That is normal shell
 * behaviour, not a failure, so it exits quietly with 0 rather than reporting a broken pipe.
 */
function isBrokenPipe(thrown: unknown): boolean {
    return (
        typeof thrown === "object" &&
        thrown !== null &&
        (thrown as { code?: string }).code === "EPIPE"
    );
}

function report(thrown: unknown): never {
    if (isBrokenPipe(thrown)) process.exit(0);

    if (EXPECTED_ERRORS.some((type) => thrown instanceof type)) {
        process.stderr.write(`${error((thrown as Error).message)}\n`);
        process.exit(1);
    }

    if (thrown instanceof Error) {
        process.stderr.write(`${error(thrown.message)}\n`);
        if (process.env.MOTTE_DEBUG !== undefined && thrown.stack !== undefined) {
            process.stderr.write(`${thrown.stack}\n`);
        }
        process.exit(1);
    }

    process.stderr.write(`${error(String(thrown))}\n`);
    process.exit(1);
}

/**
 * What bare `motte` does.
 *
 * Inside a project, the status report: this is a project command center, and "where does the work stand" is
 * the question someone typing the bare command is asking. Outside one, the help, because there is no
 * backlog to summarise and what they need is `motte init`.
 *
 * Previously this hit `demandCommand` and printed `✗ null`, because yargs passes a null message to `.fail`
 * when the demand message is empty.
 */
function defaultAction(showHelp: () => void): void {
    let project: ReturnType<typeof context>;

    try {
        project = context();
    } catch (thrown) {
        if (thrown instanceof ConfigNotFoundError) {
            showHelp();
            process.stdout.write(`\n${dim("No project here yet. Start one with `motte init`.")}\n`);
            return;
        }
        throw thrown;
    }

    renderStatus(project.config, project.store.all(), false);

    // A pointer rather than the whole help wall above the report: the two commands that answer "what now",
    // and where to find the rest.
    process.stdout.write(
        `${dim("  motte ready")}    what can be picked up\n` +
            `${dim("  motte --help")}   every command\n\n`
    );
}

export async function run(argv: string[] = hideBin(process.argv)): Promise<void> {
    // A closed pipe can surface either as a thrown write (handled in `report`) or as a stream error
    // event, depending on where in the write the reader went away. Both have to be swallowed.
    for (const stream of [process.stdout, process.stderr]) {
        stream.on("error", (thrown: unknown) => {
            if (isBrokenPipe(thrown)) process.exit(0);
            throw thrown;
        });
    }

    const cli = yargs(argv)
        .scriptName("motte")
        .usage("$0 <command> [options]")
        .version(CLI_VERSION)
        .command(initCommand)
        .command(addCommand)
        .command(listCommand)
        .command(showCommand)
        .command(editCommand)
        .command(moveCommand)
        .command(assignCommand)
        .command(noteCommand)
        .command(blockCommand)
        .command(unblockCommand)
        .command(readyCommand)
        .command(statusCommand)
        .command(treeCommand)
        .command(logCommand)
        .command(pruneCommand)
        .command(restoreCommand)
        .command(doctorCommand)
        .command(renumberCommand)
        .command(serveCommand)
        .command(mcpCommand)
        .command(installCommand)
        .command(upgradeCommand)
        .command(uninstallCommand)
        // Four parameters selects yargs' "fallback" completion form: ours runs first, and calling
        // completionFilter() hands back to yargs' own completion of command and flag names.
        .completion(
            "completion",
            "Print a shell completion script for bash or zsh",
            (
                current: string,
                _argv: unknown,
                completionFilter: () => void,
                done: (completions: string[]) => void
            ) => {
                // Everything here is best-effort. Completion runs on every TAB, so a missing config
                // or a malformed issue must produce no candidates rather than an error in the shell.
                try {
                    // Deliberately from process.argv, not the parsed argv — see wordsFromArgv.
                    const words = wordsFromArgv(process.argv, current);

                    const { config, store } = context();
                    const candidates = completionCandidates(
                        { config, refs: store.refs() },
                        words,
                        current
                    );

                    if (candidates !== undefined) {
                        done(formatCandidates(candidates, isZshShell()));
                        return;
                    }
                } catch {
                    // Fall through to yargs' own completion, which needs no project.
                }

                completionFilter();
            }
        )
        .demandCommand(1, "Which command? Run `motte --help`, or `motte` on its own for status.")
        .recommendCommands()
        .strict()
        .help()
        .alias("h", "help")
        .wrap(Math.min(100, process.stdout.columns ?? 100))
        .epilogue(
            "Every command that takes an issue accepts a number or part of its title:\n" +
                "  motte show 12        motte show round-trip\n\n" +
                "Docs: https://codevachon.github.io/motte"
        )
        // yargs' own failure path (unknown flags, missing positionals) already prints a usage
        // block; rethrow anything else so `report` can format it consistently.
        .fail((message, thrown) => {
            if (thrown) report(thrown);
            // yargs can call this with a null or empty message. Printing it produced "✗ null"; showing the
            // usage block is what the user actually needs at that point.
            if (message === null || message === undefined || message === "") {
                cli.showHelp();
                process.exit(1);
            }
            process.stderr.write(`${error(message)}\n`);
            process.exit(1);
        });

    // The bare command is handled here rather than as a yargs `$0` command. Registering one would make
    // every unrecognised first word an "unknown argument" instead of an unknown command, which silently
    // disables `recommendCommands` — `motte stauts` would stop suggesting `status`.
    if (argv.length === 0) {
        // "log" rather than the default "error": asking for status outside a project is not a failure.
        defaultAction(() => cli.showHelp("log"));
        return;
    }

    await cli.parseAsync();
}

/**
 * The entry point, error handling included.
 *
 * Exported so tests can drive the CLI in-process through exactly the path the binary takes. Calling
 * `run` directly would skip `report`, which is where every expected error becomes a clean line and an
 * exit code — the behaviour most worth testing.
 */
export async function main(argv: string[] = hideBin(process.argv)): Promise<void> {
    try {
        await run(argv);
    } catch (thrown) {
        report(thrown);
    }
}

if (import.meta.main) {
    void main();
}
