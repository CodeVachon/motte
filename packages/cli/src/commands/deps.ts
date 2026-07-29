import type { CommandModule } from "yargs";
import { openBlockers } from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { dim, issueLine, ok, paintId } from "../ui/format.js";

interface BlockArgs {
    ref: string;
    blocker: string;
    json?: boolean;
}

export const blockCommand: CommandModule<{}, BlockArgs> = {
    command: "block <ref> <blocker>",
    describe: "Record that an issue is blocked by another",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "The blocked issue"
            })
            .positional("blocker", {
                type: "string",
                demandOption: true,
                describe: "The issue it waits on"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const target = store.resolve(args.ref);
        const blocker = store.resolve(args.blocker);

        const issue = store.block(target.id, blocker.id);

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        process.stdout.write(
            `${ok(`${paintId(issue.id)} is blocked by ${paintId(blocker.id)} ${dim(blocker.title)}`)}\n` +
                `${issueLine(config, issue)}\n`
        );
    }
};

interface UnblockArgs {
    ref: string;
    blocker: string;
    json?: boolean;
}

export const unblockCommand: CommandModule<{}, UnblockArgs> = {
    command: "unblock <ref> <blocker>",
    describe: "Remove a blocker from an issue",
    builder: (yargs) =>
        yargs
            .positional("ref", {
                type: "string",
                demandOption: true,
                describe: "The blocked issue"
            })
            .positional("blocker", {
                type: "string",
                demandOption: true,
                describe: "The blocker to remove"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const target = store.resolve(args.ref);
        const blocker = store.resolve(args.blocker);

        const issue = store.unblock(target.id, blocker.id);

        if (args.json === true) {
            emitJson(issueJson(issue));
            return;
        }

        process.stdout.write(
            `${ok(`${paintId(issue.id)} no longer blocked by ${paintId(blocker.id)}`)}\n` +
                `${issueLine(config, issue)}\n`
        );
    }
};

interface ReadyArgs {
    assignee?: string;
    label?: string;
    json?: boolean;
    blocked?: boolean;
}

export const readyCommand: CommandModule<{}, ReadyArgs> = {
    command: "ready",
    describe: "Issues that can be picked up right now — nothing standing in the way",
    builder: (yargs) =>
        yargs
            .option("assignee", { alias: "a", type: "string", describe: "Only this assignee" })
            .option("label", {
                alias: "l",
                type: "string",
                describe: "Only issues with this label"
            })
            .option("blocked", {
                type: "boolean",
                describe: "Show what is waiting instead, and on what"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const issues = store.all();

        let selected = args.blocked === true ? store.blocked() : store.ready();

        if (args.assignee !== undefined) {
            const needle = args.assignee.toLowerCase();
            selected = selected.filter((issue) => issue.assignee?.toLowerCase() === needle);
        }

        if (args.label !== undefined) {
            const needle = args.label.toLowerCase();
            selected = selected.filter((issue) =>
                (issue.labels ?? []).some((label) => label.toLowerCase() === needle)
            );
        }

        if (args.json === true) {
            emitJson({
                count: selected.length,
                issues: selected.map((issue) => ({
                    ...issueJson(issue),
                    openBlockers: openBlockers(config, issues, issue).map((blocker) => ({
                        id: blocker.id,
                        title: blocker.title,
                        state: blocker.state
                    }))
                }))
            });
            return;
        }

        if (selected.length === 0) {
            process.stdout.write(
                `${dim(args.blocked === true ? "nothing is blocked" : "nothing is ready")}\n`
            );
            return;
        }

        for (const issue of selected) {
            process.stdout.write(`${issueLine(config, issue)}\n`);

            if (args.blocked === true) {
                for (const blocker of openBlockers(config, issues, issue)) {
                    process.stdout.write(
                        `      ${dim("waiting on")} ${paintId(blocker.id)} ${dim(blocker.title)}\n`
                    );
                }
            }
        }

        process.stdout.write(
            `\n${dim(`${selected.length} ${args.blocked === true ? "blocked" : "ready"}`)}\n`
        );
    }
};
