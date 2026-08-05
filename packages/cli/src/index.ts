import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
    AmbiguousRefError,
    ClaimedError,
    ConfigError,
    ConfigNotFoundError,
    CycleError,
    DependencyCycleError,
    IssueNotFoundError,
    IssueParseError
} from "@motte/core";
import { blockCommand, readyCommand, unblockCommand } from "./commands/deps.js";
import { claimCommand, releaseCommand } from "./commands/claim.js";
import { currentCommand } from "./commands/current.js";
import { doctorCommand } from "./commands/doctor.js";
import { findCommand } from "./commands/find.js";
import { projectsCommand } from "./commands/projects.js";
import { renumberCommand } from "./commands/renumber.js";
import { serveCommand } from "./commands/serve.js";
import { watchCommand } from "./commands/watch.js";
import {
    candidateStyle,
    completionCandidates,
    formatCandidates,
    wordsFromArgv
} from "./completion.js";
import { COMPLETION_SHELLS, completionScript, isCompletionShell } from "./completionScripts.js";
import { context, registerVisit } from "./context.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { mcpCommand } from "./commands/mcp.js";
import { nextCommand } from "./commands/next.js";
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
    ClaimedError,
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

/** Put an environment variable back as it was, including having been absent. */
function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

/**
 * The parser, every command registered.
 *
 * A function rather than inline in `run` because yargs decides between the bash and zsh completion
 * templates when the instance is constructed, by reading `SHELL`. Asking for one of them by name means
 * setting those variables and then building — which needs a second instance.
 */
function buildCli(argv: string[]) {
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
        .command(nextCommand)
        .command(findCommand)
        .command(claimCommand)
        .command(releaseCommand)
        .command(currentCommand)
        .command(statusCommand)
        .command(treeCommand)
        .command(logCommand)
        .command(pruneCommand)
        .command(restoreCommand)
        .command(doctorCommand)
        .command(projectsCommand)
        .command(renumberCommand)
        .command(serveCommand)
        .command(watchCommand)
        .command(mcpCommand)
        .command(installCommand)
        .command(upgradeCommand)
        .command(uninstallCommand)
        // Four parameters selects yargs' "fallback" completion form: ours runs first, and calling
        // completionFilter() hands back to yargs' own completion of command and flag names.
        .completion(
            "completion",
            "Print a shell completion script — bash, zsh, fish or powershell",
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
                        done(formatCandidates(candidates, candidateStyle()));
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

    return cli;
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

    /**
     * `motte completion <shell>`, for the two shells yargs has no template for.
     *
     * Handled before yargs parses, because `.completion()` registers a command that takes no arguments —
     * it sniffs the environment and prints bash or zsh. Naming a shell outright is the only way to ask for
     * fish or PowerShell, and it also means an installer or a Dockerfile can generate the right script
     * without depending on what `SHELL` happens to say.
     *
     * `motte completion` with no shell stays yargs' business, unchanged.
     */
    if (argv[0] === "completion" && argv[1] !== undefined && !argv[1].startsWith("-")) {
        if (!isCompletionShell(argv[1])) {
            process.stderr.write(
                `${error(`unknown shell "${argv[1]}"`)}\n` +
                    `${dim(`  Supported: ${COMPLETION_SHELLS.join(", ")}.`)}\n`
            );
            process.exitCode = 1;
            return;
        }

        const written = completionScript(argv[1]);
        if (written !== undefined) {
            process.stdout.write(written);
            return;
        }

        // bash and zsh come from yargs, which chooses between them by sniffing. Steering that with the
        // variables it reads keeps one implementation of those two scripts rather than a second copy —
        // and they are restored, because the tests drive this in the same process.
        const previous = { SHELL: process.env.SHELL, ZSH_NAME: process.env.ZSH_NAME };
        try {
            process.env.SHELL = argv[1] === "zsh" ? "/bin/zsh" : "/bin/bash";
            delete process.env.ZSH_NAME;
            buildCli([]).showCompletionScript();
        } finally {
            restore("SHELL", previous.SHELL);
            restore("ZSH_NAME", previous.ZSH_NAME);
        }
        return;
    }

    /**
     * A completion request from fish or PowerShell must not be answered in zsh's dialect.
     *
     * yargs formats its own command and flag completions as `name:description` when it thinks the shell is
     * zsh, and both of those shells split a candidate on a tab — so the pair arrives as one literal word
     * and `motte ren<TAB>` inserted `renumber:Give a fresh id…`. Found by running it in real fish.
     *
     * It decides by reading SHELL when the instance is constructed, so the fix is to construct it in an
     * environment describing where the request actually came from. The cost is bare command names there,
     * with no descriptions; the candidates motte generates itself keep theirs.
     */
    const speaksTabs = candidateStyle() === "tab";
    const previousShell = { SHELL: process.env.SHELL, ZSH_NAME: process.env.ZSH_NAME };

    if (speaksTabs) {
        delete process.env.SHELL;
        delete process.env.ZSH_NAME;
    }

    try {
        const cli = buildCli(argv);

        // The bare command is handled here rather than as a yargs `$0` command. Registering one would make
        // every unrecognised first word an "unknown argument" instead of an unknown command, which silently
        // disables `recommendCommands` — `motte stauts` would stop suggesting `status`.
        if (argv.length === 0) {
            // "log" rather than the default "error": asking for status outside a project is not a failure.
            defaultAction(() => cli.showHelp("log"));
            return;
        }

        await cli.parseAsync();
    } finally {
        // Restored because the tests drive this in one long-lived process.
        if (speaksTabs) {
            restore("SHELL", previousShell.SHELL);
            restore("ZSH_NAME", previousShell.ZSH_NAME);
        }
    }
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
        // After the command, not before: recording the visit when the project was opened stored the backlog
        // as it was without whatever the command then did to it.
        registerVisit();
    } catch (thrown) {
        // Still recorded on the way out. A command that failed still tells us the project exists, and a
        // partial write is exactly the state somebody will want to see next.
        registerVisit();
        report(thrown);
    }
}

if (import.meta.main) {
    void main();
}
