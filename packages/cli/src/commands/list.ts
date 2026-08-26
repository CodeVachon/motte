import type { CommandModule } from "yargs";
import {
    buildTree,
    filterIssues,
    flattenTree,
    isReady,
    isBlocked,
    isSettled,
    stateCategory,
    type Issue
} from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { openProjects } from "../projects/across.js";
import { dim, heading, issueLine, treeLines, warn } from "../ui/format.js";
import { parseFieldArguments } from "../fields.js";

interface ListArgs {
    state?: string;
    parent?: string;
    assignee?: string;
    label?: string;
    field?: string[];
    open?: boolean;
    ready?: boolean;
    blocked?: boolean;
    tree?: boolean;
    json?: boolean;
    all?: boolean;
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
            .option("field", {
                type: "array",
                string: true,
                describe: "Only issues whose configured field equals key=value (repeatable)"
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
            .option("all", {
                type: "boolean",
                describe: "Across every project on this machine"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        // Before `context()`, because the point of `--all` is asking from anywhere — including from a
        // directory that is not a motte project at all.
        if (args.all === true) {
            if (args.field !== undefined) {
                throw new Error(
                    "--field is available within one project; projects may declare different fields"
                );
            }
            listAcross(args);
            return;
        }

        const { config, store } = context();
        const all = store.all();
        const fields = parseFieldArguments(config, args.field);
        let issues = all;

        // Prefix matching on state, because this one is typed by a person: `--state don` finds Done.
        issues = filterIssues(
            issues,
            {
                state: args.state,
                label: args.label,
                assignee: args.assignee,
                // Resolved here rather than in core, which does not know how to turn a title fragment
                // into an id.
                parent: args.parent === undefined ? undefined : store.resolve(args.parent).id,
                ...(fields === undefined ? {} : { fields })
            },
            { stateMatch: "prefix" }
        );

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

/**
 * The same list, across every project on this machine.
 *
 * This is what makes "what is assigned to me everywhere" answerable: `motte list --all --assignee atlas`.
 * The filters are the shared ones, so they behave here exactly as they do in one project; `--tree` and
 * `--parent` are not offered, because a hierarchy and a parent reference only mean something within the
 * project whose ids they belong to.
 */
function listAcross(args: ListArgs): void {
    const { projects, unreadable } = openProjects();
    const out = process.stdout;

    const found = projects.map((project) => {
        let issues = filterIssues(
            project.issues,
            { state: args.state, label: args.label, assignee: args.assignee },
            { stateMatch: "prefix" }
        );

        if (args.open === true) {
            issues = issues.filter((issue) => !isSettled(project.config, issue));
        }
        if (args.ready === true) {
            issues = issues.filter((issue) => isReady(project.config, project.issues, issue));
        }
        if (args.blocked === true) {
            issues = issues.filter(
                (issue) =>
                    !isSettled(project.config, issue) &&
                    isBlocked(project.config, project.issues, issue)
            );
        }

        return { project, issues };
    });

    const total = found.reduce((count, entry) => count + entry.issues.length, 0);

    if (args.json === true) {
        emitJson({
            count: total,
            projects: found.map((entry) => ({
                name: entry.project.name,
                root: entry.project.root,
                issues: entry.issues.map(issueJson)
            })),
            unreadable: unreadable.map((project) => ({ name: project.name, root: project.root }))
        });
        return;
    }

    if (total === 0) {
        out.write(`${dim("no issues match in any project")}\n`);
        return;
    }

    for (const { project, issues } of found) {
        if (issues.length === 0) continue;

        out.write(`\n${heading(project.name)}\n`);
        for (const issue of issues) out.write(`${issueLine(project.config, issue)}\n`);
    }

    const projectCount = found.filter((entry) => entry.issues.length > 0).length;
    out.write(
        `\n${dim(`${total} issue${total === 1 ? "" : "s"} in ${projectCount} project${projectCount === 1 ? "" : "s"}`)}\n`
    );
}
