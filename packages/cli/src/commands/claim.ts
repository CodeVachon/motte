import type { CommandModule } from "yargs";
import { resolveAuthor } from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { dim, issueLine, ok } from "../ui/format.js";

/**
 * `motte claim` and `motte release` — taking work, and putting it back.
 *
 * The gap these close is the one the whole tool is for. Two agents call `motte next`, both get #0042, both
 * set themselves as the assignee, and the second write wins: one agent's work is orphaned and the record
 * shows a single name, so nothing ever says it happened.
 *
 * Claiming refuses instead. An agent that is told no can ask for the next issue and carry on, which is what
 * makes several of them on one backlog workable rather than merely possible.
 */

interface ClaimArgs {
    ref: string;
    force?: boolean;
    json?: boolean;
}

export const claimCommand: CommandModule<{}, ClaimArgs> = {
    command: "claim <ref>",
    describe: "Take an issue: assign it to yourself and start it, unless somebody else holds it",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "The issue to take"
            })
            .option("force", {
                type: "boolean",
                describe: "Take it even if somebody else holds it"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const target = store.resolve(args.ref);
        const author = resolveAuthor({ cwd: config.root });

        const issue = store.claim(target.id, author, { force: args.force === true });

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        process.stdout.write(
            `${ok(`claimed by ${author.name}`)}\n${issueLine(config, issue)}\n` +
                `${dim("  `motte release` puts it back if you do not finish it.")}\n`
        );
    }
};

interface ReleaseArgs {
    ref: string;
    force?: boolean;
    json?: boolean;
}

export const releaseCommand: CommandModule<{}, ReleaseArgs> = {
    command: "release <ref>",
    describe: "Put an issue back: clear the assignee and return it to the default state",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "The issue to put back"
            })
            .option("force", {
                type: "boolean",
                describe: "Release it even if somebody else holds it"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const target = store.resolve(args.ref);
        const author = resolveAuthor({ cwd: config.root });

        const issue = store.release(target.id, author, { force: args.force === true });

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        process.stdout.write(`${ok("released")}\n${issueLine(config, issue)}\n`);
    }
};
