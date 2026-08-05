import type { CommandModule } from "yargs";
import { filterIssues, openBlockers, type Issue, type IssueStore } from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { dim, issueLine, ok, paintId } from "../ui/format.js";

interface BlockerArgs {
    ref: string;
    blocker: string;
    json?: boolean;
}

/**
 * `block` and `unblock`, which differ only in the store method they call and the sentence they print.
 *
 * Built from one description rather than written twice: the pair was two nine- and twelve-line clone
 * groups, and the shape is the kind that drifts — the `--json` branch or the resolution of the two refs
 * getting fixed in one of them and not the other.
 */
function blockerCommand(spec: {
    command: string;
    describe: string;
    blockerDescribe: string;
    /** Takes the store the handler already opened, rather than opening a second one. */
    apply: (store: IssueStore, id: number, blocker: number) => Issue;
    said: (issueId: number, blockerId: number, blockerTitle: string) => string;
}): CommandModule<{}, BlockerArgs> {
    return {
        command: spec.command,
        describe: spec.describe,
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
                    describe: spec.blockerDescribe
                })
                .option("json", { type: "boolean", describe: "Machine-readable output" }),
        handler: (args) => {
            const { config, store } = context();
            const target = store.resolve(args.ref);
            const blocker = store.resolve(args.blocker);

            const issue = spec.apply(store, target.id, blocker.id);

            if (args.json === true) {
                emitJson(issueJson(issue));
                return;
            }

            process.stdout.write(
                `${ok(spec.said(issue.id, blocker.id, blocker.title))}\n` +
                    `${issueLine(config, issue)}\n`
            );
        }
    };
}

export const blockCommand = blockerCommand({
    command: "block <ref> <blocker>",
    describe: "Record that an issue is blocked by another",
    blockerDescribe: "The issue it waits on",
    apply: (store, id, blocker) => store.block(id, blocker),
    said: (issueId, blockerId, title) =>
        `${paintId(issueId)} is blocked by ${paintId(blockerId)} ${dim(title)}`
});

export const unblockCommand = blockerCommand({
    command: "unblock <ref> <blocker>",
    describe: "Remove a blocker from an issue",
    blockerDescribe: "The blocker to remove",
    apply: (store, id, blocker) => store.unblock(id, blocker),
    said: (issueId, blockerId) => `${paintId(issueId)} no longer blocked by ${paintId(blockerId)}`
});

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

        selected = filterIssues(selected, { label: args.label, assignee: args.assignee });

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
