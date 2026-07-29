import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
    AmbiguousRefError,
    ConfigError,
    CycleError,
    IssueNotFoundError,
    IssueParseError
} from "@motte/core";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import {
    addCommand,
    assignCommand,
    editCommand,
    moveCommand,
    noteCommand
} from "./commands/mutate.js";
import { showCommand } from "./commands/show.js";
import { statusCommand, treeCommand } from "./commands/status.js";
import { error } from "./ui/format.js";

export const VERSION = "0.1.0";

/**
 * Errors that represent a normal "you asked for something that isn't there" outcome. These print a
 * single clean line rather than a stack trace, because they are the user's problem to fix, not a bug.
 */
const EXPECTED_ERRORS = [
    AmbiguousRefError,
    ConfigError,
    CycleError,
    IssueNotFoundError,
    IssueParseError
];

function report(thrown: unknown): never {
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

export async function run(argv: string[] = hideBin(process.argv)): Promise<void> {
    const cli = yargs(argv)
        .scriptName("motte")
        .usage("$0 <command> [options]")
        .version(VERSION)
        .command(initCommand)
        .command(addCommand)
        .command(listCommand)
        .command(showCommand)
        .command(editCommand)
        .command(moveCommand)
        .command(assignCommand)
        .command(noteCommand)
        .command(statusCommand)
        .command(treeCommand)
        .command(doctorCommand)
        .demandCommand(1, "")
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
            process.stderr.write(`${error(message)}\n`);
            process.exit(1);
        });

    await cli.parseAsync();
}

if (import.meta.main) {
    run().catch(report);
}
