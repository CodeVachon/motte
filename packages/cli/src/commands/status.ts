import type { CommandModule } from "yargs";
import {
    blocked,
    buildTree,
    subtreeOf,
    epicReports,
    flattenTree,
    openBlockers,
    projectReport,
    progressBar,
    ready
} from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import {
    dim,
    heading,
    issueLine,
    paintId,
    paintState,
    progressLine,
    treeLines
} from "../ui/format.js";

interface StatusArgs {
    json?: boolean;
    epics?: boolean;
}

export const statusCommand: CommandModule<{}, StatusArgs> = {
    command: "status",
    describe: "Progress summary for the project",
    builder: (yargs) =>
        yargs
            .option("epics", { type: "boolean", describe: "Include per-epic rollups" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const issues = store.all();
        const report = projectReport(config, issues);

        if (args.json === true) {
            emitJson({
                name: report.name,
                total: report.total,
                counted: report.counted,
                percentComplete: report.percentComplete,
                completed: report.completed,
                started: report.started,
                unstarted: report.unstarted,
                cancelled: report.cancelled,
                byState: report.byState,
                ready: ready(config, issues).map(issueJson),
                blocked: blocked(config, issues).map(issueJson),
                inProgress: report.inProgress.map(issueJson),
                epics: epicReports(config, issues).map((epic) => ({
                    id: epic.issue.id,
                    title: epic.issue.title,
                    percentComplete: epic.percentComplete,
                    total: epic.total,
                    completed: epic.completed
                }))
            });
            return;
        }

        const out = process.stdout;

        out.write(`\n${heading(report.name)}\n\n`);
        out.write(`${progressLine(report)}\n\n`);

        const width = Math.max(...report.byState.map((entry) => entry.state.length));
        for (const entry of report.byState) {
            const padding = " ".repeat(width - entry.state.length);
            out.write(`  ${paintState(config, entry.state)}${padding}  ${entry.count}\n`);
        }

        const readyIssues = ready(config, issues);
        const blockedIssues = blocked(config, issues);

        if (readyIssues.length > 0 || blockedIssues.length > 0) {
            out.write(
                `\n  ${dim("ready")} ${readyIssues.length}   ${dim("blocked")} ${blockedIssues.length}\n`
            );
        }

        if (report.inProgress.length > 0) {
            out.write(`\n${heading("In flight")}\n\n`);
            for (const issue of report.inProgress) {
                out.write(`${issueLine(config, issue)}\n`);
                for (const blocker of openBlockers(config, issues, issue)) {
                    out.write(
                        `      ${dim("waiting on")} ${paintId(blocker.id)} ${dim(blocker.title)}\n`
                    );
                }
            }
        }

        if (args.epics === true) {
            const epics = epicReports(config, issues);
            if (epics.length > 0) {
                out.write(`\n${heading("Epics")}\n\n`);
                const titleWidth = Math.min(
                    44,
                    Math.max(...epics.map((epic) => epic.issue.title.length))
                );
                for (const epic of epics) {
                    const title = epic.issue.title.slice(0, titleWidth).padEnd(titleWidth);
                    out.write(
                        `  ${paintId(epic.issue.id)} ${title}  ${progressBar(epic.percentComplete, 12)} ` +
                            `${String(epic.percentComplete).padStart(3)}%  ${dim(`${epic.completed}/${epic.counted}`)}\n`
                    );
                }
            }
        }

        out.write("\n");
    }
};

interface TreeArgs {
    ref?: string;
    json?: boolean;
}

export const treeCommand: CommandModule<{}, TreeArgs> = {
    command: "tree [ref]",
    describe: "Render the issue hierarchy",
    builder: (yargs) =>
        yargs
            .positional("ref", { type: "string", describe: "Show only this issue's subtree" })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        const { config, store } = context();
        const issues = store.all();
        const { roots, problems } = buildTree(issues);

        const scope = args.ref === undefined ? roots : subtreeOf(roots, store.resolve(args.ref).id);

        if (args.json === true) {
            const serialize = (node: (typeof scope)[number]): unknown => ({
                ...issueJson(node.issue),
                children: node.children.map(serialize)
            });
            emitJson({ roots: scope.map(serialize), problems: problems.map((p) => p.message) });
            return;
        }

        for (const line of treeLines(config, flattenTree(scope))) {
            process.stdout.write(`${line}\n`);
        }

        for (const problem of problems) {
            process.stderr.write(`${dim(problem.message)}\n`);
        }
    }
};
