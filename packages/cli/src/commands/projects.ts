import type { CommandModule } from "yargs";
import { CONFIG_FILENAME, IssueStore, loadConfigFrom } from "@motte/core";
import { join } from "node:path";
import { emitJson } from "../context.js";
import { dim, ok, paintId, warn } from "../ui/format.js";
import {
    forgetMissing,
    listProjects,
    rememberProject,
    summarise,
    type RegisteredProject
} from "../projects/registry.js";

/**
 * `motte projects` — every project this machine has seen.
 *
 * The one question the committed files structurally cannot answer, because no repository knows about the
 * others. Ordered by when motte last ran in each, which makes the top of the list "where I left off".
 */

interface ProjectsArgs {
    refresh?: boolean;
    prune?: boolean;
    json?: boolean;
}

/** Re-read each registered project so the summaries are current rather than as-last-seen. */
function refreshAll(projects: RegisteredProject[]): RegisteredProject[] {
    return projects.map((project) => {
        if (project.missing) return project;

        try {
            const config = loadConfigFrom(join(project.root, CONFIG_FILENAME));
            const summary = summarise(config, new IssueStore(config).all(), project.seen);

            rememberProject(summary, { force: true });
            return { ...summary, missing: false };
        } catch {
            // A project that cannot be read right now is still a project. Reporting the stale summary
            // beats failing the whole listing for one broken config.
            return project;
        }
    });
}

/** `width` aligns the percentages: the names are the only variable-length column. */
function line(project: RegisteredProject, width: number): string {
    const bar = `${String(project.percent).padStart(3)}%`;
    const counts = `${project.done}/${project.counted}`;

    return (
        `  ${project.name.padEnd(width)}  ${dim(bar)}  ${dim(counts)}` +
        (project.ready > 0 ? `  ${dim(`${project.ready} ready`)}` : "") +
        (project.missing ? `  ${warn("missing")}` : "")
    );
}

export const projectsCommand: CommandModule<{}, ProjectsArgs> = {
    command: "projects",
    describe: "Every project motte has run in on this machine",
    builder: (yargs) =>
        yargs
            .option("refresh", {
                type: "boolean",
                describe: "Re-read each project instead of using the stored summary"
            })
            .option("prune", {
                type: "boolean",
                describe: "Forget projects whose config file has gone"
            })
            .option("json", { type: "boolean", describe: "Machine-readable output" }),
    handler: (args) => {
        if (args.prune === true) {
            const gone = forgetMissing();

            if (args.json === true) {
                emitJson({ forgotten: gone.map((project) => project.root) });
                return;
            }

            if (gone.length === 0) {
                process.stdout.write(`${ok("every registered project is still there")}\n`);
                return;
            }

            for (const project of gone) {
                process.stdout.write(`${ok(`forgot ${project.name}`)} ${dim(project.root)}\n`);
            }
            return;
        }

        const projects = args.refresh === true ? refreshAll(listProjects()) : listProjects();

        if (args.json === true) {
            emitJson({ count: projects.length, projects });
            return;
        }

        if (projects.length === 0) {
            process.stdout.write(
                `${dim("no projects registered yet")}\n` +
                    `${dim("  Any motte command run inside a project registers it.")}\n`
            );
            return;
        }

        const out = process.stdout;
        out.write("\n");

        const width = Math.max(...projects.map((project) => project.name.length));

        for (const project of projects) {
            out.write(`${line(project, width)}\n`);
            out.write(`    ${dim(project.root)}\n`);

            for (const issue of project.inFlight) {
                out.write(
                    `    ${paintId(issue.id)} ${issue.title}` +
                        (issue.assignee === undefined ? "" : ` ${dim(issue.assignee)}`) +
                        "\n"
                );
            }
        }

        const missing = projects.filter((project) => project.missing).length;
        out.write(
            `\n${dim(`${projects.length} project${projects.length === 1 ? "" : "s"}`)}` +
                (missing > 0
                    ? `${dim(`, ${missing} missing — \`motte projects --prune\` forgets them`)}`
                    : "") +
                "\n"
        );
    }
};
