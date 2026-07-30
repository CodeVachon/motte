import type { CommandModule } from "yargs";
import {
    buildTree,
    flattenTree,
    isReady,
    isBlocked,
    isSettled,
    stateCategory,
    type Issue
} from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { dim, issueLine, treeLines, warn } from "../ui/format.js";

interface ListArgs {
    state?: string;
    parent?: string;
    assignee?: string;
    label?: string;
    open?: boolean;
    ready?: boolean;
    blocked?: boolean;
    tree?: boolean;
    json?: boolean;
}

export const listCommand: CommandModule<{}, ListArgs> = {
    command: "list",
    aliases: ["ls"],
    describe: "List issues",
    builder: (yargs) =>
        yargs
            .option("state", { alias: "s", type: "string", describe: "Only this state" })
            .option("parent", {
                alias: "p",
                type: "string",
                describe: "Only children of this issue"
            })
            .option("assignee", { alias: "a", type: "string", describe: "Only this assignee" })
            .option("label", {
                alias: "l",
                type: "string",
                describe: "Only issues with this label"
            })
            .option("open", {
                type: "boolean",
                describe: "Hide completed and cancelled issues"
            })
            .option("ready", {
                type: "boolean",
                describe: "Only issues that can be picked up now"
            })
            .option("blocked", { type: "boolean", describe: "Only issues waiting on a blocker" })
            .option("tree", { alias: "t", type: "boolean", describe: "Render as a hierarchy" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const all = store.all();
        let issues = all;

        if (args.state !== undefined) {
            const needle = args.state.toLowerCase();
            issues = issues.filter((issue) => issue.state.toLowerCase().startsWith(needle));
        }

        if (args.parent !== undefined) {
            const parent = store.resolve(args.parent);
            issues = issues.filter((issue) => issue.parent === parent.id);
        }

        if (args.assignee !== undefined) {
            const needle = args.assignee.toLowerCase();
            issues = issues.filter((issue) => issue.assignee?.toLowerCase() === needle);
        }

        if (args.label !== undefined) {
            const needle = args.label.toLowerCase();
            issues = issues.filter((issue) =>
                (issue.labels ?? []).some((label) => label.toLowerCase() === needle)
            );
        }

        if (args.open === true) {
            issues = issues.filter((issue) => {
                const category = stateCategory(config, issue.state);
                return category !== "completed" && category !== "cancelled";
            });
        }

        if (args.ready === true) {
            issues = issues.filter((issue) => isReady(config, all, issue));
        }

        if (args.blocked === true) {
            issues = issues.filter(
                (issue) => !isSettled(config, issue) && isBlocked(config, all, issue)
            );
        }

        if (args.json === true) {
            emitJson({ count: issues.length, issues: issues.map(issueJson) });
            return;
        }

        if (issues.length === 0) {
            process.stdout.write(`${dim("no issues match")}\n`);
            return;
        }

        if (args.tree === true) {
            const { roots, problems } = buildTree(issues);
            for (const line of treeLines(config, flattenTree(roots))) {
                process.stdout.write(`${line}\n`);
            }
            for (const problem of problems) {
                process.stderr.write(`${warn(problem.message)}\n`);
            }
        } else {
            for (const issue of issues) process.stdout.write(`${issueLine(config, issue)}\n`);
        }

        process.stdout.write(
            `\n${dim(`${issues.length} issue${issues.length === 1 ? "" : "s"}`)}\n`
        );
    }
};
