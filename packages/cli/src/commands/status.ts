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
    ready,
    filterIssues,
    type Config,
    type Issue
} from "@motte/core";
import { context, emitJson, issueJson } from "../context.js";
import { parseFieldArguments } from "../fields.js";
import { openProjects, totals } from "../projects/across.js";
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
    all?: boolean;
    field?: string[];
}

export const statusCommand: CommandModule<{}, StatusArgs> = {
    command: "status",
    describe: "Progress summary for the project",
    builder: (yargs) =>
        yargs
            .option("epics", { type: "boolean", describe: "Include per-epic rollups" })
            .option("all", {
                type: "boolean",
                describe: "Every project on this machine, not just this one"
            })
            .option("field", {
                type: "array",
                string: true,
                describe: "Scope the report to issues whose configured field equals key=value"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        // Deliberately before `context()`: this is the one report that answers a question from outside any
        // project, and requiring one to ask it would defeat the point.
        if (args.all === true) {
            if (args.field !== undefined) {
                throw new Error(
                    "--field is available within one project; projects may declare different fields"
                );
            }
            renderAcross(args.json === true);
            return;
        }

        const { config, store } = context();
        const fields = parseFieldArguments(config, args.field);
        const issues = filterIssues(store.all(), fields === undefined ? {} : { fields });
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

        renderStatus(config, issues, args.epics === true);
    }
};

/**
 * Progress across every project on this machine.
 *
 * The question no repository can answer, because none of them knows the others exist. Totals are summed
 * over issues rather than averaged over projects — a two-issue project and a two-hundred-issue one do not
 * weigh the same, and averaging percentages would say they do.
 */
function renderAcross(json: boolean): void {
    const { projects, unreadable } = openProjects();
    const reports = projects.map((project) => projectReport(project.config, project.issues));
    const combined = totals(projects, reports);

    if (json) {
        emitJson({
            total: combined,
            projects: projects.map((project, index) => ({
                name: project.name,
                root: project.root,
                percentComplete: reports[index]!.percentComplete,
                counted: reports[index]!.counted,
                completed: reports[index]!.completed,
                inProgress: reports[index]!.inProgress.map(issueJson)
            })),
            unreadable: unreadable.map((project) => ({ name: project.name, root: project.root }))
        });
        return;
    }

    const out = process.stdout;

    if (projects.length === 0) {
        out.write(
            `\n${dim("no projects registered yet")}\n` +
                `${dim("  Any motte command run inside a project registers it.")}\n\n`
        );
        return;
    }

    out.write(`\n${heading("All projects")}\n\n`);
    out.write(
        `${progressBar(combined.percent)} ${combined.percent}%  ` +
            `${dim(`${combined.done} of ${combined.counted} done`)}` +
            `${dim(` · ${combined.started} started · ${combined.projects} projects`)}\n\n`
    );

    // Padded so the percentages line up; the names are the only variable-length column.
    const width = Math.max(...projects.map((project) => project.name.length));

    projects.forEach((project, index) => {
        const report = reports[index]!;

        out.write(
            `  ${project.name.padEnd(width)}  ${dim(`${String(report.percentComplete).padStart(3)}%`)}  ` +
                `${dim(`${report.completed}/${report.counted}`)}\n`
        );

        for (const issue of report.inProgress) {
            out.write(`    ${issueLine(project.config, issue)}\n`);
        }
    });

    if (unreadable.length > 0) {
        out.write(
            `\n${dim(`${unreadable.length} registered project(s) could not be read — \`motte projects\` lists them`)}\n`
        );
    }

    out.write("\n");
}

/**
 * The human-readable status report.
 *
 * Extracted so `motte` with no arguments can print the same thing. Two copies would drift, and the bare
 * command is the first thing anyone runs.
 */
export function renderStatus(config: Config, issues: Issue[], epics: boolean): void {
    const report = projectReport(config, issues);

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

    if (epics) {
        const rollups = epicReports(config, issues);
        if (rollups.length > 0) {
            out.write(`\n${heading("Epics")}\n\n`);
            const titleWidth = Math.min(
                44,
                Math.max(...rollups.map((epic) => epic.issue.title.length))
            );
            for (const epic of rollups) {
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
